# Huddle voice runs through the bot's own Claude or Codex runtime

- `[bridge]` flow-agent-bridge 0.32.0 — replace the OpenAI Realtime session
  with LiveKit Inference STT/TTS feeding the bot's existing CLI runtime, so a
  spoken request runs with the same tools, permissions and login as a chat
  turn and no longer needs `OPENAI_API_KEY`.
- `[bridge]` Keep call turns inside the Huddle instead of mirroring them into
  the DM, and abort the running turn when the caller interrupts.
- `[server]` Return a short-lived `inference.perform`-only LiveKit token when
  an agent accepts a Huddle invite — the project secret stays server-side and
  human clients never receive it. The new bridge requires this server.
- `[qa]` Cover the inference-token grant, interruption, and the new STT/TTS
  voice defaults.
