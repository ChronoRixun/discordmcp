# Discord MCP Server (Extended)

A fork of [v-3/discordmcp](https://github.com/v-3/discordmcp) with **42 tools** for Discord messaging and community management through Codex, Claude, and other MCP clients. Runs locally over stdio using your Discord bot.

## Highlights

- **Rich message reading:** inspect embeds, attachment metadata, reactions, message links, reply references, and available thread metadata alongside message text. Page with `before`/`after`, filter by author, or drop system rows.
- **Single-message and pin lookups:** fetch one message by its Discord link, or list every pinned message in a channel.
- **Channel inspection:** topic, category, slowmode, pins and the effective `@everyone` permissions, so a read-only info channel can be verified rather than assumed.
- **Partial embed editing:** change one property while preserving omitted fields and other embeds; explicitly clear properties with `null`.
- **Replies and captions:** plain messages and embeds can reply to a message, and an embed can carry text above it.
- **Roles and channel access:** roles with colour, hoist, mentionable flag and permissions; per-role or per-member channel overwrites.
- **AutoMod, events and timeouts:** native AutoMod rules (keywords, presets, spam, mention spam), scheduled events with interested counts, and Discord timeouts.
- **Channel types:** text, voice, forum (with tags) and announcement channels.
- **Community management:** categories, pins, invites, member listing, kick and ban.
- **Validated before sending:** permission names, colours, IDs, dates and rule shapes are checked locally, so a bad request fails with a clear message instead of a Discord error.
- **Tested behavior:** 56 offline regression tests cover every module: reads, paging and filters, lookups, channel inspection, sending, embed editing, roles, channel permissions, AutoMod, events and timeouts.

## Tools

| Tool | Description |
|---|---|
| **Messaging** | |
| `send-message` | Send a plain text message to a channel, optionally as a reply |
| `read-messages` | Read recent messages with IDs, embeds, attachments, reactions, and reply references (up to 100); page with `before`/`after`, filter by `author`, `excludeSystem` |
| `get-message` | Fetch one message by Discord link, or by channel and message ID, with a reply preview |
| `list-pins` | List every pinned message in a channel, newest first |
| `send-embed` | Send a rich embed with title, description, color, fields, footer, images; optional text above it and reply target |
| `edit-message` | Edit an existing message sent by the bot |
| `edit-embed` | Update a selected bot embed while preserving omitted fields and other embeds |
| `delete-message` | Delete a specific message by ID |
| `pin-message` | Pin a message in a channel |
| `unpin-message` | Unpin a message |
| `add-reaction` | Add an emoji reaction to a message |
| **Channels** | |
| `create-category` | Create a channel category |
| `create-channel` | Create a text, voice, forum (with tags) or announcement channel, optionally under a category |
| `list-channels` | List channels by category, marking voice, forum and announcement channels |
| `get-channel-info` | Topic, category, slowmode, pin count, effective `@everyone` permissions and overwrites |
| `set-channel-permissions` | Allow, deny or clear named permissions for one role or member in a channel |
| `remove-channel-overwrite` | Remove a role's or member's overwrite so it inherits again |
| `set-channel-topic` | Set or update a channel's topic/description |
| `lock-channel` | Deny sending messages and adding reactions for `@everyone` in a channel |
| `unlock-channel` | Clear the `@everyone` send/reaction overrides set by locking |
| `set-slowmode` | Set slowmode delay on a channel (0 to disable) |
| `delete-channel` | Delete a channel |
| **Server** | |
| `get-server-info` | Member count, boosts, creation date, channels, roles, verification level and enabled features |
| `create-invite` | Create a shareable invite link with optional expiry and use limit |
| `list-members` | List server members with their roles |

Tools that take a `user` accept a user ID, username, display name, tag or global
name (case-insensitive). Names resolve through Discord's member search endpoint,
with a bounded cache refresh as a fallback, so a large server cannot stall the call.
Tools that take a `role` or `channel` accept a name or an ID; channel names may
carry a leading `#`.
| **Roles** | |
| `create-role` | Create a role with colour, hoist, mentionable flag and permissions |
| `edit-role` | Change name, colour (null clears), hoist, mentionable, permissions or position |
| `delete-role` | Delete a role (never @everyone or integration roles) |
| `list-roles` | Roles as JSON: colour, hoist, mentionable, position, member count, permission names |
| `assign-role` | Assign a role to a member |
| `remove-role` | Remove a role from a member |
| **Moderation** | |
| `kick-member` | Kick a member from the server |
| `ban-member` | Ban a member with optional message deletion |
| `unban-user` | Unban a user by ID |
| `timeout-member` | Time a member out for up to 28 days |
| `remove-timeout` | End a timeout early |
| **AutoMod** | |
| `create-automod-rule` | Keyword, keyword-preset, spam or mention-spam rule with block, alert and timeout actions |
| `list-automod-rules` | Rules as JSON with triggers, actions and exemptions |
| `delete-automod-rule` | Delete a rule by name or ID |
| **Events** | |
| `create-event` | Scheduled event in a voice/stage channel or at an external location |
| `list-events` | Events as JSON with status, times and interested counts |
| `delete-event` | Delete an event by name or ID |

## Reading messages

`read-messages` accepts `channel` (name or ID), optional `server` (name or ID),
and an integer `limit` from 1 to 100 (default 50). The response remains a JSON
array in the MCP text result, newest first, with the original `channel`, `server`,
`author`, `content`, and `timestamp` fields preserved.

Optional filters:

- `before` / `after`: a message ID; only older or only newer messages are fetched
  (one or the other, not both). Every page is returned newest first, including
  `after` pages, which Discord itself returns oldest first.
- `author`: keep only messages whose user ID, tag, username or display name
  matches (case-insensitive). Applied after the fetch, so a page can be shorter
  than `limit`; page on with `before` set to the last ID returned.
- `excludeSystem`: drop system rows such as "pinned a message" and join notices,
  keeping ordinary posts and replies.

Each message also includes:

- `id`, `url`, `channelId`, `serverId`, `authorId`, and `authorBot`.
- `editedTimestamp`, `type`, and `pinned`.
- `embeds`: complete Discord embed JSON, including fields, footer and images.
- `attachments`: IDs, filenames, descriptions, URLs, MIME types, byte sizes,
  dimensions and spoiler flags. Files are not downloaded; URLs may expire.
- `reactions`: emoji ID/name/animation, count, and whether the bot reacted.
- `reference`: referenced message/channel/server IDs and a link when available.
- `replyPreview`: author, text and embeds only when the referenced message is in
  the same fetched batch. Otherwise null; no extra history requests are made.
- `thread`: attached thread metadata when available, otherwise null.

Empty text does not imply an empty message: check `embeds` and `attachments`.
Discord permissions and Message Content Intent still determine what data is
available. Missing previews do not imply deleted messages. Reading thread
history and downloading attachment contents are not part of this tool.

## One message, pins and channel settings

`get-message` returns a single message in the same shape. Pass `url` (a Discord
message link; the server and channel come from the link) or `channel` plus
`messageId`. When the message replies to another message in the same channel,
that target is fetched for `replyPreview`; if it cannot be fetched the preview is
`null` and `reference` still carries the IDs.

`list-pins` returns every pinned message in a channel, newest first, in the same
shape as `read-messages` (without `replyPreview`).

`get-channel-info` returns the channel's topic, category, slowmode, creation date,
pinned message IDs, the effective `@everyone` permissions (`view`, `readHistory`,
`send`, `react`) after overwrites, and each permission overwrite with its role or
member name. Use it to confirm that an info channel is actually read-only.

## Sending

`send-message` and `send-embed` both honour `server` and accept `replyTo`, a
message ID in the same channel. A reply to a missing message fails instead of
silently posting as a plain message. `send-embed` also accepts `content`, plain
text shown above the embed, and requires at least one embed property. Both report
the new message's ID and link.

## Editing embeds safely

`edit-embed` updates an existing embed on a message sent by this bot. Omitted
properties are preserved. Other embeds, message text, attachments and components
are left unchanged. `embedIndex` selects an existing embed (zero-based, default 0).

Use `null` to remove a title, description, color, footer, image, thumbnail or field
list. `fields` replaces the entire list; `[]` clears it. Empty strings are rejected.
Changing footer text retains its existing icon. Requests with no changes, invalid
indices, invalid field values or excessive combined embed text fail before editing.
The message is fetched fresh before merging; simultaneous edits by another client
can still race because this operation is not an atomic patch.

Example: change only the title and remove the image:

```json
{"channel":"welcome","messageId":"MESSAGE_ID","title":"Welcome aboard","image":null}
```

Some MCP clients cannot send a JSON `null` and deliver the string `"null"` instead;
`edit-embed` and `edit-role` treat that string as an explicit clear.

## Roles and channel access

`create-role` and `edit-role` take `permissions` as discord.js permission names
(`SendMessages`, `ManageMessages`, `KickMembers`, ...); unknown names are rejected
before anything is sent. `edit-role` replaces the whole permission set when
`permissions` is given, clears the colour with `color: null`, and moves the role
with `position` (higher is higher in the list). `@everyone` can only have its
permissions changed. The bot can only manage roles below its own highest role, and
newly created roles land at the bottom of the list, so create them and then order
them with `position`, highest first. `list-roles` includes member counts from a
bounded member fetch; on a very large server a count can lag the cache.

`set-channel-permissions` edits one overwrite in a channel of any type for either a
`role` or a `member`: `allow` grants, `deny` denies, `clear` returns those permissions
to inheriting from roles. A permission may appear in only one of the three lists.
`remove-channel-overwrite` deletes the whole overwrite. `get-channel-info` shows the
result.

## AutoMod, events and timeouts

`create-automod-rule` creates a native Discord AutoMod rule. `trigger` is one of
`keyword` (needs `keywords` and/or `regexPatterns`), `keyword_preset` (needs `presets`
from `profanity`, `sexual_content`, `slurs`), `spam`, or `mention_spam` (needs
`mentionLimit`). Actions: `blockMessage` (default on, optional `customMessage`),
`alertChannel`, and `timeoutMinutes` (keyword and mention_spam rules only; the bot
needs Moderate Members). Discord limits a server to six keyword rules and one each
of the other types. `exemptRoles` and `exemptChannels` take names or IDs.

`create-event` needs `startTime` (ISO 8601 with offset) and either `channel` (a voice
or stage channel) or `location` plus `endTime` for an event held elsewhere, such as
a game server. `list-events` includes interested counts. Events are guild-only.

`timeout-member` applies Discord's timeout for 1 to 40320 minutes (28 days); the
member can read but not post, react or speak. It refuses members the bot cannot
moderate instead of failing later.

`create-channel` accepts `type` `text` (default), `voice`, `forum` (with optional
`tags`) or `announcement`; announcement channels require a Community server.

## Testing

Run `npm test` to compile and run all 56 offline regression tests (reading, paging
and filters, single-message and pin lookups, channel info, sending, embed editing,
roles, channel permissions, AutoMod, events and timeouts). No bot token or Discord connection is needed. Tests use Node's built-in test runner.

```bash
npm ci
npm test
```

## Prerequisites

- Node.js 18 or higher (use a currently supported LTS release)
- A Discord bot token
- The bot must be invited to your server with these permissions:
  - **General:** Manage Server, Manage Channels, Manage Roles, View Channels, Create Instant Invite, Kick Members, Ban Members, Moderate Members, Manage Events
  - **Text:** Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis
- **Privileged Gateway Intents** enabled in the Developer Portal:
  - Message Content Intent
  - Server Members Intent (required for list-members, kick, ban, role assignment)

## Setup

1. Clone this repository:
```bash
git clone https://github.com/ChronoRixun/discordmcp.git
cd discordmcp
```

2. Install dependencies:
```bash
npm ci
```

3. Build:
```bash
npm run build
```

## Codex Configuration

In Codex's MCP server settings, add a stdio server named `discord`:

- **Command:** `node`
- **Arguments:** the absolute path to `build/index.js` in this checkout
- **Environment:** `DISCORD_TOKEN` set to your bot token

Equivalent `~/.codex/config.toml` entry on Windows:

```toml
[mcp_servers.discord]
enabled = true
command = "node"
args = ['D:\discordmcp\build\index.js']

[mcp_servers.discord.env]
DISCORD_TOKEN = "your_bot_token_here"
```

Replace the example path with your actual installation. Save and restart the MCP
connection after changing the configuration or rebuilding the server. Keep the real
token in local configuration; do not paste it into chat or commit it to Git.

## Updating an installation

From a clean checkout tracking `main`:

```bash
git pull --ff-only
npm ci
npm test
```

`npm test` also rebuilds `build/index.js`. Restart the MCP connection to load the
updated code. Updating GitHub alone does not change an already running MCP process.

## Claude Code Configuration

Add to your MCP settings (the token goes in the config file, not in chat):

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["path/to/discordmcp/build/index.js"],
      "env": {
        "DISCORD_TOKEN": "your_bot_token_here"
      }
    }
  }
}
```

## Claude Desktop Configuration

Add to your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["path/to/discordmcp/build/index.js"],
      "env": {
        "DISCORD_TOKEN": "your_bot_token_here"
      }
    }
  }
}
```

