import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunCache } from '../src/main/run-cache';

const temporary: string[] = [];
async function folder() {
  const value = await mkdtemp(path.join(tmpdir(), 'femantis-run-cache-test-'));
  temporary.push(value);
  return value;
}
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const exists = (file: string) =>
  lstat(file).then(
    () => true,
    () => false,
  );
async function fakeRun(directory: string, bytes: number) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'result.vtu'), Buffer.alloc(bytes, 1));
}
/** A second app instance: alive or crashed, decided by the injected liveness probe. */
async function foreignSession(cacheRoot: string, pid: number) {
  const session = path.join(cacheRoot, `session-${randomUUID()}`);
  await mkdir(session, { recursive: true });
  await writeFile(path.join(session, 'session.json'), JSON.stringify({ pid }));
  const run = path.join(session, randomUUID());
  await fakeRun(run, 100);
  return { session, run };
}

describe('Lokaler Laufcache', () => {
  it('legt jeden Lauf in einem neuen Ordner an und überschreibt keinen vorhandenen', async () => {
    const cache = await RunCache.open(path.join(await folder(), 'runs'));
    const id = randomUUID();
    const directory = await cache.createRunDirectory(id);
    await writeFile(path.join(directory, 'result.json'), '{"original":true}');
    await expect(cache.createRunDirectory(id)).rejects.toThrow(/existiert bereits/);
    expect(await readFile(path.join(directory, 'result.json'), 'utf8')).toBe('{"original":true}');
    const other = await cache.createRunDirectory(randomUUID());
    expect(other).not.toBe(directory);
    await expect(cache.createRunDirectory('../ausbruch')).rejects.toThrow();
  });

  it('weist Größe und Anzahl aller verwalteten Läufe aus', async () => {
    const cacheRoot = path.join(await folder(), 'runs');
    const cache = await RunCache.open(cacheRoot, () => true);
    await fakeRun(await cache.createRunDirectory(randomUUID()), 1000);
    await fakeRun(path.join(cacheRoot, randomUUID()), 500); // legacy flat layout
    await foreignSession(cacheRoot, 4242);
    const usage = await cache.usage();
    expect(usage.runs).toBe(3);
    expect(usage.bytes).toBeGreaterThanOrEqual(1600);
  });

  it('bereinigt nur unreferenzierte Läufe und schützt aktive Läufe anderer Instanzen', async () => {
    const root = await folder();
    const cacheRoot = path.join(root, 'runs');
    const cache = await RunCache.open(cacheRoot, (pid) => pid === 1111);
    const kept = await cache.createRunDirectory(randomUUID());
    await fakeRun(kept, 10);
    const dropped = await cache.createRunDirectory(randomUUID());
    await fakeRun(dropped, 300);
    const legacy = path.join(cacheRoot, randomUUID());
    await fakeRun(legacy, 200);
    const alive = await foreignSession(cacheRoot, 1111);
    const crashed = await foreignSession(cacheRoot, 2222);
    const unrelated = path.join(cacheRoot, 'NOTIZ.txt');
    await writeFile(unrelated, 'nicht verwaltet');
    const outside = path.join(root, 'fremd');
    await fakeRun(outside, 50);
    const link = path.join(cacheRoot, randomUUID());
    await symlink(outside, link, 'dir');

    const removed = await cache.prune([kept]);

    expect(removed.runs).toBe(4); // dropped, legacy, crashed session run, symlink entry
    expect(removed.bytes).toBeGreaterThanOrEqual(600);
    expect(await exists(kept)).toBe(true);
    expect(await exists(dropped)).toBe(false);
    expect(await exists(legacy)).toBe(false);
    expect(await exists(alive.run)).toBe(true);
    expect(await exists(crashed.session)).toBe(false);
    expect(await exists(unrelated)).toBe(true);
    expect(await exists(link)).toBe(false);
    expect(await readdir(outside)).toEqual(['result.vtu']);
    expect((await cache.usage()).runs).toBe(2);
  });

  it('entfernt einzelne Läufe nur aus dem eigenen Sitzungscache', async () => {
    const root = await folder();
    const cache = await RunCache.open(path.join(root, 'runs'));
    const project = path.join(root, 'probe.femantis.files', 'runs', randomUUID());
    await fakeRun(project, 10);
    await expect(cache.discard(project)).rejects.toThrow(/lokale/);
    expect(await exists(project)).toBe(true);
    const own = await cache.createRunDirectory(randomUUID());
    await fakeRun(own, 10);
    await cache.discard(own);
    expect(await exists(own)).toBe(false);
  });

  it('entfernt den eigenen Sitzungscache beim Beenden', async () => {
    const cacheRoot = path.join(await folder(), 'runs');
    const cache = await RunCache.open(cacheRoot);
    await fakeRun(await cache.createRunDirectory(randomUUID()), 10);
    await cache.close();
    expect(await readdir(cacheRoot)).toEqual([]);
  });
});
