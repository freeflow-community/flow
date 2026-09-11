// This is the executable scope manifest: OAuth and capability checks consume it.
export const capabilities = {
  identity: { methods: ['auth.test'], tokenType: 'user', scopes: [], events: [] },
  sendAsUser: { methods: ['chat.postMessage'], tokenType: 'user', scopes: ['chat:write'], events: [] },
  lifecycle: { methods: [], tokenType: 'user', scopes: [], events: ['tokens_revoked', 'app_uninstalled'] },
};
export const requestedScopes = [...new Set(Object.values(capabilities).flatMap(c => c.scopes))];
export function grantedCapabilities(scopes) {
  return Object.fromEntries(Object.entries(capabilities).map(([name, c]) => [name, c.scopes.every(scope => scopes.includes(scope))]));
}