## Multi-Server Support

If the bot is in multiple servers, pass the `server` parameter (name or ID).
If the bot is in only one server, the parameter is optional. Every tool honours an
explicit `server`; when none is given and the bot is in several servers, the error
lists the servers it can see.

## Security

- Configure approvals in your MCP client. This server does not implement its own approval dialog.
- The bot token is stored in local configuration, never transmitted through chat
- Channel and server access follows Discord's permission model. Grant only the permissions needed for the tools you use.
- `lock-channel` changes only the `@everyone` overwrite; other role/member allows can still permit posting. `unlock-channel` clears those two overrides rather than restoring a saved permissions snapshot.
- `create-role`, `edit-role` and `set-channel-permissions` can grant powerful permissions, including `Administrator`. Approve those calls deliberately; the server validates names, not intent.
- AutoMod `timeoutMinutes` acts without a human in the loop. Leave it off and alert a mod channel unless automatic timeouts are wanted.

## Fork history

- v-3/discordmcp: send and read messages.
- 13 tools: embeds, channels, roles, reactions, moderation.
- 27 tools: categories, pins, invites, slowmode, lock/unlock, kick/ban/unban, role assignment, member listing.
- Rich `read-messages` (IDs, links, embeds, attachments, reactions, replies) and safe partial `edit-embed`; first offline test suite.
- 30 tools: `get-message`, `list-pins`, `get-channel-info`; paging and filters on reads; replies and captions on sends; `server` honoured everywhere.
- 42 tools: role management, channel overwrites, AutoMod, scheduled events, timeouts, voice/forum/announcement channels; live-tested against a real server.
- Robustness: the string `"null"` accepted as a clear, member lookup through REST search, bounded member fetches.

## Credits

- Original project by [v-3](https://github.com/v-3/discordmcp)
- Extended by [ChronoRixun](https://github.com/ChronoRixun)
