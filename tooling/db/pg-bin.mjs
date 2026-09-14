/**
 * Locates the PostgreSQL client/server binaries.
 *
 * Shared by the database harness (`local-cluster.mjs`) and the end-to-end stack:
 * PostgREST's Windows build links against `LIBPQ.dll`, which ships with the
 * PostgreSQL installation rather than in the PostgREST release archive, so the
 * stack has to put that directory on the child process PATH.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const isWindows = process.platform === 'win32';

/** Returns the directory holding `pg_ctl`, or null when none can be found. */
export function findPostgresBinDirectory() {
  if (process.env.HANAPLY_PG_BIN) {
    return process.env.HANAPLY_PG_BIN;
  }
  const candidates = [];
  if (isWindows) {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pgRoot = join(programFiles, 'PostgreSQL');
    if (existsSync(pgRoot)) {
      for (const entry of readdirSync(pgRoot).sort().reverse()) {
        candidates.push(join(pgRoot, entry, 'bin'));
      }
    }
  } else {
    candidates.push('/usr/lib/postgresql/18/bin', '/usr/local/pgsql/bin', '/opt/homebrew/bin');
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, isWindows ? 'pg_ctl.exe' : 'pg_ctl'))) {
      return candidate;
    }
  }
  const which = spawnSync(isWindows ? 'where' : 'which', ['pg_ctl'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) {
    return dirname(which.stdout.trim().split(/\r?\n/)[0]);
  }
  return null;
}

/** Environment for a child process that needs `LIBPQ.dll` and friends. */
export function withPostgresBinOnPath(environment = process.env) {
  const bin = findPostgresBinDirectory();
  if (!bin) return { ...environment };
  const separator = isWindows ? ';' : ':';
  const current = environment.PATH ?? environment.Path ?? '';
  const entries = current.split(separator).filter(Boolean);
  if (!entries.includes(bin)) entries.unshift(bin);
  return { ...environment, PATH: entries.join(separator) };
}
