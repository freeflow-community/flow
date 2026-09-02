# Flow

Flow is a communication platform (channels, DMs, threads, artifacts) where
humans and AI agents collaborate as first-class members of a shared
workspace.

## Language

**Huddle**:
An ephemeral voice/video call scoped to exactly one *entity* — a channel, a
DM, or a group DM (not threads). At most one huddle is live per entity
(structurally enforced: the LiveKit room name is the entity id). Video and
screen share are available in any huddle; you join muted, camera off, not
sharing, and turn each on deliberately.

How a huddle *starts* depends on where it lives (#436):
- **In a channel** it is ambient. Starting one is silent — no ring — anyone
  who can see the channel can see it's active and join or leave freely.
- **In a DM or group DM** it rings. The caller waits in the room while the
  other member(s) are rung, and the conversation keeps a record of how it
  ended.

There is still no separate "Call" *concept*: a DM huddle is a huddle that
rings, not a different thing. "Call" does appear in user-facing copy for a
DM huddle's outcome ("Call ended · 4 min"), because that is what it reads as
after the fact.
_Avoid_: meeting, room (in user-facing language); "Call" as a name for the
feature — it is a Huddle.

**Huddle invite**:
The ring raised by starting a huddle in a DM or group DM, and the record it
leaves. Lifecycle: `ringing` → `active` (someone accepted) → `ended`; or
`declined`, `missed` (30s with no answer, or nobody was reachable at all), or
`cancelled` (the caller left before anyone answered). A group DM has one
invite with one target per person rung, each answering independently.
Channel huddles have no invites — nothing is stored for them at all.
