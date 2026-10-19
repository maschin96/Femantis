import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local, non-portable run cache. Each app instance owns one session folder
 * `session-<uuid>/` (with `session.json` naming its process) holding unsaved runs
 * `<run-uuid>/`. Bare `<run-uuid>/` folders are the flat layout used before #7.
 * Saved projects copy their runs into `<project>.files/runs`; this module never
 * touches those folders.
 */
export interface CacheUsage {
  bytes: number;
  runs: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionName = /^session-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

interface ManagedEntry {
  file: string;
  kind: 'legacy' | 'own' | 'session';
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Size of a cache entry without following symbolic links. */
async function entryBytes(file: string): Promise<number> {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    // A failed solve may release its folder while the size is being read.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(file)) total += await entryBytes(path.join(file, name));
  return total;
}

export class RunCache {
  private constructor(
    readonly root: string,
    readonly session: string,
    private readonly alive: (pid: number) => boolean,
  ) {}

  /** Create the cache root and this instance's session folder atomically. */
  static async open(
    cacheRoot: string,
    alive: (pid: number) => boolean = processAlive,
  ): Promise<RunCache> {
    await mkdir(cacheRoot, { recursive: true });
    const root = await realpath(cacheRoot);
    const id = randomUUID();
    const staging = path.join(root, `.session-${id}.tmp`);
    const session = path.join(root, `session-${id}`);
    await mkdir(staging);
    try {
      await writeFile(
        path.join(staging, 'session.json'),
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n',
        { flag: 'wx' },
      );
      await rename(staging, session);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    return new RunCache(root, session, alive);
  }

  /** A new, empty folder for one run; an existing folder is never reused. */
  async createRunDirectory(id: string): Promise<string> {
    if (!uuid.test(id)) throw new Error('Ungültige Lauf-ID.');
    const directory = path.join(this.session, id);
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('Der Laufordner existiert bereits und wird nicht überschrieben.', {
          cause: error,
        });
      throw error;
    }
    return directory;
  }

  private async managed(): Promise<ManagedEntry[]> {
    const entries: ManagedEntry[] = [];
    for (const name of await readdir(this.root)) {
      const file = path.join(this.root, name);
      if (uuid.test(name)) entries.push({ file, kind: 'legacy' });
      else if (sessionName.test(name))
        entries.push({ file, kind: file === this.session ? 'own' : 'session' });
    }
    return entries;
  }

  private async runsIn(session: string): Promise<string[]> {
    const info = await lstat(session);
    if (!info.isDirectory()) return [];
    return (await readdir(session)).filter((name) => uuid.test(name));
  }

  private async sessionAlive(session: string): Promise<boolean> {
    try {
      if (!(await lstat(session)).isDirectory()) return false;
      const { pid } = JSON.parse(await readFile(path.join(session, 'session.json'), 'utf8'));
      return Number.isInteger(pid) && pid > 0 && this.alive(pid);
    } catch {
      // Sessions are published atomically; a missing or unreadable marker is stale.
      return false;
    }
  }

  async usage(): Promise<CacheUsage> {
    let bytes = 0;
    let runs = 0;
    for (const entry of await this.managed()) {
      bytes += await entryBytes(entry.file);
      runs += entry.kind === 'legacy' ? 1 : (await this.runsIn(entry.file)).length;
    }
    return { bytes, runs };
  }

  /**
   * Remove every cached run that is not listed in `keep` (run folders of this
   * session), legacy flat runs and sessions of processes that no longer exist.
   * Runs of other live instances stay. Symbolic links are removed, never followed.
   * `legacy: false` keeps legacy flat runs (automatic startup cleanup).
   */
  async prune(keep: Iterable<string>, options: { legacy?: boolean } = {}): Promise<CacheUsage> {
    const kept = new Set([...keep].map((directory) => path.resolve(directory)));
    let bytes = 0;
    let runs = 0;
    const remove = async (file: string, count: number) => {
      bytes += await entryBytes(file);
      runs += count;
      await rm(file, { recursive: true, force: true });
    };
    for (const entry of await this.managed()) {
      if (entry.kind === 'legacy') {
        if (options.legacy !== false) await remove(entry.file, 1);
      } else if (entry.kind === 'own') {
        for (const name of await this.runsIn(entry.file)) {
          const file = path.join(entry.file, name);
          if (!kept.has(file)) await remove(file, 1);
        }
      } else if (!(await this.sessionAlive(entry.file)))
        await remove(entry.file, (await this.runsIn(entry.file)).length);
    }
    return { bytes, runs };
  }

  /** Delete one unsaved run of this session; project folders are rejected. */
  async discard(directory: string): Promise<void> {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== this.session || !uuid.test(path.basename(resolved)))
      throw new Error('Nur lokale Cacheläufe dieser Sitzung können gelöscht werden.');
    await rm(resolved, { recursive: true, force: true });
  }

  /** Remove this session's unsaved runs when the application quits. */
  async close(): Promise<void> {
    await rm(this.session, { recursive: true, force: true });
  }
}
