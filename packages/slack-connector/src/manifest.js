// This is the executable scope manifest: OAuth and capability checks consume it.
//
// `requested: false` marks capabilities whose scopes the app does not carry
// yet. They are not put in the authorize URL (Slack refuses a scope the app
// is not configured for), so they stay `unavailable` with a reason until the
// operator adds the scope to the app and flips them to requested. The clients
// read `grantedCapabilities` and never guess.
export const capabilities = {
  identity: { methods: ['auth.test'], tokenType: 'user', scopes: [], events: [] },
  sendAsUser: { methods: ['chat.postMessage', 'chat.update', 'chat.delete'], tokenType: 'user', scopes: ['chat:write'], events: [] },
  // Read baseline (#544 measurement, #545 adapter).
  readConversations: { methods: ['users.conversations', 'conversations.list', 'conversations.info', 'users.list'], tokenType: 'user', scopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read', 'users:read'], events: [] },
  readHistory: { methods: ['conversations.history', 'conversations.replies'], tokenType: 'user', scopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history'], events: [] },
  // Live chat events through the Events API. The app must subscribe to these
  // user events (operator step); the scopes are the history scopes above.
  liveUpdates: { methods: [], tokenType: 'user', scopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history'], events: ['message.channels', 'message.groups', 'message.im', 'message.mpim'] },
  lifecycle: { methods: [], tokenType: 'user', scopes: [], events: ['tokens_revoked', 'app_uninstalled'] },
  // Not granted to the test app yet (#544 §6): kept out of the authorize URL.
  reactions: { methods: ['reactions.add', 'reactions.remove'], tokenType: 'user', scopes: ['reactions:write', 'reactions:read'], events: ['reaction_added', 'reaction_removed'], requested: false },
  readState: { methods: ['conversations.mark'], tokenType: 'user', scopes: ['channels:write', 'groups:write', 'im:write', 'mpim:write'], events: [], requested: false },
  search: { methods: ['search.messages'], tokenType: 'user', scopes: ['search:read'], events: [], requested: false },
  files: { methods: ['files.getUploadURLExternal', 'files.completeUploadExternal'], tokenType: 'user', scopes: ['files:write', 'files:read'], events: [], requested: false },
};
export const requestedScopes = [...new Set(Object.values(capabilities).filter(c => c.requested !== false).flatMap(c => c.scopes))];
export const requestedEvents = [...new Set(Object.values(capabilities).filter(c => c.requested !== false).flatMap(c => c.events))];
export function grantedCapabilities(scopes) {
  return Object.fromEntries(Object.entries(capabilities).map(([name, c]) => [name, c.scopes.every(scope => scopes.includes(scope))]));
}
