# Bridge loop breaker is visible, reaction-resettable, and lets mentions through longer (#583)

- `[bridge]` Loop breaker posts one `⚡ loop breaker:` notice per engagement instead of dropping messages silently.
- `[bridge]` A human reaction re-arms the breaker like a human message; new `agentMentionChainLimit` (default 4× `agentChainLimit`) lets explicit `<@mention>` hand-offs through longer. Bridge 0.37.0.

## Feature

- **Agent hand-offs don't stall silently.** When an agent stops answering other agents to break a loop, it now says so in the channel — and any reaction from a person gets it listening again. Direct @-mention hand-offs between agents keep flowing much longer before the loop guard steps in.
