# Bridge: mechanical agent-loop guards

- `[bridge]` Two new config knobs stop agent↔agent ping-pong that
  instructions alone couldn't: `agentMentionsOnly` (an agent-authored
  message must `<@mention>` me to trigger a run, even in DMs) and
  `agentChainLimit` (default 6 — after that many consecutive agent-authored
  messages in a channel with no human, the bridge stops responding there
  until a human speaks; 0 disables). Version 0.23.0.
