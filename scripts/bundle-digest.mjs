/**
 * Digests of the packaged app bundle (#10).
 *
 * `bundleDigest` covers the signed bytes and is reproducible on one machine. `contentDigest`
 * is reproducible across machines: codesign output depends on the macOS version (default
 * page size 4 KiB vs 16 KiB, reserved zero padding after the signature), so Mach-O files
 * are hashed without their signature and `_CodeSignature` seals are left out.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, readlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Manifest paths use `/` on every platform. */
function relativePath(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function sortedEntries(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * A thin 64-bit Mach-O up to its code signature, with the fields that depend on the
 * signature's size (__LINKEDIT vmsize/filesize, LC_CODE_SIGNATURE datasize) zeroed.
 */
function unsignedSlice(buffer) {
  if (buffer.length < 32 || buffer.readUInt32LE(0) !== MH_MAGIC_64) return null;
  const ncmds = buffer.readUInt32LE(16);
  const patches = [];
  let end = buffer.length;
  let offset = 32;
  for (let index = 0; index < ncmds; index += 1) {
    if (offset + 8 > buffer.length) return null;
    const command = buffer.readUInt32LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    if (command === LC_CODE_SIGNATURE) {
      end = buffer.readUInt32LE(offset + 8);
      patches.push([offset + 12, 4]);
    } else if (
      command === LC_SEGMENT_64 &&
      buffer.toString('latin1', offset + 8, offset + 24).replace(/\0+$/, '') === '__LINKEDIT'
    ) {
      patches.push([offset + 32, 8], [offset + 48, 8]);
    }
    if (size < 8) return null;
    offset += size;
  }
  if (end > buffer.length) return null;
  const copy = Buffer.from(buffer.subarray(0, end));
  for (const [at, length] of patches) if (at + length <= copy.length) copy.fill(0, at, at + length);
  return copy;
}

/**
 * SHA-256 of a Mach-O file without its code signature, or null for other files. Universal
 * files are hashed per architecture; their slice offsets and sizes follow the signature.
 */
export function unsignedMachOHash(buffer) {
  const thin = unsignedSlice(buffer);
  if (thin) return createHash('sha256').update(thin).digest('hex');
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== FAT_MAGIC) return null;
  const count = buffer.readUInt32BE(4);
  // Java class files share the magic number; their version field is far above any count.
  if (count === 0 || count > 32 || buffer.length < 8 + 20 * count) return null;
  const hash = createHash('sha256');
  for (let index = 0; index < count; index += 1) {
    const entry = 8 + 20 * index;
    const offset = buffer.readUInt32BE(entry + 8);
    const size = buffer.readUInt32BE(entry + 12);
    const slice = unsignedSlice(buffer.subarray(offset, offset + size));
    if (!slice) return null;
    hash.update(buffer.subarray(entry, entry + 8)); // cputype, cpusubtype
    hash.update(createHash('sha256').update(slice).digest());
  }
  return hash.digest('hex');
}

/**
 * Digest of the signed bundle: sorted relative paths with file SHA-256 values and symlink
 * targets. Two builds on the same machine can be compared by this value even though the
 * DMG itself contains timestamps.
 */
export async function bundleDigest(app) {
  const entries = [];
  const visit = async (directory) => {
    for (const entry of sortedEntries(directory)) {
      const full = path.join(directory, entry.name);
      const relative = relativePath(app, full);
      if (entry.isSymbolicLink()) entries.push(`L ${relative} ${readlinkSync(full)}`);
      else if (entry.isDirectory()) await visit(full);
      else entries.push(`F ${relative} ${await sha256(full)}`);
    }
  };
  await visit(app);
  const manifest = entries.join('\n') + '\n';
  return { manifest, digest: createHash('sha256').update(manifest).digest('hex') };
}

/**
 * Signature-independent digest: like bundleDigest, but Mach-O files (`M`) are hashed
 * without their code signature and `_CodeSignature` directories are skipped. Equal
 * values mean equal paths, resources and code, whichever codesign version signed them.
 */
export async function contentDigest(app) {
  const entries = [];
  const visit = async (directory) => {
    for (const entry of sortedEntries(directory)) {
      const full = path.join(directory, entry.name);
      const relative = relativePath(app, full);
      if (entry.isSymbolicLink()) entries.push(`L ${relative} ${readlinkSync(full)}`);
      else if (entry.isDirectory()) {
        if (entry.name !== '_CodeSignature') await visit(full);
      } else {
        const machO = unsignedMachOHash(readFileSync(full));
        entries.push(machO ? `M ${relative} ${machO}` : `F ${relative} ${await sha256(full)}`);
      }
    }
  };
  await visit(app);
  const manifest = entries.join('\n') + '\n';
  return { manifest, digest: createHash('sha256').update(manifest).digest('hex') };
}

/**
 * Remove empty directories below `directory` (not the directory itself) and return their
 * relative paths. npm versions differ in leaving empty scope folders of skipped optional
 * packages behind; app.asar records empty directories.
 */
export function removeEmptyDirectories(directory) {
  const removed = [];
  const visit = (current) => {
    let empty = true;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && visit(full)) {
        rmdirSync(full);
        removed.push(relativePath(directory, full));
      } else empty = false;
    }
    return empty;
  };
  visit(directory);
  return removed;
}
