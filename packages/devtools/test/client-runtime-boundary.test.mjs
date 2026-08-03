import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(entryPath)));
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

test('built DevTools client has no runtime import of Uklad', async () => {
  const clientFiles = await collectJavaScriptFiles(path.join(packageDir, 'dist/client'));
  const files = [
    ...clientFiles,
    path.join(packageDir, 'dist/index.js'),
    path.join(packageDir, 'dist/serialization.js'),
  ];
  const runtimeImportPatterns = [
    /\bfrom\s+['"]@ukladjs\/core(?:\/[^'"]*)?['"]/,
    /\bimport\s+['"]@ukladjs\/core(?:\/[^'"]*)?['"]/,
    /\bimport\s*\(\s*['"]@ukladjs\/core(?:\/[^'"]*)?['"]/,
    /\brequire\s*\(\s*['"]@ukladjs\/core(?:\/[^'"]*)?['"]/,
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const pattern of runtimeImportPatterns) {
      assert.doesNotMatch(source, pattern, path.relative(packageDir, file));
    }
  }
});

test('DevTools package keeps Uklad out of its published runtime dependencies', async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));

  assert.equal(packageJson.dependencies?.['@ukladjs/core'], undefined);
  assert.equal(packageJson.devDependencies?.['@ukladjs/core'], 'workspace:*');
  assert.equal(packageJson.peerDependencies?.['@ukladjs/core'], undefined);
});

test('the published client declaration exports the structural inspector protocol', async () => {
  const declaration = await readFile(path.join(packageDir, 'dist/client/index.d.ts'), 'utf8');

  assert.match(declaration, /export type \{[\s\S]*UkladInspector[\s\S]*\} from '\.\/types\.js';/);
});
