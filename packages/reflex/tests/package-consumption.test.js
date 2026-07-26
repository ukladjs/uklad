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
  'createReflexHooks',
  'createReflexRuntime',
  'current',
  'enableMapSet',
  'original',
  'ReflexProvider',
  'registerHotReloadCallback',
  'setupSubsHotReload',
  'shallowEqual',
  'triggerHotReload',
  'useHotReload',
  'useHotReloadKey',
  'useReflexRuntime',
  'useSubscription',
].sort();
const expectedVanillaRuntimeExports = [
  'DISPATCH',
  'DISPATCH_LATER',
  'createReflexRuntime',
  'current',
  'enableMapSet',
  'original',
  'shallowEqual',
].sort();
const expectedReactRuntimeExports = [
  'HotReloadWrapper',
  'ReflexProvider',
  'clearHotReloadCallbacks',
  'createReflexHooks',
  'registerHotReloadCallback',
  'setupSubsHotReload',
  'triggerHotReload',
  'useHotReload',
  'useHotReloadKey',
  'useReflexRuntime',
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

    for (const entrypoint of ['index', 'vanilla', 'react']) {
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.mjs`))).toBe(true);
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.cjs`))).toBe(true);
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.d.mts`))).toBe(true);
      expect(fs.existsSync(path.join(distDir, `${entrypoint}.d.cts`))).toBe(true);
    }
  });

  test('Package.json has correct exports', () => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(packageJson.main).toBe('dist/index.cjs');
    expect(packageJson.module).toBe('dist/index.mjs');
    expect(packageJson.types).toBe('dist/index.d.mts');
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
    });
    expect(packageJson.files).toContain('docs');
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
    const script = `
      const root = await import(${JSON.stringify(indexUrl)});
      const vanilla = await import(${JSON.stringify(vanillaUrl)});
      const react = await import(${JSON.stringify(reactUrl)});
      process.stdout.write(JSON.stringify({
        vanillaKeys: Object.keys(vanilla).sort(),
        reactKeys: Object.keys(react).sort(),
        sameProvider: root.ReflexProvider === react.ReflexProvider,
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

    expect(Object.keys(vanilla).sort()).toEqual(expectedVanillaRuntimeExports);
    expect(Object.keys(react).sort()).toEqual(expectedReactRuntimeExports);
    expect(root.ReflexProvider).toBe(react.ReflexProvider);
  });

  test('Node with unset NODE_ENV warns when CJS and ESM initialize separate runtimes', () => {
    const warnings = loadBothModuleFormatsWithNodeEnv(undefined);
    expect(warnings).toEqual([
      expect.stringContaining(
        'Multiple copies of @flexsurfer/reflex detected in the same JavaScript realm',
      ),
    ]);
  });

  test('Development warns when CJS and ESM initialize separate runtimes', () => {
    const warnings = loadBothModuleFormatsWithNodeEnv('development');
    expect(warnings).toEqual([
      expect.stringContaining(
        'Multiple copies of @flexsurfer/reflex detected in the same JavaScript realm',
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
    expect(allDts).toContain('interface ReflexInspector');
    expect(allDcts).toContain('interface EventRegistrationOptions');
    expect(allDcts).toContain('interface ReflexInspector');
    expect(vanillaDtsFile).toContain('createReflexRuntime');
    expect(reactDtsFile).toContain('ReflexProvider');
    removedLegacyExports.forEach((name) => {
      expect(dtsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
      expect(dctsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
    });
  });
});
