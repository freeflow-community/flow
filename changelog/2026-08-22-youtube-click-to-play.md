# YouTube links play inside Flow

- `[server]` Video links get an `embed` on the unfurl card — provider, video id
  and a `youtube-nocookie` player URL the server builds from the id, so no
  provider markup ever reaches a client. `watch?v=`, `youtu.be`, `shorts`,
  `embed` and `live` forms all resolve.
- `[server]` `media.durationSec` is now populated, from `itemprop="duration"`
  or `og:video:duration`; known video hosts also get a 1 MB head budget, since
  YouTube buries its metadata ~690 KB into a 700 KB `<head>` and was coming
  back empty under the 512 KB cap.
- `[web]` `[macos]` `[ios]` Video cards show a play badge and the runtime;
  clicking plays in place (web) or in a sheet (native). Nothing is loaded from
  the provider until that click.

## Feature

- **Play YouTube without leaving Flow.** A YouTube link now shows how long the
  video is and a play button — press it and the video plays right there in the
  conversation.
