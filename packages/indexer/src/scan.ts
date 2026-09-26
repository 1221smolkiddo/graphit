import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { normalizePath, type Language } from '@graphit/codegraph';

export const defaultIgnores = ['.git', '.graphit', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out', 'vendor', '__pycache__', '.venv', 'venv'] as const;
export function detectLanguage(path: string): Language | undefined {
  const extension = extname(path).toLowerCase();
  if (['.ts', '.mts', '.cts'].includes(extension)) return 'typescript';
  if (extension === '.tsx') return 'tsx';
  if (['.js', '.mjs', '.cjs'].includes(extension)) return 'javascript';
  if (extension === '.jsx') return 'jsx';
  if (extension === '.py') return 'python';
  return undefined;
}
export function assertWithinRoot(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) throw new Error('Path escapes repository root');
}
export interface ScannedFile { path: string; absolutePath: string; language: Language }
export interface ScanResult { files: ScannedFile[]; errors: { path: string; message: string }[] }
export function scanRepository(rootPath: string, ignoreNames: readonly string[] = []): ScanResult {
  const root = realpathSync(resolve(rootPath));
  const ignores = new Set<string>([...defaultIgnores, ...ignoreNames]);
  const result: ScanResult = { files: [], errors: [] };
  function visit(directory: string): void {
    let entries;
    try { assertWithinRoot(root, realpathSync(directory)); entries = readdirSync(directory, { withFileTypes: true }); }
    catch (error) { result.errors.push({ path: relative(root, directory).replaceAll('\\', '/') || '.', message: String(error) }); return; }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (ignores.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      const path = normalizePath(relative(root, absolutePath));
      try {
        const stat = lstatSync(absolutePath);
        if (stat.isSymbolicLink()) { result.errors.push({ path, message: 'Symlink skipped; target was not read' }); continue; }
        if (stat.isDirectory()) visit(absolutePath);
        else if (stat.isFile()) {
          const language = detectLanguage(path);
          if (language) result.files.push({ path, absolutePath, language });
        }
      } catch (error) { result.errors.push({ path, message: String(error) }); }
    }
  }
  visit(root);
  return result;
}
export function readRepositoryFile(root: string, file: ScannedFile): Uint8Array {
  assertWithinRoot(root, resolve(file.absolutePath));
  if (lstatSync(file.absolutePath).isSymbolicLink()) throw new Error('Refusing a source symlink');
  assertWithinRoot(root, realpathSync(file.absolutePath));
  const descriptor = openSync(file.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error('Source is not a regular file');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || after.size !== bytes.length) throw new Error('Source changed while being read; retry indexing');
    return bytes;
  } finally { closeSync(descriptor); }
}
