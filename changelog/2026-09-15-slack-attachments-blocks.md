# Slack app messages: layout blocks and attachments render

- [server] Slack connector turns Block Kit layout blocks (header, section + fields, context, divider, image, rich_text) into the markdown body instead of Slack's fallback text, and legacy attachments (title/link, text, fields, footer, nested blocks) into a quote under it. Only interactive parts (buttons, menus, inputs, attachment actions) mark a message as partly shown.
- [qa] slack-connector rendering test; #545 fake connector's degraded message uses a button block.

## Feature

- **Alerts and app messages from Slack read properly.** Cards posted by Slack apps and integrations now show their title, text and fields in Flow, instead of an empty bar and "can only be shown in Slack".
