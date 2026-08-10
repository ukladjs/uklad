import { loadSettings } from "./utils/settingsStorage";

/** Create fresh dashboard state for its explicitly owned Uklad runtime. */
export function createDevtoolsState() {
  return {
    state: "",
    traces: [],
    isConnected: false,
    capabilities: [],
    runtimes: [],
    selectedRuntimeId: null,
    pendingRuntimeId: null,
    sessionEpoch: 0,
    stateRevisions: null,
    filter: '',
    selectedTrace: null,
    settings: loadSettings(),
    handlerKeys: null,
    handlerUsage: {},
    dispatchModalOpenState: {}
  };
}
