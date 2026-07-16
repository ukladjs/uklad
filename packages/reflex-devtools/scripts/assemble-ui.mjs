import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDist = path.resolve(packageRoot, '../reflex-devtools-ui/dist');
const target = path.join(packageRoot, 'dist/ui');

try {
  await access(path.join(uiDist, 'index.html'));
} catch {
  throw new Error('DevTools UI is not built. Run the workspace build from the repository root.');
}

await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(uiDist, target, { recursive: true });
