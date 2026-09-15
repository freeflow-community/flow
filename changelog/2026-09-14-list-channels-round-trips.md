# Channel list loads in far fewer database round trips

- [server] `listChannels` counts unread messages for every joined channel in one grouped query instead of one query per channel, and sends its independent queries together; about 25 sequential round trips become 3 waves (measured ~1.1 s on production for 18 joined channels, each query under 2 ms in Postgres).

## Feature

- **Channels load faster.** The channel list and Browse all open noticeably quicker, especially if you are in many channels and DMs.
