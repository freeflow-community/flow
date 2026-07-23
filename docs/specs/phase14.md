# Signed macOS distribution

Automate producing a signed, notarized, distributable macOS build of Flow.app
so a non-technical user can download, drag to /Applications, and open with no
Gatekeeper warnings. Everything after the one-time credential setup is a single
non-interactive command.

## Scope

A new `apps/macos/tools/dist.sh` that takes the existing SwiftPM build, signs it
with a Developer ID Application certificate under the hardened runtime,
notarizes it with Apple, staples the ticket, and packages a DMG. No secrets in
the repo. Runs the same locally and in CI. `[macos]`

Out of scope for this phase: auto-update (Sparkle), TestFlight/App Store
submission, App Store sandbox entitlements, a download/landing page.

---

## 1. Background — why the current build won't distribute

`make-app.sh` wraps the SwiftPM executable in a minimal `Flow.app` and signs it
either with the self-signed **"MyChat Dev Signing"** identity or ad-hoc
(`codesign -s -`). Both are fine on the build machine but rejected by Gatekeeper
on any other Mac ("Flow is damaged and can't be opened" / "unidentified
developer"), because the signature is not from an Apple-issued **Developer ID**
and the app is not notarized.

The fix is the standard Apple distribution chain: Developer ID signature +
hardened runtime + notarization + stapled ticket. That chain is fully scriptable
and non-interactive; the manual right-click-to-open path is the thing we are
eliminating.

---

## 2. One-time prerequisites (manual, done once)

Not automated — these are account/keychain setup, not per-release steps.

1. **Apple Developer account** ($99/yr) with a **Developer ID Application**
   certificate created and installed in the login keychain. Verify:
   ```
   security find-identity -p codesigning -v | grep "Developer ID Application"
   ```
2. **Notarization credentials stored in a keychain profile** so the script
   holds no secrets:
   ```
   xcrun notarytool store-credentials "flow-notary" \
     --apple-id you@example.com --team-id TEAMID --password <app-specific-pw>
   ```
   App-specific password from appleid.apple.com, or an App Store Connect API key
   (`--key`/`--key-id`/`--issuer`) — either is accepted. After this the script
   only references the profile name.

Configuration passed to the script via environment (no defaults committed that
would leak an identity):

| Variable | Meaning | Example |
|---|---|---|
| `FLOW_SIGN_IDENTITY` | Developer ID Application identity | `Developer ID Application: Jane Doe (AB12CD34EF)` |
| `FLOW_NOTARY_PROFILE` | notarytool keychain profile name | `flow-notary` |
| `FLOW_SERVER_URL` | server the build points at (existing var) | `https://app.flowtoo.org` |

If either signing variable is unset, the script exits non-zero with a message
pointing at §2 — it never silently falls back to ad-hoc (that would ship an
un-notarizable app).

---

## 3. Pipeline (per release, one command)

`dist.sh` runs these steps in order; any non-zero step aborts the whole run.

1. **Release build + bundle.** Reuse `make-app.sh release` to produce
   `dist/Flow.app` (release config, production `FlowServerURL`). Do not
   duplicate bundle assembly — `dist.sh` calls the existing script so the two
   never drift.
2. **Sign, hardened runtime, secure timestamp.** Sign nested code first if any
   is added later, then the bundle:
   ```
   codesign --force --options runtime --timestamp \
     --entitlements <entitlements.plist> \
     -s "$FLOW_SIGN_IDENTITY" dist/Flow.app
   ```
   `--options runtime` is mandatory — notarization rejects a build without the
   hardened runtime. See §4 on entitlements.
3. **Verify the signature** before spending time uploading:
   ```
   codesign --verify --deep --strict --verbose=2 dist/Flow.app
   ```
4. **Zip for submission.** notarytool needs a container:
   ```
   ditto -c -k --keepParent dist/Flow.app dist/Flow.zip
   ```
5. **Notarize, blocking.** Uploads to Apple and waits for the verdict
   (typically 1–5 min, no interaction):
   ```
   xcrun notarytool submit dist/Flow.zip \
     --keychain-profile "$FLOW_NOTARY_PROFILE" --wait
   ```
   On rejection, fetch and print the log so failures are actionable:
   ```
   xcrun notarytool log <submission-id> --keychain-profile "$FLOW_NOTARY_PROFILE"
   ```
6. **Staple** the ticket onto the app so it validates offline:
   ```
   xcrun stapler staple dist/Flow.app
   ```
7. **Package the DMG** for hand-off:
   ```
   hdiutil create -volname Flow -srcfolder dist/Flow.app \
     -ov -format UDZO dist/Flow.dmg
   ```
   (Optionally a background image + /Applications symlink for drag-install; a
   plain read-only DMG is sufficient for v1.)
8. **Final gate check** — confirm the assessment a fresh Mac will make:
   ```
   spctl --assess --type execute --verbose dist/Flow.app   # expect "accepted, source=Notarized Developer ID"
   xcrun stapler validate dist/Flow.app
   ```

Output artifact: `dist/Flow.dmg` (stapled `dist/Flow.app` inside). The zip is an
intermediate and may be removed.

---

## 4. Entitlements

The app uses **Keychain** and **UserNotifications**; both work under the
hardened runtime with no special entitlements, so the expectation is a minimal
(possibly empty) entitlements plist. The first notarized build validates this
assumption — if notarization or runtime behavior flags a missing entitlement
(e.g. network client, or JIT/unsigned-memory, which Flow should not need), add
only the specific key required and re-run. Do **not** enable App Sandbox in this
phase (separate, larger effort with its own entitlement surface).

Store the entitlements file at `apps/macos/tools/Flow.entitlements` and pass it
in step 2. Start empty; grow only as notarization dictates.

---

## 5. CI

The script must run unchanged in CI; the only additions are keychain plumbing:

- Import the Developer ID cert (base64 secret) into a temporary keychain, unlock
  it, and set it searchable for `codesign`.
- Provide notarization creds either as a keychain profile created in-job or via
  App Store Connect API key env vars.
- Run `dist.sh`; upload `dist/Flow.dmg` as the release artifact.

Secrets (cert `.p12` + password, notary credentials) live in CI secret storage,
never in the repo. Keep the local-run path (keychain profile) and the CI path
(imported cert) behind the same env-var contract from §2 so there is one code
path.

---

## 6. Distribution & updates

- Hand off `dist/Flow.dmg` via a download link (object storage / release page).
  User: download → open DMG → drag Flow to Applications → launch, no warnings.
- **No auto-update in this phase.** Each release is a manual re-download; call
  this out in release notes. Auto-update (Sparkle with a signed appcast, or a
  move to TestFlight) is a follow-up.
- Bump `CFBundleVersion` / `CFBundleShortVersionString` in `make-app.sh` per
  release so users can tell builds apart (currently pinned at `2.0.0`).

---

## 7. Acceptance

- `FLOW_SIGN_IDENTITY=… FLOW_NOTARY_PROFILE=… apps/macos/tools/dist.sh` produces
  `dist/Flow.dmg` with zero manual interaction after credential setup.
- On a **second, clean Mac** (never a build machine, quarantine attribute
  intact): the DMG opens, the app drags to Applications, and double-click
  launches with **no** Gatekeeper prompt.
- `spctl --assess --type execute dist/Flow.app` reports
  `source=Notarized Developer ID`; `stapler validate` passes.
- Missing/blank signing env vars abort with a clear pointer to §2 — never an
  ad-hoc fallback.
- CHANGELOG gets a `[macos]` entry; if any part ships build-side only, it does
  not touch the client Parity section (this is packaging, not client behavior).
