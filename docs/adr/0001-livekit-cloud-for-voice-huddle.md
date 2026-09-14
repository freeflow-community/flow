# LiveKit Cloud, not self-hosted, for voice huddles

Flow's voice huddle (Phase 1) needed a WebRTC SFU. Self-hosting one on
Railway (the current host) means UDP is unavailable, forcing a TCP-relay
workaround with real quality loss under packet loss or jitter — exactly the
conditions a voice call needs to tolerate. LiveKit Cloud is UDP-native and
free to 5,000 participant-minutes/month, which comfortably covers an early
feature. We accept the vendor dependency (and its egress-cost curve past the
free tier) in exchange for not operating a media server ourselves.

If usage outgrows the free tier or the vendor relationship stops working,
self-hosting LiveKit's OSS server becomes the fallback — the client-facing
protocol (`livekit-server-sdk` token minting, the `livekit-client`/Swift SDKs)
is the same either way, so switching is a deployment change, not a rewrite.
