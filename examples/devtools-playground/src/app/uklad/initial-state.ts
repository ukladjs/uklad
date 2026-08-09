import {
  createCollectionsPermissions,
  createCollectionsRoles,
  createCollectionsUserPermissions,
  createCollectionsUsers,
} from '../../features/collections/state';
import { createCounterEffectDispatches, createCounterValue } from '../../features/counter/state';
import {
  createDiagnosticsComplex,
  createDiagnosticsImmerProbe,
  createDiagnosticsNested,
  createDiagnosticsPayload,
} from '../../features/diagnostics/state';
import {
  createLoadingServerQuery,
  createServerItems,
  createServerRegion,
} from '../../features/server/state';
import type { ServerClock, ServerRegionSummary } from '../../features/server/state';
import { createUsersList, createUsersLoading } from '../../features/users/state';
import { stateKeys } from './catalog';
import type { AppState } from './contracts';

/**
 * Compose the feature-owned initial root values into one application state.
 *
 * A fresh object per call, so the browser runtime and the headless runtime
 * each own their own state rather than sharing a module-level literal.
 */
export function createInitialState(): AppState {
  return {
    [stateKeys.counterValue]: createCounterValue(),
    [stateKeys.counterEffectDispatches]: createCounterEffectDispatches(),

    [stateKeys.usersList]: createUsersList(),
    [stateKeys.usersLoading]: createUsersLoading(),

    [stateKeys.serverClock]: createLoadingServerQuery<ServerClock>(),
    [stateKeys.serverItems]: createServerItems(),
    [stateKeys.serverRegion]: createServerRegion(),
    [stateKeys.serverRegionSummary]: createLoadingServerQuery<ServerRegionSummary>(),

    [stateKeys.collectionsUsers]: createCollectionsUsers(),
    [stateKeys.collectionsPermissions]: createCollectionsPermissions(),
    [stateKeys.collectionsRoles]: createCollectionsRoles(),
    [stateKeys.collectionsUserPermissions]: createCollectionsUserPermissions(),

    [stateKeys.diagnosticsNested]: createDiagnosticsNested(),
    [stateKeys.diagnosticsPayload]: createDiagnosticsPayload(),
    [stateKeys.diagnosticsImmerProbe]: createDiagnosticsImmerProbe(),
    [stateKeys.diagnosticsComplex]: createDiagnosticsComplex(),
  };
}
