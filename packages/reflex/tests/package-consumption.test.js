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
  'NOW',
  'RANDOM',
  'clearGlobalInterceptors',
  'clearHandlers',
  'clearHotReloadCallbacks',
  'clearSubs',
  'clearSubscriptionCache',
  'createReflexInspector',
  'current',
  'debounceAndDispatch',
  'defaultErrorHandler',
  'dispatch',
  'dispatchSync',
  'disableTracing',
  'enableMapSet',
  'enableTracePrint',
  'enableTracing',
  'getAppDb',
  'getGlobalEqualityCheck',
  'getGlobalInterceptors',
  'getHandler',
  'getHandlers',
  'getSubscriptionDiagnostics',
  'getSubscriptionValue',
  'initAppDb',
  'original',
  'regCoeffect',
  'regEvent',
  'regEventErrorHandler',
  'regEffect',
  'regGlobalInterceptor',
  'regSub',
  'registerHotReloadCallback',
  'registerTraceCallback',
  'registerTraceCb',
  'removeTraceCallback',
  'removeTraceCb',
  'setGlobalEqualityCheck',
  'setupSubsHotReload',
  'shallowEqual',
  'throttleAndDispatch',
  'triggerHotReload',
  'useHotReload',
  'useHotReloadKey',
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

    expect(fs.existsSync(path.join(distDir, 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'index.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'index.d.mts'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'index.d.cts'))).toBe(true);
  });

  test('Package.json has correct exports', () => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(packageJson.main).toBe('dist/index.cjs');
    expect(packageJson.module).toBe('dist/index.mjs');
    expect(packageJson.types).toBe('dist/index.d.mts');
    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports.import).toBeDefined();
    expect(packageJson.exports.require).toEqual({
      types: './dist/index.d.cts',
      default: './dist/index.cjs',
    });
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

  test('CommonJS build can be required', () => {
    const distDir = path.join(__dirname, '../dist');
    const api = require(path.join(distDir, 'index.cjs'));
    expect(Object.keys(api).sort()).toEqual(expectedRuntimeExports);
    removedLegacyExports.forEach((name) => {
      expect(api).not.toHaveProperty(name);
    });
  });

  test('Node with unset NODE_ENV warns when CJS and ESM initialize separate runtimes', () => {
    const warnings = loadBothModuleFormatsWithNodeEnv(undefined);
    expect(warnings).toEqual([
      expect.stringContaining('Multiple Reflex runtimes detected in the same JavaScript realm'),
    ]);
  });

  test('Development warns when CJS and ESM initialize separate runtimes', () => {
    const warnings = loadBothModuleFormatsWithNodeEnv('development');
    expect(warnings).toEqual([
      expect.stringContaining('Multiple Reflex runtimes detected in the same JavaScript realm'),
    ]);
  });

  test('Production stays silent when CJS and ESM initialize separate runtimes', () => {
    expect(loadBothModuleFormatsWithNodeEnv('production')).toEqual([]);
  });

  test('TypeScript definitions exist', () => {
    const distDir = path.join(__dirname, '../dist');
    const dtsFile = fs.readFileSync(path.join(distDir, 'index.d.mts'), 'utf8');
    const dctsFile = fs.readFileSync(path.join(distDir, 'index.d.cts'), 'utf8');

    expect(dtsFile).toContain('interface SubscriptionDiagnostic');
    expect(dtsFile).toContain('interface EventRegistrationOptions');
    expect(dtsFile).toContain('interface ReflexInspector');
    expect(dctsFile).toContain('interface EventRegistrationOptions');
    expect(dctsFile).toContain('interface ReflexInspector');
    removedLegacyExports.forEach((name) => {
      expect(dtsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
      expect(dctsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
    });
  });
});
