---
title: Huddles
order: 5
---

# Huddles

A huddle is a live audio call that runs inside a conversation. It is ambient:
in a channel it just starts, nobody is rung, and anyone who can see the channel
can see it is live and drop in or out as they like. In a DM it behaves like a
call — it rings the people you are talking to.

Video and screen sharing are available in every huddle. Nothing is recorded.

## Starting and joining one

The huddle control sits in the header of the conversation, next to the channel
name.

- **In a channel**, it says **Join Huddle**. If a huddle is already live, the
  button carries a count of the people in it. Pressing it puts you in.
- **In a DM or group DM**, it says **Huddle**, and starting one rings everyone
  in the conversation who has Flow open. They see a card with **Accept** and
  **Decline**. If nobody can be reached you are told straight away instead of
  being left listening to it ring, and the conversation gets a "Missed huddle",
  "Call declined" or "Call ended" line afterwards.
- **Leaving** is the same button, now reading **Leave Huddle**. Closing the
  conversation does not leave the huddle — you have to press it.

You always join **muted**. There is one huddle per conversation, so joining a
second one leaves the first. Archived channels cannot host a huddle.

A huddle you have joined follows you around the app: switch channels, read
something else, and you stay connected. The huddle bar stays on screen the
whole time, and is where every control lives.

## Calling an AI agent

Open a DM with an online AI agent and press **Huddle** exactly as you would for
a person. If that agent's bridge has voice enabled, it answers the ring and
appears in the ordinary Huddle roster — there is no separate voice-agent mode
or special call screen. The conversation remains live and interruptible while
you move around Flow.

The voice side is for quick conversation, clarification and decisions. When
you ask the agent to do substantial work, it can hand a self-contained request
to its normal chat runtime. You will see the queued request, live progress and
the result in the same DM while the Huddle continues.

If the agent cannot speak, it declines instead of leaving you to wait. The DM
explains whether voice is disabled or the bridge is missing its
`OPENAI_API_KEY`. The agent operator can enable voice in `agent.json` and then
restart the bridge.

## Mic, camera and screen

The huddle bar holds four controls:

- **Mute / Unmute** — your mic. The button only shows you as live once the
  audio is actually going out, so a refused permission cannot leave you talking
  to nobody.
- **Camera** — turn your camera on or off.
- **Share screen** — on the Mac you pick a window or a whole display; on the
  web the browser asks which tab, window or screen to share. Chromium-based
  browsers can include the tab's audio; other browsers share silently.
- **Leave** — leave the huddle (or **Cancel** while a DM is still ringing).

Only one person shares their screen at a time: a new share replaces the one
before it.

## What you see

While everyone is on voice, the huddle stays a thin bar out of your way. The
moment anyone turns on a camera or starts sharing, it opens into a grid of
tiles — your own self-view included, the person talking ringed, and a mic and
camera badge on each tile. Someone's screen gets a large tile with everyone
else as a filmstrip beside it. Tap or click a tile to focus it. When the last
camera and share stop, it collapses back to the bar.

## Microphone and camera permissions

The first time you unmute or turn your camera on, your operating system or
browser asks whether Flow may use the device. This is asked once, by the OS,
and not by Flow.

- **macOS** shows its standard prompt. If you said no earlier, no prompt
  appears the second time: open **System Settings → Privacy & Security →
  Microphone** (or **Camera**) and switch Flow on there. Flow offers an **Open
  Settings** button that takes you straight to it.
- **Sharing your screen on macOS** needs a separate permission, **Privacy &
  Security → Screen & System Audio Recording**. If the list of windows to share
  comes up empty, that permission is the reason.
- **On the web** the browser asks, and remembers your answer per site. If you
  blocked it, use the camera or padlock icon in the address bar to allow it
  again, then reload.
- **iPhone** asks the same way; **Settings → Flow** is where to change your
  mind.

If a device is refused or missing, the control tells you rather than pretending
to be on.

## Where huddles work

Huddles work in the **web**, **macOS** and **iOS** clients. A huddle started on
one is the same huddle on the others.

Worth knowing:

- The incoming-call card for a DM huddle only appears while Flow is open on
  that device; there is no push notification that rings a sleeping phone yet.
  Answering on one device dismisses the card on your others.
- On iPhone you can watch someone else's screen share, but sharing your own
  screen shares only Flow's own screen for now.
- Backgrounding the Mac or iOS app turns your camera off and the huddle carries
  on over audio; coming back offers to turn it on again.
- Video is capped at 360p and screen sharing at 720p, which is what keeps a
  huddle usable on an ordinary connection.
- Huddles need to be enabled on the server your workspace runs on. If the
  huddle control does nothing, ask whoever runs your workspace.
