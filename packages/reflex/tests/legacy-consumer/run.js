// Verifies the packed tarball the way old consumer projects use it:
//
// 1. `npm pack` the library.
// 2. Install the React-free vanilla entrypoint with peer dependencies omitted
//    and prove that it creates and runs an explicit runtime without React.
// 3. Install the tarball into a fresh project with React 18 (the oldest
//    supported peer line), then run an event -> app-db -> subscription cycle
//    via both
//    `require()` and `import`.
// 4. Typecheck the published declarations with legacy TypeScript versions in
//    two resolution modes: `exports`-based NodeNext and classic node10 +
//    CommonJS (which reads the top-level `types` field).
//
// Usage: node tests/legacy-consumer/run.js [tsVersion ...]
// Defaults to the versions in DEFAULT_TYPESCRIPT_VERSIONS.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixtureSource = path.join(here, 'fixture');

const DEFAULT_TYPESCRIPT_VERSIONS = ['4.9', '5.3'];
const REACT_VERSION = '18.3.1';
const REACT_TYPES_VERSION = '18.3.31';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function packLibrary(destination) {
  const output = execFileSync(npm, ['pack', '--json', '--pack-destination', destination], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const filename = JSON.parse(output)[0]?.filename;
  if (!filename) {
    throw new Error('npm pack did not report a tarball filename.');
  }
  return path.join(destination, filename);
}

function main() {
  const requested = process.argv.slice(2).filter((version) => version.trim() !== '');
  const typescriptVersions = requested.length > 0 ? requested : DEFAULT_TYPESCRIPT_VERSIONS;

  if (!fs.existsSync(path.join(repoRoot, 'dist', 'index.mjs'))) {
    throw new Error('dist/ is missing. Run `npm run build` before the legacy consumer checks.');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflex-legacy-consumer-'));
  try {
    const tarball = packLibrary(workDir);
    const vanillaConsumerDir = path.join(workDir, 'vanilla-consumer');
    fs.mkdirSync(vanillaConsumerDir);
    fs.writeFileSync(
      path.join(vanillaConsumerDir, 'package.json'),
      `${JSON.stringify({ name: 'reflex-vanilla-consumer', version: '0.0.0', private: true }, null, 2)}\n`,
    );
    console.log('[legacy] installing the vanilla entrypoint without React');
    run(
      npm,
      ['install', '--no-audit', '--no-fund', '--no-save', '--omit=peer', tarball],
      vanillaConsumerDir,
    );
    run(
      'node',
      [
        '--input-type=module',
        '--eval',
        `import assert from 'node:assert/strict';
         import { createRequire } from 'node:module';
         import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
         const require = createRequire(import.meta.url);
         assert.throws(() => require.resolve('react'));
         const runtime = createReflexRuntime({ initialDb: { count: 0 }, runtimeId: 'packed-vanilla' });
         runtime.regEvent('increment', ({ draftDb }) => { draftDb.count += 1; });
         runtime.dispatchSync(['increment']);
         assert.deepEqual(runtime.getAppDb(), { count: 1 });
         runtime.dispose();`,
      ],
      vanillaConsumerDir,
    );

    const consumerDir = path.join(workDir, 'consumer');
    fs.cpSync(fixtureSource, consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      `${JSON.stringify({ name: 'reflex-legacy-consumer', version: '0.0.0', private: true }, null, 2)}\n`,
    );

    console.log('[legacy] installing the packed tarball into a fresh consumer project');
    run(
      npm,
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--no-save',
        tarball,
        `react@${REACT_VERSION}`,
        `@types/react@${REACT_TYPES_VERSION}`,
      ],
      consumerDir,
    );

    console.log('[legacy] runtime smoke: CommonJS require()');
    run('node', ['smoke.cjs'], consumerDir);
    console.log('[legacy] runtime smoke: ESM import');
    run('node', ['smoke.mjs'], consumerDir);

    for (const version of typescriptVersions) {
      const tsc = ['--yes', '--package', `typescript@${version}`, 'tsc', '--noEmit', '-p'];
      console.log(`[legacy] TypeScript ${version}: exports resolution (NodeNext)`);
      run(npx, [...tsc, 'tsconfig.nodenext.json'], consumerDir);
      console.log(`[legacy] TypeScript ${version}: classic node10 resolution (CommonJS)`);
      run(npx, [...tsc, 'tsconfig.node10.json'], consumerDir);
    }

    console.log('[legacy] all legacy consumer checks passed');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[legacy] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
