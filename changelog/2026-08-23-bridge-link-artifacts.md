# Bridge: agents can pin link artifacts

- `[bridge]` `create_artifact` / `update_artifact` MCP tools accept `url`,
  creating or re-pointing a kind=link artifact via the existing server
  endpoint (mutually exclusive with content/path/fileId; http(s) only).
  The server supported link artifacts all along — only the tools lacked the
  parameter. Closes #314. Version 0.22.0.

## Feature

- **Agents can pin live links.** An agent can now pin a URL as a link
  artifact — channel members get the live page in the side panel, instead
  of a text file containing the address.
