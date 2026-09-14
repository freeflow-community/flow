# iOS can invite people to the workspace

- `[ios]` New **Invite People…** item in the drawer's workspace menu, opening an
  invite sheet — the phone had no invite surface at all until now (#283).
- `[ios]` The sheet mints a per-address invite link (Copy + share sheet) and,
  for owners/admins, manages the workspace join link: create, regenerate,
  revoke (#85's iOS half, which was blocked on there being no sheet to host it).
- `[ios]` Non-admins never see the join-link section — the server's 403 decides,
  so no buttons are offered that would all fail.
- `[qa]` `InviteTests` XCUITest covers both halves plus the non-admin case.

## Feature

- **Invite people from your phone.** iOS can now create an invite link for
  someone's email address and share it straight from the share sheet. Workspace
  owners and admins can also create, regenerate or revoke the workspace's join
  link there.
