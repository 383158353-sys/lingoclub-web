import { createClient } from '@base44/sdk';
import { appParams, getStoredAccessToken } from '@/lib/app-params';

const { appId, functionsVersion, appBaseUrl } = appParams;

const createConfiguredClient = () => createClient({
  appId,
  token: getStoredAccessToken(),
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl,
});

// ES module imports are live bindings. Replacing this singleton after an
// expired token clears the SDK's in-memory Authorization header as well as the
// persisted token, without forcing a page reload.
export let base44 = createConfiguredClient();

export const resetBase44Client = () => {
  base44 = createConfiguredClient();
  return base44;
};
