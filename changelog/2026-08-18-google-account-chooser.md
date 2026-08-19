# Google sign-in always asks which account

- `[web]` The `/?native=google` handoff page no longer signs the app in from an
  existing web session on its own: it offers `Continue as <email>` next to the
  Google button, so the account chooser is always one click away. "Not you?"
  drops the session from every later phase.
- `[ios]` The auth sheet still shares Safari's session, deliberately — that is
  what makes Google's chooser open already listing the device's accounts.

## Feature

- **Sign in as whoever you meant to.** Continuing with Google from the Mac or
  iPhone app now asks which account, instead of quietly using the one your
  browser already had. Your usual account is still a single tap.
