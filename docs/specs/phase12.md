# Activity feed

Create a new always-present channel '#Activity' which replicates the alerted messages we show under the Notifications bell. Then remove the notifications bell.

> Shipped. The feed is a virtual, client-only sidebar entry (no server row, no
> membership) rendering this user's notification rows; the bell is gone.
> Read semantics, the badge rule and everything else about notifications:
> **`docs/design/NOTIFICATIONS.md`**.
