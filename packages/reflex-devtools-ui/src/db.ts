import { initAppDb } from "@flexsurfer/reflex";
import { loadSettings } from "./utils/settingsStorage";

initAppDb({
    db: "",
    traces: [],
    isConnected: false,
    capabilities: [],
    filter: '',
    selectedTrace: null,
    settings: loadSettings(),
    handlerKeys: null,
    handlerUsage: {},
    dispatchModalOpenState: {}
});
