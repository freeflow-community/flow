# macOS: attachment cards fit the transcript column

- `[macos]` Image and video attachment cards were framed at a fixed size derived
  from the file's own dimensions, so a large picture insisted on 480pt inside a
  406pt column and clipped — taking the message text beside it out of wrap and
  into clipping too. The size is now a ceiling: cards keep their aspect ratio
  and scale to the column. The 480/560pt cap is unchanged, so nothing moves at
  widths where the card already fitted.

## Feature

- **Pictures in a message now shrink to fit.** Opening a thread or the Files
  panel no longer cuts an image or its text off at the edge of the conversation.
