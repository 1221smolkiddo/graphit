// Assemble one public package without workspace symlinks or a multi-package release.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
// This is exclusively generated release output, never canonical project data.
if (output !== join(root, 'dist')) throw new Error('Unexpected release directory');
rmSync(output, { recursive: true, force: true });
const packages = readdirSync(join(root, 'packages')).sort();
for (const name of packages) {
  const source = join(root, 'packages', name, 'dist');
  const copy = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = join(relative, entry.name);
      if (entry.isDirectory()) { copy(join(directory, entry.name), rel); continue; }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.sql')) continue;
      const target = join(output, name, rel);
      mkdirSync(dirname(target), { recursive: true });
      if (entry.name.endsWith('.sql')) { cpSync(join(directory, entry.name), target); continue; }
      let text = readFileSync(join(directory, entry.name), 'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, '');
      text = text.replace(/(['"])@graphit\/([a-z]+)\1/g, (_match, quote, dependency) => {
        if (!packages.includes(dependency) || relative) throw new Error('Unrecognized internal runtime import');
        return `${quote}../${dependency}/index.js${quote}`;
      });
      if (name === 'mcp') text = text.replace(/(['"])zod\1/g, '$1graphit-zod-v4$1');
      if (/@graphit\//.test(text)) throw new Error(`Unresolved workspace import in ${target}`);
      writeFileSync(target, text);
    }
  };
  copy(source);
}
