const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

// One explicit runtime API manifest. Comparing actual module keys catches both
// accidental removals and accidental additions to the package root.
const expectedRuntimeExports = [
  'DISPATCH',
  'DISPATCH_LATER',
  'HotReloadWrapper',
  'clearHotReloadCallbacks',
  'createUkladHooks',
  'createUkladRuntime',
  'current',
  'enableMapSet',
  'isRegistrationCollisionError',
  'original',
  'UkladProvider',
  'registerHotReloadCallback',
  'setupSubsHotReload',
  'shallowEqual',
  'triggerHotReload',
  'useHotReload',
  'useHotReloadKey',
  'useUkladRuntime',
  'useSubscription',
].sort();
const expectedVanillaRuntimeExports = [
  'DISPATCH',
  'DISPATCH_LATER',
  'createUkladRuntime',
  'current',
  'enableMapSet',
  'isRegistrationCollisionError',
  'original',
  'shallowEqual',
].sort();
const expectedReactRuntimeExports = [
  'HotReloadWrapper',
  'UkladProvider',
  'clearHotReloadCallbacks',
  'createUkladHooks',
  'registerHotReloadCallback',
  'setupSubsHotReload',
  'triggerHotReload',
  'useHotReload',
  'useHotReloadKey',
  'useUkladRuntime',
  'useSubscription',
].sort();
const removedLegacyExports = [
  'Reaction',
  'ReactionEngine',
  'getReactions',
  'getReactionEngine',
  'setReactionEngine',
  'createReactionEngine',
  'selectReactionEngine',
  'resetReactionEngine',
  'clearReactions',
];

function loadBothModuleFormatsWithNodeEnv(nodeEnv) {
  const distDir = path.join(__dirname, '../dist');
  const moduleUrl = pathToFileURL(path.join(distDir, 'index.mjs')).href;
  const commonJsPath = path.join(distDir, 'index.cjs');
  const script = `
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    const { createRequire } = await import('node:module');
    createRequire(import.meta.url)(${JSON.stringify(commonJsPath)});
    await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify(warnings));
  `;
  const env = { ...process.env };
  if (nodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = nodeEnv;
  }
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env,
    }),
  );
}

