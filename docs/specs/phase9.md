# Artifacts tabs

'Artifacts tabs' are a new feature, where a user can open an "'artifact" like a file in a new tab. We introduce a new "Artifacts" section in the left side bar. 

When a file is shared in chat, the hover menu should show a bookmark icon. When you click this icon then we create a new
Artifact panel, showing the name in the sidebar and the content of the file in the Artifact panel. This panel should
be selected automatically at that time.

The Artifact panel should be flexible for showing content:
  - images
  - videos
  - text files
  - PDF files
  - HTML iframe

Once we have this basic UI machinery, then I want to add "artifact" APIs to the Flow MCP. This should allow
any Agent to create an artifact on demand. Once we have it wired up then I will test it out manually.


