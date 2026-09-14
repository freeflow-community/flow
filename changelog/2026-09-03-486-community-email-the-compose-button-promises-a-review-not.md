# Community email: the compose button promises a review, not a send (#486)

- `[web]` The broadcast composer's primary button now reads **"Review & send"**
  instead of "Send to 48 people". It only opens the confirm step, and the old
  wording described the button *after* it — admins hesitated to click, reading
  it as an immediate blast. Behaviour is unchanged, and the confirm step's
  "Send now" is still the real send.

## Feature

- **The Email everyone composer no longer looks like it sends the moment you
  click.** The button now says "Review & send", because it takes you to a
  confirmation step where you can send a test to yourself first.
