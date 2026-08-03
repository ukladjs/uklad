// Verifies the packed tarball the way old consumer projects use it:
//
// 1. `npm pack` the library.
// 2. Install the React-free vanilla entrypoint with peer dependencies omitted
//    and prove that it creates and runs an explicit runtime without React.
// 3. Install the tarball into a fresh project with React 18 (the oldest
//    supported peer line), then run an event -> state -> subscription cycle
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

function run(command, args, cwd, env) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
}

function packLibrary(destination, env) {
  const output = execFileSync(npm, ['pack', '--json', '--pack-destination', destination], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  const filename = JSON.parse(output)[0]?.filename;
  if (!filename) {
    throw new Error('npm pack did not report a tarball filename.');
  }
  const tarball = path.join(destination, filename);
  if (!fs.existsSync(tarball)) {
    throw new Error(`npm pack reported ${filename} but wrote no tarball.`);
  }
  return tarball;
}

function main() {
  // pnpm forwards the `--` separator itself into argv, so drop it alongside blanks.
  const requested = process.argv
    .slice(2)
    .filter((version) => version.trim() !== '' && version.trim() !== '--');
  const typescriptVersions = requested.length > 0 ? requested : DEFAULT_TYPESCRIPT_VERSIONS;

  if (!fs.existsSync(path.join(repoRoot, 'dist', 'index.mjs'))) {
    throw new Error('dist/ is missing. Run `npm run build` before the legacy consumer checks.');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uklad-legacy-consumer-'));
  const env = {
    ...process.env,
    npm_config_cache: path.join(workDir, 'npm-cache'),
    // `npm publish --dry-run` exports npm_config_dry_run=true to lifecycle scripts, and
    // prepublishOnly runs this check: without the override npm pack writes no tarball.
    npm_config_dry_run: 'false',
  };
  try {
    const tarball = packLibrary(workDir, env);
    const vanillaConsumerDir = path.join(workDir, 'vanilla-consumer');
    fs.mkdirSync(vanillaConsumerDir);
    fs.writeFileSync(
      path.join(vanillaConsumerDir, 'package.json'),
      `${JSON.stringify({ name: 'uklad-vanilla-consumer', version: '0.0.0', private: true }, null, 2)}\n`,
    );
    console.log('[legacy] installing the vanilla entrypoint without React');
    run(
      npm,
      ['install', '--no-audit', '--no-fund', '--no-save', '--omit=peer', tarball],
      vanillaConsumerDir,
      env,
    );
    run(
      'node',
      [
        '--input-type=module',
        '--eval',
        `import assert from 'node:assert/strict';
         import { createRequire } from 'node:module';
         import { createUkladRuntime } from '@ukladjs/core/vanilla';
         import { createUkladTestHarness } from '@ukladjs/core/testing';
         const require = createRequire(import.meta.url);
         assert.throws(() => require.resolve('react'));
         const runtime = createUkladRuntime({ initialState: { count: 0 }, runtimeId: 'packed-vanilla' });
         const testHarness = createUkladTestHarness(runtime);
         runtime.registerModule((registrar) => {
           registrar.regEvent('increment', ({ draftState }) => { draftState.count += 1; });
         });
         testHarness.dispatchSync(['increment']);
         assert.deepEqual(testHarness.getState(), { count: 1 });
         runtime.dispose();`,
      ],
      vanillaConsumerDir,
      env,
    );

    const consumerDir = path.join(workDir, 'consumer');
    fs.cpSync(fixtureSource, consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      `${JSON.stringify({ name: 'uklad-legacy-consumer', version: '0.0.0', private: true }, null, 2)}\n`,
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
      env,
    );

    console.log('[legacy] runtime smoke: CommonJS require()');
    run('node', ['smoke.cjs'], consumerDir, env);
    console.log('[legacy] runtime smoke: ESM import');
    run('node', ['smoke.mjs'], consumerDir, env);

    for (const version of typescriptVersions) {
      const tsc = ['--yes', '--package', `typescript@${version}`, 'tsc', '--noEmit', '-p'];
      console.log(`[legacy] TypeScript ${version}: exports resolution (NodeNext)`);
      run(npx, [...tsc, 'tsconfig.nodenext.json'], consumerDir, env);
      console.log(`[legacy] TypeScript ${version}: classic node10 resolution (CommonJS)`);
      run(npx, [...tsc, 'tsconfig.node10.json'], consumerDir, env);
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
