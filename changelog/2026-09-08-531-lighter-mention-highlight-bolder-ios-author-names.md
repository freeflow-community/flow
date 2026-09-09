# Lighter mention highlight, bolder iOS author names (#531)

- `[macos]` `[ios]` In-message mentions are a tint, not a badge: accent text on
  a 10% accent wash (20% and `.medium` for a mention of you), replacing the
  filled accent block with bold white text that read louder than the message
  around it.
- `[macos]` `[ios]` Mention pills name `MC.accent` instead of `.accentColor` —
  the environment tint only resolved to the brand purple for some attribute
  combinations, and the lighter styling came back system blue.
- `[ios]` Message author name goes 14 → 15pt (still `.bold`). It was bold
  already; at 14pt against a 16pt `.callout` body it was smaller than the text
  it labels, which is why it stopped reading as the strongest thing in the row.

## Feature

- **Mentions are quieter, names are clearer.** An @-mention inside a message
  now reads as a light highlight rather than a solid coloured block, so it
  stops competing with the sentence it sits in — a mention of you still stands
  out a step more than the rest. On iPhone, the sender's name above each
  message is bigger and bolder, so a conversation is easier to scan.
