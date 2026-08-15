import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = readJson('release.json');
const supportedNode = '^22.18.0 || >=24.11.0';
const repositoryUrl = 'git+https://github.com/ukladjs/uklad.git';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packageManifest(entry) {
  return readJson(path.join(entry.path, 'package.json'));
}

function caretRangeIncludes(range, version) {
  const rangeMatch = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!rangeMatch || !versionMatch) return false;

  const [, rangeMajor, rangeMinor, rangePatch] = rangeMatch.map(Number);
  const [, versionMajor, versionMinor, versionPatch] = versionMatch.map(Number);
  const atOrAboveMinimum =
    versionMajor > rangeMajor ||
    (versionMajor === rangeMajor && versionMinor > rangeMinor) ||
    (versionMajor === rangeMajor && versionMinor === rangeMinor && versionPatch >= rangePatch);
  if (!atOrAboveMinimum) return false;
  if (rangeMajor > 0) return versionMajor === rangeMajor;
  if (rangeMinor > 0) return versionMajor === 0 && versionMinor === rangeMinor;
  return versionMajor === 0 && versionMinor === 0 && versionPatch === rangePatch;
}

function validateRelease() {
  assert(release.schemaVersion === 2, 'Unsupported release manifest schema');
  assert(typeof release.id === 'string' && release.id.length > 0, 'Release id is required');
  assert(Array.isArray(release.packages) && release.packages.length > 0, 'Release packages are required');

  const declaredNames = new Set();
  for (const entry of release.packages) {
    assert(!declaredNames.has(entry.name), `Duplicate release package ${entry.name}`);
    declaredNames.add(entry.name);
    assert(typeof entry.publish === 'boolean', `${entry.name} publish selection is required`);

    const manifest = packageManifest(entry);
    assert(manifest.name === entry.name, `${entry.path} name does not match release.json`);
    assert(manifest.version === entry.version, `${entry.name} version does not match release.json`);
    assert(manifest.private !== true, `${entry.name} must be publishable`);
    assert(manifest.license === 'MIT', `${entry.name} must declare the MIT license`);
    assert(manifest.author === 'flexsurfer', `${entry.name} author metadata is missing`);
    assert(manifest.homepage === 'https://uklad.js.org', `${entry.name} homepage is stale`);
    assert(manifest.bugs?.url === 'https://github.com/ukladjs/uklad/issues', `${entry.name} bugs URL is stale`);
    assert(manifest.repository?.url === repositoryUrl, `${entry.name} repository URL is stale`);
    assert(manifest.repository?.directory === entry.path, `${entry.name} repository directory is stale`);
    assert(manifest.engines?.node === supportedNode, `${entry.name} supported Node range is missing`);
    assert(manifest.publishConfig?.access === 'public', `${entry.name} must publish publicly`);
    assert(manifest.publishConfig?.tag === entry.tag, `${entry.name} dist-tag does not match release.json`);

    for (const requiredFile of ['README.md', 'LICENSE']) {
      assert(fs.existsSync(path.join(root, entry.path, requiredFile)), `${entry.name} is missing ${requiredFile}`);
      assert(manifest.files?.includes(requiredFile), `${entry.name} does not publish ${requiredFile}`);
    }
    assert(manifest.files?.includes('dist'), `${entry.name} does not publish dist`);
    assert(fs.existsSync(path.join(root, entry.path, manifest.main)), `${entry.name} main build output is missing`);
    assert(fs.existsSync(path.join(root, entry.path, manifest.types)), `${entry.name} type build output is missing`);

    for (const dependencyKind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(manifest[dependencyKind] ?? {})) {
        assert(!version.startsWith('workspace:'), `${entry.name} has publish-time ${dependencyKind} ${name}@${version}`);
      }
    }
  }

  const publicWorkspacePackages = fs
    .readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join('packages', entry.name, 'package.json'))
    .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
    .map((relativePath) => readJson(relativePath))
    .filter((manifest) => manifest.private !== true)
    .map((manifest) => manifest.name)
    .sort();
  assert(
    JSON.stringify([...declaredNames].sort()) === JSON.stringify(publicWorkspacePackages),
    'release.json must include every public workspace package exactly once',
  );
  assert(release.packages.some((entry) => entry.publish), 'At least one release package must be selected');

  const coreVersion = release.packages.find((entry) => entry.name === '@ukladjs/core')?.version;
  const mcpVersion = release.packages.find((entry) => entry.name === '@ukladjs/devtools-mcp')?.version;
  for (const integrationName of ['@ukladjs/persist', '@ukladjs/tanstack-query']) {
    const integration = release.packages.find((entry) => entry.name === integrationName);
    const corePeer = packageManifest(integration).peerDependencies?.['@ukladjs/core'];
    assert(
      caretRangeIncludes(corePeer, coreVersion),
      `${integrationName} peer range ${corePeer} must accept @ukladjs/core@${coreVersion}`,
    );
  }

  for (const releaseSurface of ['README.md', 'CHANGELOG.md']) {
    const contents = fs.readFileSync(path.join(root, releaseSurface), 'utf8');
    for (const entry of release.packages) {
      assert(
        contents.includes(`${entry.name}@${entry.version}`),
        `${releaseSurface} is missing ${entry.name}@${entry.version}`,
      );
    }
  }

  const mcpPin = `--package=@ukladjs/devtools-mcp@${mcpVersion}`;
  for (const template of [
    'packages/core/templates/agent/codex-config.toml',
    'packages/core/templates/agent/mcp.json',
  ]) {
    assert(fs.readFileSync(path.join(root, template), 'utf8').includes(mcpPin), `${template} has a stale MCP pin`);
  }
}

function runNpm(args) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const command = process.argv[2] ?? 'check';
validateRelease();

if (command === 'check') {
  console.log(`release metadata ok: ${release.id}`);
} else if (command === 'pack') {
  for (const entry of release.packages.filter((candidate) => candidate.publish)) {
    runNpm(['pack', '--dry-run', '--json', `./${entry.path}`]);
  }
  console.log(`release tarballs ok: ${release.id}`);
} else if (command === 'publish') {
  assert(!process.env.CI, 'Refusing to publish from CI; publish from an authorized local machine only');
  assert(
    process.env.UKLAD_RELEASE_CONFIRM === release.id,
    `Set UKLAD_RELEASE_CONFIRM=${release.id} to publish`,
  );
  for (const entry of release.packages.filter((candidate) => candidate.publish)) {
    const args = ['publish', `./${entry.path}`, '--access', 'public', '--tag', entry.tag];
    runNpm(args);
  }
} else {
  throw new Error(`Unknown release command: ${command}`);
}
