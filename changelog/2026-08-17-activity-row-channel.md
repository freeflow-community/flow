# Activity rows name the channel they came from

- `[web]` `[macos]` `[ios]` Activity rows now read "Bob replied in a thread in
  #bugs" — with several busy channels the rows were otherwise ambiguous. DM
  rows are unchanged; the suffix is dropped when the channel isn't known
  locally.
- `[macos]` `[ios]` Both native feeds share one
  `NotificationItem.headline(sender:channelName:)` instead of a copy each.

## Feature

- **Activity tells you where.** Each row in the Activity feed now names the
  channel it came from, so you can see what is pulling you in without clicking
  through.
