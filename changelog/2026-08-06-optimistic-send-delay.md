# Pending messages render at full strength; dim only after 3s

- `[web]` `[macos]` `[ios]` A just-sent message now appears in normal (black)
  text right away. It dims to grey (with the spinner on macOS/iOS) only if the
  server hasn't confirmed it within 3 seconds; the failed state is unchanged.

## Feature

- **Sent messages look sent.** Your message now appears in normal text the
  moment you hit send. It only fades to grey if delivery is slow, and shows an
  error with a Retry button if it fails.
