import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const queryRoot = path.resolve(here, '..', '..');
const ukladRoot = path.resolve(queryRoot, '..', 'core');
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
    queryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function main() {
  if (!fs.existsSync(path.join(ukladRoot, 'dist', 'index.mjs'))) {
    throw new Error('Uklad dist is missing. Build @ukladjs/core before this check.');
  }
  if (!fs.existsSync(path.join(queryRoot, 'dist', 'index.mjs'))) {
    throw new Error(
      'uklad-tanstack-query dist is missing. Run the package build before this check.',
    );
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uklad-tanstack-query-consumer-'));
  try {
    process.env.npm_config_cache = path.join(workDir, '.npm-cache');
    process.env.npm_config_update_notifier = 'false';
    process.env.npm_config_dry_run = 'false';
    const ukladTarball = pack(ukladRoot, workDir);
    const queryTarball = pack(queryRoot, workDir);
    const consumerDir = path.join(workDir, 'consumer');
    fs.cpSync(fixtureSource, consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      `${JSON.stringify(
        { name: 'uklad-tanstack-query-package-consumer', version: '0.0.0', private: true },
        null,
        2,
      )}\n`,
    );

    console.log('[package] installing packed packages with the minimum supported Query Core peer');
    run(
      npm,
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--no-save',
        '--omit=peer',
        '@tanstack/query-core@5.0.0',
        ukladTarball,
        queryTarball,
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