describe('Package Consumption Tests', () => {
  test('Built package files exist', () => {
    const distDir = path.join(__dirname, '../dist');

    for (const entrypoint of ['index', 'vanilla', 'react', 'devtools', 'testing', 'internal']) {
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.mjs`))).toBe(true);
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.cjs`))).toBe(true);
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.d.mts`))).toBe(true);
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.d.cts`))).toBe(true);
    }
    expect(fs.readFileSync(path.join(distDir, 'agent-cli.mjs'), 'utf8')).toMatch(
      /^#!\/usr\/bin\/env node/,
    );
  });

  test('Package.json has correct exports', () => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(packageJson.main).toBe('dist/index.cjs');
    expect(packageJson.module).toBe('dist/index.mjs');
    expect(packageJson.types).toBe('dist/index.d.mts');
    expect(packageJson.bin).toEqual({ 'uklad-agent': 'dist/agent-cli.mjs' });
    expect(packageJson.exports).toEqual({
      '.': {
        import: {
          types: './dist/index.d.mts',
          default: './dist/index.mjs',
        },
        require: {
          types: './dist/index.d.cts',
          default: './dist/index.cjs',
        },
      },
      './vanilla': {
        import: {
          types: './dist/vanilla.d.mts',
          default: './dist/vanilla.mjs',
        },
        require: {
          types: './dist/vanilla.d.cts',
          default: './dist/vanilla.cjs',
        },
      },
      './react': {
        import: {
          types: './dist/react.d.mts',
          default: './dist/react.mjs',
        },
        require: {
          types: './dist/react.d.cts',
          default: './dist/react.cjs',
        },
      },
      './devtools': {
        import: {
          types: './dist/devtools.d.mts',
          default: './dist/devtools.mjs',
        },
        require: {
          types: './dist/devtools.d.cts',
          default: './dist/devtools.cjs',
        },
      },
      './testing': {
        import: {
          types: './dist/testing.d.mts',
          default: './dist/testing.mjs',
        },
        require: {
          types: './dist/testing.d.cts',
          default: './dist/testing.cjs',
        },
      },
      './internal': {
        import: {
          types: './dist/internal.d.mts',
          default: './dist/internal.mjs',
        },
        require: {
          types: './dist/internal.d.cts',
          default: './dist/internal.cjs',
        },
      },
    });
    expect(packageJson.files).not.toContain('docs');
    expect(packageJson.peerDependenciesMeta).toEqual({ react: { optional: true } });
  });

  test('ESM build can be imported', () => {
    const distDir = path.join(__dirname, '../dist');
    const moduleUrl = pathToFileURL(path.join(distDir, 'index.mjs')).href;
    const script = `import * as api from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(Object.keys(api).sort()));`;
    const exportedKeys = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        encoding: 'utf8',
      }),
    );

    expect(exportedKeys).toEqual(expectedRuntimeExports);
  });

  test('ESM subpath builds can be imported without creating an application runtime', () => {
    const distDir = path.join(__dirname, '../dist');
    const indexUrl = pathToFileURL(path.join(distDir, 'index.mjs')).href;
    const vanillaUrl = pathToFileURL(path.join(distDir, 'vanilla.mjs')).href;
    const reactUrl = pathToFileURL(path.join(distDir, 'react.mjs')).href;
    const devtoolsUrl = pathToFileURL(path.join(distDir, 'devtools.mjs')).href;
    const testingUrl = pathToFileURL(path.join(distDir, 'testing.mjs')).href;
    const script = `
      const root = await import(${JSON.stringify(indexUrl)});
      const vanilla = await import(${JSON.stringify(vanillaUrl)});
      const react = await import(${JSON.stringify(reactUrl)});
      const devtools = await import(${JSON.stringify(devtoolsUrl)});
      const testing = await import(${JSON.stringify(testingUrl)});
      process.stdout.write(JSON.stringify({
        vanillaKeys: Object.keys(vanilla).sort(),
        reactKeys: Object.keys(react).sort(),
        sameProvider: root.UkladProvider === react.UkladProvider,
        devtoolsKeys: Object.keys(devtools).sort(),
        testingKeys: Object.keys(testing).sort(),
      }));
    `;
    const result = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        encoding: 'utf8',
      }),
    );

    expect(result).toEqual({
      vanillaKeys: expectedVanillaRuntimeExports,
      reactKeys: expectedReactRuntimeExports,
      sameProvider: true,
      devtoolsKeys: ['createUkladInspector'],
      testingKeys: ['createUkladHeadlessScenario', 'createUkladTestHarness'],
    });
  });

  test('CommonJS build can be required', () => {
    const distDir = path.join(__dirname, '../dist');
    const api = require(path.join(distDir, 'index.cjs'));
    expect(Object.keys(api).sort()).toEqual(expectedRuntimeExports);
    removedLegacyExports.forEach((name) => {
      expect(api).not.toHaveProperty(name);
    });
  });

  test('CommonJS subpath builds can be required without creating an application runtime', () => {
    const distDir = path.join(__dirname, '../dist');
    const root = require(path.join(distDir, 'index.cjs'));
    const vanilla = require(path.join(distDir, 'vanilla.cjs'));
    const react = require(path.join(distDir, 'react.cjs'));
    const devtools = require(path.join(distDir, 'devtools.cjs'));
    const testing = require(path.join(distDir, 'testing.cjs'));

    expect(Object.keys(vanilla).sort()).toEqual(expectedVanillaRuntimeExports);
    expect(Object.keys(react).sort()).toEqual(expectedReactRuntimeExports);
    expect(root.UkladProvider).toBe(react.UkladProvider);
    expect(Object.keys(devtools).sort()).toEqual(['createUkladInspector']);
    expect(Object.keys(testing).sort()).toEqual([
      'createUkladHeadlessScenario',
      'createUkladTestHarness',
    ]);
  });

  test('Node with unset NODE_ENV warns when CJS and ESM initialize separate runtimes', () => {
    const warnings = loadBothModuleFormatsWithNodeEnv(undefined);
    expect(warnings).toEqual([
      expect.stringContaining(
        'Multiple copies of @ukladjs/core detected in the same JavaScript realm',
      ),
    ]);
  });

  test('Development warns when CJS and ESM initialize separate runtimes', () => {
    const warnings = loadBothModuleFormatsWithNodeEnv('development');
    expect(warnings).toEqual([
      expect.stringContaining(
        'Multiple copies of @ukladjs/core detected in the same JavaScript realm',
      ),
    ]);
  });

  test('Production stays silent when CJS and ESM initialize separate runtimes', () => {
    expect(loadBothModuleFormatsWithNodeEnv('production')).toEqual([]);
  });

  test('TypeScript definitions exist', () => {
    const distDir = path.join(__dirname, '../dist');
    const dtsFile = fs.readFileSync(path.join(distDir, 'index.d.mts'), 'utf8');
    const dctsFile = fs.readFileSync(path.join(distDir, 'index.d.cts'), 'utf8');
    const vanillaDtsFile = fs.readFileSync(path.join(distDir, 'vanilla.d.mts'), 'utf8');
    const reactDtsFile = fs.readFileSync(path.join(distDir, 'react.d.mts'), 'utf8');
    const allDts = fs
      .readdirSync(distDir)
      .filter((file) => file.endsWith('.d.mts'))
      .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
      .join('\n');
    const allDcts = fs
      .readdirSync(distDir)
      .filter((file) => file.endsWith('.d.cts'))
      .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
      .join('\n');

    expect(allDts).toContain('interface SubscriptionDiagnostic');
    expect(allDts).toContain('interface EventRegistrationOptions');
    expect(allDts).toContain('interface UkladInspector');
    expect(allDcts).toContain('interface EventRegistrationOptions');
    expect(allDcts).toContain('interface UkladInspector');
    expect(vanillaDtsFile).toContain('createUkladRuntime');
    expect(reactDtsFile).toContain('UkladProvider');
    removedLegacyExports.forEach((name) => {
      expect(dtsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
      expect(dctsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
    });
  });
});
