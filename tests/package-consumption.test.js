const path = require('path');
const fs = require('fs');

// Expected API functions and constants (defined once to avoid duplication)
const expectedFunctions = [
  'initAppDb', 'getAppDb', 'dispatch',
  // Event functions
  'regEvent', 'regEventErrorHandler', 'defaultErrorHandler',
  // Subscription functions
  'regSub', 'getSubscriptionValue',
  // Effect functions
  'regEffect', 'regCoeffect',
  // Global interceptor functions
  'regGlobalInterceptor', 'getGlobalInterceptors', 'clearGlobalInterceptors',
  // Read-only subscription diagnostics
  'getSubscriptionDiagnostics',
  // Handler management
  'getHandler', 'clearHandlers', 'clearSubscriptionCache', 'clearSubs',
  // Debounce/throttle
  'debounceAndDispatch', 'throttleAndDispatch',
  // React hooks
  'useSubscription',
  // Hot reload functions
  'registerHotReloadCallback', 'triggerHotReload', 'clearHotReloadCallbacks',
  'useHotReload', 'useHotReloadKey', 'setupSubsHotReload', 'HotReloadWrapper',
  // Tracing functions
  'enableTracing', 'disableTracing', 'registerTraceCb', 'enableTracePrint',
  // Immer re-exports
  'original', 'current'
];

const expectedConstants = ['DISPATCH_LATER', 'DISPATCH', 'NOW', 'RANDOM'];
const removedLegacyExports = [
  'Reaction', 'ReactionEngine', 'getReactions', 'getReactionEngine',
  'setReactionEngine', 'createReactionEngine', 'selectReactionEngine',
  'resetReactionEngine', 'clearReactions'
];

describe('Package Consumption Tests', () => {
  test('Built package files exist', () => {
    const distDir = path.join(__dirname, '../dist');

    expect(fs.existsSync(path.join(distDir, 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'index.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'index.d.cts'))).toBe(true);
  });

  test('Package.json has correct exports', () => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(packageJson.main).toBe('dist/index.cjs');
    expect(packageJson.module).toBe('dist/index.mjs');
    expect(packageJson.types).toBe('dist/index.d.ts');
    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports.import).toBeDefined();
    expect(packageJson.exports.require).toBeDefined();
  });

  test('ESM build can be imported', () => {
    const distDir = path.join(__dirname, '../dist');
    const esmFile = fs.readFileSync(path.join(distDir, 'index.mjs'), 'utf8');

    // Check that the ESM build exports all expected functions
    expect(esmFile).toContain('export {');

    // Check all functions are exported
    expectedFunctions.forEach(func => {
      expect(esmFile).toContain(func);
    });

    // Check all constants are exported
    expectedConstants.forEach(constant => {
      expect(esmFile).toContain(constant);
    });
  });

  test('CommonJS build can be required', () => {
    const distDir = path.join(__dirname, '../dist');
    const cjsFile = fs.readFileSync(path.join(distDir, 'index.cjs'), 'utf8');

    // Check that the CommonJS build exports all expected functions
    expect(cjsFile).toContain('module.exports');

    // Check all functions are exported
    expectedFunctions.forEach(func => {
      expect(cjsFile).toContain(func);
    });

    // Check all constants are exported
    expectedConstants.forEach(constant => {
      expect(cjsFile).toContain(constant);
    });

    const api = require(path.join(distDir, 'index.cjs'));
    removedLegacyExports.forEach(name => {
      expect(api).not.toHaveProperty(name);
    });
  });

  test('TypeScript definitions exist', () => {
    const distDir = path.join(__dirname, '../dist');
    const dtsFile = fs.readFileSync(path.join(distDir, 'index.d.ts'), 'utf8');

    // Check that TypeScript definitions export all expected functions
    expect(dtsFile).toContain('declare function');

    // For TypeScript definitions, exclude Immer re-exports as they're handled separately
    const expectedFunctionsForTypes = expectedFunctions.filter(func => !['original', 'current'].includes(func));

    // Check all functions are declared
    expectedFunctionsForTypes.forEach(func => {
      expect(dtsFile).toContain(`declare function ${func}`);
    });

    // Check all constants are declared
    expectedConstants.forEach(constant => {
      expect(dtsFile).toContain(`declare const ${constant}`);
    });

    // Check that all expected exports are in the main export statement at the end
    // Find the main export statement (not the immer re-export)
    const exportMatches = dtsFile.match(/export\s*\{\s*([^}]+)\s*\};?\s*$/gm);
    const mainExportStatement = exportMatches[exportMatches.length - 1]; // Get the last export statement
    const exportedItems = mainExportStatement
      .replace(/export\s*\{\s*/, '')
      .replace(/\s*\};?\s*$/, '')
      .split(',')
      .map(item => item.trim());

    expectedFunctionsForTypes.concat(expectedConstants).forEach(item => {
      expect(exportedItems).toContain(item);
    });
    expect(dtsFile).toContain('interface SubscriptionDiagnostic');
    removedLegacyExports.forEach(name => {
      expect(exportedItems).not.toContain(name);
    });
  });
});
