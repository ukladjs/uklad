const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cliPath = path.join(__dirname, '../dist/agent-cli.mjs');
const startMarker = '<!-- uklad-agent:start -->';
const endMarker = '<!-- uklad-agent:end -->';
const temporaryRoots = [];

function createDirectory() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uklad-agent-test-')));
  temporaryRoots.push(directory);
  return directory;
}

function createPackage(directory, dependencies = { '@ukladjs/core': '^0.2.1' }) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ name: 'consumer', private: true, dependencies }, null, 2)}\n`,
  );
}

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [cliPath, 'init', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('uklad-agent init', () => {
  test('creates a short managed router in the nearest consuming package', () => {
    const root = createDirectory();
    createPackage(root);
    const nested = path.join(root, 'src', 'feature');
    fs.mkdirSync(nested, { recursive: true });

    const result = runCli(nested);

    expect(result.status).toBe(0);
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(startMarker);
    expect(agents).toContain('This project uses Uklad (`@ukladjs/core`)');
    expect(agents).toContain("Uklad Agent Toolkit's `uklad` skill");
    expect(agents).toContain('node_modules/@ukladjs/core/templates/agent/AGENTS.md');
    expect(agents).toContain(endMarker);
    expect(result.stdout).toContain(`Did create ${path.join(root, 'AGENTS.md')}`);
  });

  test('preserves existing instructions and updates only the managed section', () => {
    const root = createDirectory();
    createPackage(root);
    const agentsPath = path.join(root, 'AGENTS.md');
    fs.writeFileSync(agentsPath, '# Project instructions\n\nKeep this text.\n');

    const first = runCli(root);
    expect(first.status).toBe(0);
    const appended = fs.readFileSync(agentsPath, 'utf8');
    expect(appended).toMatch(/^# Project instructions\n\nKeep this text\.\n\n/);

    fs.writeFileSync(
      agentsPath,
      appended.replace(`${startMarker}\n## Uklad`, `${startMarker}\nOutdated generated text`),
    );
    const second = runCli(root);

    expect(second.status).toBe(0);
    const updated = fs.readFileSync(agentsPath, 'utf8');
    expect(updated).toContain('# Project instructions\n\nKeep this text.');
    expect(updated).not.toContain('Outdated generated text');
    expect(updated.match(new RegExp(startMarker, 'g'))).toHaveLength(1);
  });

  test('is idempotent once the managed router is current', () => {
    const root = createDirectory();
    createPackage(root);
    expect(runCli(root).status).toBe(0);
    const agentsPath = path.join(root, 'AGENTS.md');
    const before = fs.readFileSync(agentsPath, 'utf8');

    const result = runCli(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No managed Uklad changes needed');
    expect(fs.readFileSync(agentsPath, 'utf8')).toBe(before);
  });

  test('supports dry runs without creating or changing a file', () => {
    const root = createDirectory();
    createPackage(root);
    const agentsPath = path.join(root, 'AGENTS.md');

    const result = runCli(root, ['--dry-run']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Would create ${agentsPath}`);
    expect(fs.existsSync(agentsPath)).toBe(false);
  });

  test('removes only managed guidance and deletes a managed-only file', () => {
    const root = createDirectory();
    createPackage(root);
    const agentsPath = path.join(root, 'AGENTS.md');
    fs.writeFileSync(agentsPath, '# Project instructions\n\nKeep this text.\n');
    expect(runCli(root).status).toBe(0);

    const removeFromExisting = runCli(root, ['--remove']);

    expect(removeFromExisting.status).toBe(0);
    expect(fs.readFileSync(agentsPath, 'utf8')).toBe('# Project instructions\n\nKeep this text.\n');

    fs.unlinkSync(agentsPath);
    expect(runCli(root).status).toBe(0);
    const removeManagedOnly = runCli(root, ['--remove']);

    expect(removeManagedOnly.status).toBe(0);
    expect(removeManagedOnly.stdout).toContain('because it contained only managed Uklad guidance');
    expect(fs.existsSync(agentsPath)).toBe(false);
  });

  test('targets an explicit workspace package', () => {
    const workspace = createDirectory();
    createPackage(workspace, {});
    const app = path.join(workspace, 'packages', 'app');
    createPackage(app);

    const result = runCli(workspace, ['--root', 'packages/app']);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(app, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspace, 'AGENTS.md'))).toBe(false);
  });

  test('requires a direct core dependency for initialization', () => {
    const root = createDirectory();
    createPackage(root, {});

    const result = runCli(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not directly declare @ukladjs/core');
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false);
  });

  test('refuses unmanaged Uklad guidance and malformed managed markers', () => {
    const root = createDirectory();
    createPackage(root);
    const agentsPath = path.join(root, 'AGENTS.md');
    const unmanaged = '## Uklad\n\nKeep this custom guidance.\n';
    fs.writeFileSync(agentsPath, unmanaged);

    const unmanagedResult = runCli(root);
    expect(unmanagedResult.status).toBe(1);
    expect(unmanagedResult.stderr).toContain('already contains unmanaged Uklad guidance');
    expect(fs.readFileSync(agentsPath, 'utf8')).toBe(unmanaged);

    const malformed = `${startMarker}\nIncomplete section.\n`;
    fs.writeFileSync(agentsPath, malformed);
    const malformedResult = runCli(root);
    expect(malformedResult.status).toBe(1);
    expect(malformedResult.stderr).toContain('duplicate or incomplete Uklad management markers');
    expect(fs.readFileSync(agentsPath, 'utf8')).toBe(malformed);
  });

  test('refuses to follow an AGENTS.md symbolic link', () => {
    if (process.platform === 'win32') return;

    const root = createDirectory();
    createPackage(root);
    const targetPath = path.join(root, 'shared-instructions.md');
    const agentsPath = path.join(root, 'AGENTS.md');
    fs.writeFileSync(targetPath, '# Shared instructions\n');
    fs.symlinkSync(targetPath, agentsPath);

    const result = runCli(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to modify symbolic link');
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('# Shared instructions\n');
  });
});
