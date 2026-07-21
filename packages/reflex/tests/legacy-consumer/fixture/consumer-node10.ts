// Consumer for old-style projects: `moduleResolution: "node"` + CommonJS
// (webpack 4 / ts-loader era). This resolution mode ignores `exports` and
// reads the top-level `types` field, so it guards dist/index.d.mts staying
// consumable there. Must compile under TypeScript 4.9.
import { createReflexRuntime, useSubscription } from '@flexsurfer/reflex';

const runtime = createReflexRuntime({ initialDb: { count: 0 } });
runtime.regEvent('legacy/node10', () => undefined);
runtime.regEffect('legacy/effect', (value: unknown) => {
  void value;
});
runtime.regSub('count');
runtime.dispatch(['legacy/node10']);

const count: number = useSubscription<number>(['count']);
const db = runtime.getAppDb();

void count;
void db;
