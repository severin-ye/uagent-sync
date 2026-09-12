import {createCodexProfileWithContext,planCodexProfileRestoreWithContext,restoreCodexProfileWithContext} from './codex-profile.js';
import {publishDevicePathsWithContext} from './device-git-transport.js';
import {beginM2Operation,type M2Provider} from './profile-m2-provider.js';

/** The host supplies a provider; ordinary operation options never select policy. */
export function createProfileOperations(provider?: M2Provider) {
  return Object.freeze({
    async create(options: Parameters<typeof createCodexProfileWithContext>[0]) { const session=await beginM2Operation(provider); return createCodexProfileWithContext(options,session); },
    async plan(options: Parameters<typeof planCodexProfileRestoreWithContext>[0]) { const session=await beginM2Operation(provider); return planCodexProfileRestoreWithContext(options,session); },
    async restore(options: Parameters<typeof restoreCodexProfileWithContext>[0]) { const session=await beginM2Operation(provider); return restoreCodexProfileWithContext(options,session); },
    async publish(registry:string,expectedRemote:string,relativePaths:string[]) { const session=await beginM2Operation(provider); return publishDevicePathsWithContext(registry,expectedRemote,relativePaths,session); }
  });
}
export type ProfileOperations = ReturnType<typeof createProfileOperations>;
