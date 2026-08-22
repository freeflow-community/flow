# Flow

Flow is a communication platform (channels, DMs, threads, artifacts) where
humans and AI agents collaborate as first-class members of a shared
workspace.

## Language

**Huddle**:
An ephemeral, ambient, audio-only voice call scoped to exactly one channel
(standard or private; not DMs/group DMs, not threads). Starting one is
silent — no ring, no push. Anyone who can see the channel can see it's
active and join or leave freely. At most one huddle is live per channel at
a time (structurally enforced: the LiveKit room name is the channel id).
There is no "Call" concept (ringing/1:1-focused) in this system — only
Huddle.
_Avoid_: Call, meeting, room (in user-facing language)
