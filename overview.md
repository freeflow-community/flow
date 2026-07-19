# Flow

We are building a complete, production ready Slack clone.

Our key features will include:

- High performance messaging backend, with encryption of messages at rest
- Core data model: users, workspaces, channels, messages, replies and threads, file uploads and previews
- User connected to multiple workspaces
- Multi-client, but starting with a single MacOS native client, and then a web client
- File uploads, file previews, rich chat (markdown) support, emojis
- User invites, invite to channel. Public and prive channels.
- Message replies, and message threads
- @ messaging to users with notification
- Direct message channels, one to one
- Private DM channels with multiple users
- Emoji replies to messages
- User profiles with name, email, timezone, and avatar
- Presence indication
- Typing indication
- Core Slack API app compatiblity

Slack features we WILL NOT INCLUDE:

- Canvas
- BlockKit support
- External connections, guest users
- Drafts
- Huddles or any audio or video support
- Message search

The architecture plan and build phases are defined in the "phase<N>.md" docs in this folder.

	
