import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  bundleDigest,
  contentDigest,
  removeEmptyDirectories,
  unsignedMachOHash,
} from '../scripts/bundle-digest.mjs';

const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;

/**
 * Minimal arm64 Mach-O: header, __LINKEDIT segment, LC_CODE_SIGNATURE, code bytes and a
 * signature area. `reserved` models the zero padding older codesign versions append.
 */
function machO(code: Buffer, signature: Buffer, reserved = 0): Buffer {
  const commands = 72 + 16;
  const dataoff = 32 + commands + code.length;
  const datasize = signature.length + reserved;
  const file = Buffer.alloc(dataoff + datasize);
  file.writeUInt32LE(0xfeedfacf, 0);
  file.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  file.writeUInt32LE(2, 16); // ncmds
  file.writeUInt32LE(commands, 20);
  let offset = 32;
  file.writeUInt32LE(LC_SEGMENT_64, offset);
  file.writeUInt32LE(72, offset + 4);
  file.write('__LINKEDIT', offset + 8, 'latin1');
  file.writeBigUInt64LE(BigInt(dataoff), offset + 40); // fileoff
  file.writeBigUInt64LE(BigInt(datasize), offset + 32); // vmsize
  file.writeBigUInt64LE(BigInt(datasize), offset + 48); // filesize
  offset += 72;
  file.writeUInt32LE(LC_CODE_SIGNATURE, offset);
  file.writeUInt32LE(16, offset + 4);
  file.writeUInt32LE(dataoff, offset + 8);
  file.writeUInt32LE(datasize, offset + 12);
  code.copy(file, 32 + commands);
  signature.copy(file, dataoff);
  return file;
}

function fat(...slices: Buffer[]): Buffer {
  const header = Buffer.alloc(8 + 20 * slices.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  let offset = 0x4000;
  const parts: Buffer[] = [header];
  slices.forEach((slice, index) => {
    const entry = 8 + 20 * index;
    header.writeUInt32BE(0x0100000c, entry);
    header.writeUInt32BE(0, entry + 4);
    header.writeUInt32BE(offset, entry + 8);
    header.writeUInt32BE(slice.length, entry + 12);
    header.writeUInt32BE(14, entry + 16);
    const start = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(Buffer.alloc(offset - start), slice);
    offset += Math.ceil(slice.length / 0x4000 + 1) * 0x4000;
  });
  return Buffer.concat(parts);
}

const code = Buffer.from('ausfuehrbarer Code '.repeat(20));

describe('Signaturunabhängiger Hash von Mach-O-Dateien (#10)', () => {
  it('ignoriert Signaturinhalt, Seitengröße und reservierten Platz', () => {
    const newer = machO(code, Buffer.alloc(554, 1));
    const older = machO(code, Buffer.alloc(1418, 2), 18006);
    expect(unsignedMachOHash(newer)).toBe(unsignedMachOHash(older));
  });

  it('erkennt jede Änderung am signierten Code', () => {
    const changed = Buffer.from(code);
    changed[3] ^= 1;
    expect(unsignedMachOHash(machO(changed, Buffer.alloc(554)))).not.toBe(
      unsignedMachOHash(machO(code, Buffer.alloc(554))),
    );
  });

  it('normalisiert jede Architektur einer Universal-Datei', () => {
    const newer = fat(machO(code, Buffer.alloc(554, 1)));
    const older = fat(machO(code, Buffer.alloc(1418, 2), 18006));
    expect(unsignedMachOHash(newer)).toBe(unsignedMachOHash(older));
    expect(unsignedMachOHash(newer)).not.toBe(unsignedMachOHash(machO(code, Buffer.alloc(554))));
  });

  it('liefert für andere Dateien null', () => {
    expect(unsignedMachOHash(Buffer.from('#!/bin/sh\n'))).toBeNull();
    expect(unsignedMachOHash(Buffer.alloc(2))).toBeNull();
  });

  it.runIf(process.platform === 'darwin')(
    'ist unabhängig von der codesign-Seitengröße einer echten Datei',
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'femantis-digest-'));
      const hashes = [4096, 16384].map((pageSize) => {
        const target = path.join(directory, String(pageSize), 'true');
        mkdirSync(path.dirname(target));
        copyFileSync('/usr/bin/true', target);
        execFileSync(
          'codesign',
          ['--force', '--sign', '-', '--pagesize', String(pageSize), target],
          {
            stdio: 'pipe',
          },
        );
        return unsignedMachOHash(readFileSync(target));
      });
      expect(hashes[0]).not.toBeNull();
      expect(hashes[0]).toBe(hashes[1]);
    },
  );
});

function bundle(signature: Buffer, reserved: number, resources: string): string {
  const app = mkdtempSync(path.join(tmpdir(), 'femantis-bundle-'));
  mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  mkdirSync(path.join(app, 'Contents/_CodeSignature'));
  writeFileSync(path.join(app, 'Contents/MacOS/Femantis'), machO(code, signature, reserved));
  writeFileSync(path.join(app, 'Contents/_CodeSignature/CodeResources'), resources);
  writeFileSync(path.join(app, 'Contents/Info.plist'), '<plist/>');
  return app;
}

describe('Bundle-Digests (#10)', () => {
  it('contentDigest stimmt bei abweichender Signatur überein, bundleDigest nicht', async () => {
    const newer = bundle(Buffer.alloc(554, 1), 0, 'cdhash a');
    const older = bundle(Buffer.alloc(1418, 2), 18006, 'cdhash b');
    expect((await contentDigest(newer)).digest).toBe((await contentDigest(older)).digest);
    expect((await bundleDigest(newer)).digest).not.toBe((await bundleDigest(older)).digest);
    expect((await contentDigest(newer)).manifest).toMatch(
      /^M Contents\/MacOS\/Femantis [0-9a-f]{64}$/m,
    );
    expect((await contentDigest(newer)).manifest).not.toContain('_CodeSignature');
  });

  it('contentDigest erkennt geänderte Ressourcen', async () => {
    const app = bundle(Buffer.alloc(554), 0, 'x');
    const before = (await contentDigest(app)).digest;
    writeFileSync(path.join(app, 'Contents/Info.plist'), '<plist>geändert</plist>');
    expect((await contentDigest(app)).digest).not.toBe(before);
  });
});

describe('Leere Verzeichnisse vor dem asar-Archiv entfernen (#10)', () => {
  it('entfernt leere Scope-Ordner übersprungener optionaler Pakete, behält Inhalte', () => {
    const modules = mkdtempSync(path.join(tmpdir(), 'femantis-modules-'));
    mkdirSync(path.join(modules, '@napi-rs'));
    mkdirSync(path.join(modules, '@scope/leer/tief'), { recursive: true });
    mkdirSync(path.join(modules, 'three/build'), { recursive: true });
    writeFileSync(path.join(modules, 'three/build/three.module.js'), 'export {};');
    expect(removeEmptyDirectories(modules).sort()).toEqual([
      '@napi-rs',
      '@scope',
      '@scope/leer',
      '@scope/leer/tief',
    ]);
    expect(readdirSync(modules)).toEqual(['three']);
  });
});
