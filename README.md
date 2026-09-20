# Discord MCP Server (Extended)

A fork of [v-3/discordmcp](https://github.com/v-3/discordmcp) with expanded capabilities for full Discord server management from Claude sessions. Beyond sending and reading messages, this fork can create channels, manage embeds, handle reactions, create roles, and moderate content.

## Tools

| Tool | Description |
|---|---|
| **Messaging** | |
| `send-message` | Send a plain text message to a channel |
| `read-messages` | Read recent messages from a channel (up to 100) |
| `send-embed` | Send a rich embed with title, description, color, fields, footer, images |
| `edit-message` | Edit an existing message sent by the bot |
| `edit-embed` | Edit an existing embed sent by the bot |
| `delete-message` | Delete a specific message by ID |
| `pin-message` | Pin a message in a channel |
| `unpin-message` | Unpin a message |
| `add-reaction` | Add an emoji reaction to a message |
| **Channels** | |
| `create-category` | Create a channel category |
| `create-channel` | Create a text channel, optionally under a category, with a topic |
| `list-channels` | List all channels organized by category |
| `set-channel-topic` | Set or update a channel's topic/description |
| `lock-channel` | Lock a channel so only admins can post (everyone else reads) |
| `unlock-channel` | Unlock a previously locked channel |
| `set-slowmode` | Set slowmode delay on a channel (0 to disable) |
| `delete-channel` | Delete a channel |
| **Server** | |
| `get-server-info` | Server stats: member count, boosts, creation date, channels, roles |
| `create-invite` | Create a shareable invite link with optional expiry and use limit |
| `list-members` | List server members with their roles |
| **Roles** | |
| `create-role` | Create a role with a name and color |
| `list-roles` | List all roles in the server |
| `assign-role` | Assign a role to a member |
| `remove-role` | Remove a role from a member |
| **Moderation** | |
| `kick-member` | Kick a member from the server |
| `ban-member` | Ban a member with optional message deletion |
| `unban-user` | Unban a user by ID |

## Prerequisites

- Node.js 16.x or higher
- A Discord bot token
- The bot must be invited to your server with these permissions:
  - **General:** Manage Server, Manage Channels, Manage Roles, View Channels, Create Instant Invite, Kick Members, Ban Members
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
npm install
```

3. Build:
```bash
npm run build
```

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

If the bot is in multiple servers, pass the `server` parameter (name or ID) to any tool. If the bot is in only one server, the parameter is optional.

## Security

- All tool operations require explicit user approval in Claude
- The bot token is stored in local configuration, never transmitted through chat
- Channel and server access follows Discord's permission model

## Credits

- Original project by [v-3](https://github.com/v-3/discordmcp)
- Extended by [ChronoRixun](https://github.com/ChronoRixun)
