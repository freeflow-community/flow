# Phase 3.5

Some missing features to add:

- Show user avatar in lower left corner, user can click to get the menu
- Message editor supports block indent (>) and code editor (```). Typing those activates a visual showing how the result will look
- app supports pasting images into the prompt
- clicking on a user in the sidebar automatically opens the DM chat with them
- Workspace sidebar color should be selectable per workspace
- width of the sidebar should be adjustable
- app should automatically save login and active Workspace state
- When opening a workspace for the first time, the #general channel should be selected by default

## FIXES NEEDED

- Don't need member list in the sidebar, just Direct Messages list. There should be a persistent
DM channel with myself so that <User> (You) always shows under Direct Messages.

- Active user avatars should be displayed in the top bar as in the original design spec.

- activer workspace should be stored and recovered when app closes

- "paperclip" attach file works well, but dragging a file doesnt work it just shows the file path.
Dragging a file should work same as attachment with the file preview.

- as I type an emoji ":jo..." then the first match should be auto-selected so that pressing <enter>
	adds that emoji to the input

- the emoji picker should show all/filtered emojis in a vertical list I can pick from instead of horizontal
	