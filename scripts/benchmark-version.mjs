import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function codeVersion() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const hash = createHash('sha256');
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else { hash.update(relative(root, path).replaceAll('\\', '/')); hash.update(readFileSync(path)); }
    }
  };
  visit(resolve(root, 'src')); visit(resolve(root, 'scripts'));
  for (const name of ['package.json', 'package-lock.json', 'vite.config.js']) hash.update(readFileSync(resolve(root, name)));
  let commit = 'unknown', dirty = true;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* Source digest still identifies exported workspaces. */ }
  return { commit, dirty, sourceHash: hash.digest('hex').slice(0, 16) };
}
