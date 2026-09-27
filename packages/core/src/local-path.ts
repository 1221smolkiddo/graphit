import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Local filesystem identity only; never apply to immutable repo-relative evidence. */
export function canonicalLocalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch (error) {
    // New project/database paths may not exist yet. Resolve their existing ancestor.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(canonicalLocalPath(parent), basename(absolute));
  }
}
