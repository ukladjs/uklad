import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const persistRoot = path.resolve(here, '..', '..');
const reflexRoot = path.resolve(persistRoot, '..', 'reflex');
const fixtureSource = path.join(here, 'fixture');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function pack(packageRoot, destination) {
  const output = execFileSync(
    npm,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  );
  const filename = JSON.parse(output)[0]?.filename;
  if (!filename) throw new Error(`npm pack did not report a tarball for ${packageRoot}.`);
  const tarball = path.join(destination, filename);
  if (!fs.existsSync(tarball)) {
    throw new Error(`npm pack reported ${filename} for ${packageRoot} but wrote no tarball.`);
  }
  return tarball;
}

function compiler(name) {
  return path.join(
    persistRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function main() {
  if (!fs.existsSync(path.join(reflexRoot, 'dist', 'index.mjs'))) {
    throw new Error('Reflex dist is missing. Build @flexsurfer/reflex before this check.');
  }
  if (!fs.existsSync(path.join(persistRoot, 'dist', 'index.mjs'))) {
    throw new Error('reflex-persist dist is missing. Run the package build before this check.');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflex-persist-consumer-'));
  try {
    process.env.npm_config_cache = path.join(workDir, '.npm-cache');
    process.env.npm_config_update_notifier = 'false';
    // `npm publish --dry-run` exports npm_config_dry_run=true to lifecycle scripts, and
    // prepublishOnly runs this check: without the override npm pack writes no tarball.
    process.env.npm_config_dry_run = 'false';
    const reflexTarball = pack(reflexRoot, workDir);
    const persistTarball = pack(persistRoot, workDir);
    const consumerDir = path.join(workDir, 'consumer');
    fs.cpSync(fixtureSource, consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      `${JSON.stringify(
        { name: 'reflex-persist-package-consumer', version: '0.0.0', private: true },
        null,
        2,
      )}\n`,
    );

    console.log('[package] installing separately packed Reflex and reflex-persist tarballs');
    run(
      npm,
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--no-save',
        '--omit=peer',
        reflexTarball,
        persistTarball,
      ],
      consumerDir,
    );

    console.log('[package] runtime smoke: ESM import');
    run('node', ['smoke.mjs'], consumerDir);
    console.log('[package] runtime smoke: CommonJS require()');
    run('node', ['smoke.cjs'], consumerDir);
    console.log('[package] declaration smoke: TypeScript 7');
    run(compiler('tsc'), ['--noEmit', '-p', 'tsconfig.json'], consumerDir);
    console.log('[package] declaration smoke: TypeScript 6');
    run(compiler('tsc6'), ['--noEmit', '-p', 'tsconfig.json'], consumerDir);
    console.log('[package] all packed-consumer checks passed');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[package] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
