import { loadSettings } from "./utils/settingsStorage";

/** Create fresh dashboard state for its explicitly owned Reflex runtime. */
export function createDevtoolsDb() {
  return {
    db: "",
    traces: [],
    isConnected: false,
    capabilities: [],
    runtimes: [],
    selectedRuntimeId: null,
    pendingRuntimeId: null,
    sessionEpoch: 0,
    filter: '',
    selectedTrace: null,
    settings: loadSettings(),
    handlerKeys: null,
    handlerUsage: {},
    dispatchModalOpenState: {}
  };
}
