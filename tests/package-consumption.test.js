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

  test('TypeScript definitions exist', () => {
    const distDir = path.join(__dirname, '../dist');
    const dtsFile = fs.readFileSync(path.join(distDir, 'index.d.mts'), 'utf8');
    const dctsFile = fs.readFileSync(path.join(distDir, 'index.d.cts'), 'utf8');

    expect(dtsFile).toContain('interface SubscriptionDiagnostic');
    expect(dtsFile).toContain('interface EventRegistrationOptions');
    expect(dctsFile).toContain('interface EventRegistrationOptions');
    removedLegacyExports.forEach((name) => {
      expect(dtsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
      expect(dctsFile).not.toMatch(new RegExp(`\\b${name}\\b`));
    });
  });
});
