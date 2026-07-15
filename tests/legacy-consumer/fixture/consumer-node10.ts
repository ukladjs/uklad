// Consumer for old-style projects: `moduleResolution: "node"` + CommonJS
// (webpack 4 / ts-loader era). This resolution mode ignores `exports` and
// reads the top-level `types` field, so it guards dist/index.d.mts staying
// consumable there. Must compile under TypeScript 4.9.
import {
  dispatch,
  getAppDb,
  initAppDb,
  regEffect,
  regEvent,
  regSub,
  useSubscription,
} from '@flexsurfer/reflex';

initAppDb({ count: 0 });
regEvent('legacy/node10', () => undefined);
regEffect('legacy/effect', (value: unknown) => {
  void value;
});
regSub('count');
dispatch(['legacy/node10']);

const count: number = useSubscription<number>(['count']);
const db = getAppDb();

void count;
void db;
