# Agent bridge: list_users includes each member's email (#488)

- `[bridge]` `list_users` now prints each member's email on their line
  (`<userId>  <name> 🤖  <email>  [role] — <status>`), so an agent asked to
  email a colleague no longer has to call the members API with its raw token.
- `[bridge]` Tool description says emails are included; agents' synthetic
  `…@agents.flow.local` / `…@apps.flow.local` addresses print unfiltered.
