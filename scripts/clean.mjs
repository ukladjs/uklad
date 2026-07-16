import { rm } from 'node:fs/promises';
import path from 'node:path';

const targets = process.argv.slice(2);

if (targets.length === 0) {
  throw new Error('Pass at least one package-relative path to clean.');
}

for (const target of targets) {
  const resolved = path.resolve(process.cwd(), target);
  const relative = path.relative(process.cwd(), resolved);

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside the current package: ${target}`);
  }

  await rm(resolved, { recursive: true, force: true });
}
