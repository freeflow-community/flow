---
title: Scheduled Messages
order: 6
---

# Scheduled Messages

A scheduled message is one you write once and Flow posts for you later, on a
schedule you choose. It posts **as you**, so a standup prompt every weekday, a
digest every 12 hours, or a reminder to yourself next Tuesday all read as if
you had typed them at that moment. Anyone you mention in it gets the mention
for real, and that includes agents.

## Where to find them

The clock beside the Activity bell in the sidebar opens **Scheduled**, a panel
listing everything scheduled in the workspace that you are allowed to see: your
own messages, plus any that post into a channel you are a member of. Tick
**Owned by me** to narrow it to yours.

## Scheduling one

There are two ways in:

- **From the Scheduled panel**, press **New scheduled message** and fill in the
  dialog from scratch.
- **From the composer**, write the message as you normally would, then instead
  of sending it use the clock: on the web and the Mac it is the clock button
  next to Send, and on iPhone it is **Schedule this message** in the composer's
  **+** menu. The dialog opens with your text already in it and the current
  conversation already picked as the destination. Saving clears the draft from
  the composer, because the message is now the schedule's to post.

The composer option is only offered in a conversation's main composer, not in
a thread. A scheduled message is always a top-level post.

The dialog has three parts:

- **Schedule.** Pick a preset: **Once** at a date and time, **Hourly** at a
  chosen minute past the hour, **Every N hours** starting from a time of day,
  **Daily** at a time, or **Weekly** on a weekday at a time. Times are in your
  own timezone, the one your device is set to, and the dialog says which. A
  daily 9:00 message stays at 9:00 when the clocks change. If none of the
  presets fit, choose **Custom cron…** and enter a standard five-field cron
  expression.
- **Message to post.** Plain text, with the same `@name` mentions you would
  type in the composer. Attachments cannot be scheduled.
- **Post to.** Either **Just me**, which is your own private conversation with
  yourself, or any channel you are a member of. Group DMs are not offered.
  Posting to a channel makes the scheduled message visible to every member of
  that channel, and it posts there under your name.

Press **Schedule it** to save. A **Once** message must be set for a time in the
future, and any schedule that could never fire is refused when you save rather
than failing silently later.

## What a scheduled post looks like

Anything Flow posts for you carries a **SCHEDULED** badge next to your name, so
nobody mistakes an automatic message for one you just typed. Clicking the badge
on the web or Mac opens the Scheduled panel. On iPhone, tapping it explains the
message and offers to open the panel.

A scheduled post is an ordinary message in every other way. It can be replied
to in a thread, reacted to, pinned, edited and deleted like anything else you
have written.

## Managing what is scheduled

Each row in the Scheduled panel shows the message, its schedule, where it
posts, who owns it, and its status: **Scheduled**, **Succeeded**, **Paused** or
**Failed**, along with when it last ran or will next run. After a run,
**view output** jumps to the message it posted.

The owner of a scheduled message and workspace admins can act on it. Everyone
else can only read the row.

- **Run now** posts it immediately, without changing its schedule.
- **Pause** stops it from firing until you **Resume** it. Resuming works out
  the next time from now, so a paused daily message does not fire the moment
  you switch it back on.
- **Edit** reopens the same dialog with the same choices you made, so you can
  change the text, the time or the destination.
- **Delete** removes it. On the web and the Mac the button asks you to click
  it a second time to confirm; on iPhone you confirm in a dialog.

On the Mac the actions are buttons on the row. On iPhone they are in the row's
menu, and Run now, Edit and Delete are also swipe actions.

A **Once** message runs a single time. It then stays in the list, paused with
no next run, so you can still find what it posted.

## When Flow stops a schedule for you

A scheduled message only posts while you could have posted it yourself. If you
leave the channel it posts to, or a send fails, Flow pauses the schedule
instead of letting it fail quietly, marks the row **Failed**, and sends you a
note in your **Just me** conversation saying which message stopped and why.
Fix the cause, then Resume it or edit it to post somewhere else.

If the Flow server is down when a message was due, it posts once as soon as the
server is back. Missed occurrences are never replayed one after another into a
channel.

## Where scheduled messages work

Scheduled messages work in the **web**, **macOS** and **iOS** clients, and a
schedule created on one is visible and editable on the others. The messages are
posted by the server, so they go out on time whether or not you have Flow open
anywhere.
