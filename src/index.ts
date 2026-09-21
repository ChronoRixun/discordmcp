import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from 'dotenv';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, ChannelType, PermissionFlagsBits, GuildMember, type GuildBasedChannel } from 'discord.js';
import { z } from 'zod';
import { readMessages, getMessage, listPins } from './read-messages.js';
import { editEmbed } from './edit-embed.js';
import { getChannelInfo } from './channel-info.js';
import { sendMessage, sendEmbed } from './send.js';
import { createRole, editRole, deleteRole, listRoles } from './roles.js';
import { setChannelPermissions, removeChannelOverwrite } from './channel-permissions.js';
import { createAutomodRule, listAutomodRules, deleteAutomodRule } from './automod.js';
import { createEvent, listEvents, deleteEvent } from './events.js';
import { editAutomodRule, editEvent, lifecycleTools } from './lifecycle.js';
import { timeoutMember, removeTimeout } from './moderation.js';
import { getOnboarding, setOnboarding, getWelcomeScreen, setWelcomeScreen, editChannel } from './community.js';
import { getRulesScreening, setRulesScreening } from './screening.js';
import { findMember } from './member-lookup.js';
import { findRole, type Resolvers } from './shared.js';

// Load environment variables
dotenv.config();

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// Helper function to find a guild by name or ID
async function findGuild(guildIdentifier?: string) {
  if (!guildIdentifier) {
    // If no guild specified and bot is only in one guild, use that
    if (client.guilds.cache.size === 1) {
      return client.guilds.cache.first()!;
    }
    // List available guilds
    const guildList = Array.from(client.guilds.cache.values())
      .map(g => `"${g.name}"`).join(', ');
    throw new Error(`Bot is in multiple servers. Please specify server name or ID. Available servers: ${guildList}`);
  }

  // Try to fetch by ID first
  try {
    const guild = await client.guilds.fetch(guildIdentifier);
    if (guild) return guild;
  } catch {
    // If ID fetch fails, search by name
    const guilds = client.guilds.cache.filter(
      g => g.name.toLowerCase() === guildIdentifier.toLowerCase()
    );
    
    if (guilds.size === 0) {
      const availableGuilds = Array.from(client.guilds.cache.values())
        .map(g => `"${g.name}"`).join(', ');
      throw new Error(`Server "${guildIdentifier}" not found. Available servers: ${availableGuilds}`);
    }
    if (guilds.size > 1) {
      const guildList = guilds.map(g => `${g.name} (ID: ${g.id})`).join(', ');
      throw new Error(`Multiple servers found with name "${guildIdentifier}": ${guildList}. Please specify the server ID.`);
    }
    return guilds.first()!;
  }
  throw new Error(`Server "${guildIdentifier}" not found`);
}

// Helper function to find a channel by name or ID within a specific guild
async function findChannel(channelIdentifier: string, guildIdentifier?: string): Promise<TextChannel> {
  const guild = await findGuild(guildIdentifier);
  
  // First try to fetch by ID
  try {
    const channel = await client.channels.fetch(channelIdentifier);
    if (channel instanceof TextChannel && channel.guild.id === guild.id) {
      return channel;
    }
  } catch {
    // If fetching by ID fails, search by name in the specified guild
    const channels = guild.channels.cache.filter(
      (channel): channel is TextChannel =>
        channel instanceof TextChannel &&
        (channel.name.toLowerCase() === channelIdentifier.toLowerCase() ||
         channel.name.toLowerCase() === channelIdentifier.toLowerCase().replace('#', ''))
    );

    if (channels.size === 0) {
      const availableChannels = guild.channels.cache
        .filter((c): c is TextChannel => c instanceof TextChannel)
        .map(c => `"#${c.name}"`).join(', ');
      throw new Error(`Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}`);
    }
    if (channels.size > 1) {
      const channelList = channels.map(c => `#${c.name} (${c.id})`).join(', ');
      throw new Error(`Multiple channels found with name "${channelIdentifier}" in server "${guild.name}": ${channelList}. Please specify the channel ID.`);
    }
    return channels.first()!;
  }
  throw new Error(`Channel "${channelIdentifier}" is not a text channel or not found in server "${guild.name}"`);
}

// Any non-thread guild channel (text, voice, forum, announcement, stage, category) by ID or name.
async function findGuildChannel(channelIdentifier: string, guildIdentifier?: string): Promise<GuildBasedChannel> {
  const guild = await findGuild(guildIdentifier);
  await guild.channels.fetch();
  const wanted = channelIdentifier.toLowerCase().replace(/^#/, '');
  const byId = guild.channels.cache.get(channelIdentifier);
  if (byId && !byId.isThread()) return byId;
  const matches = guild.channels.cache.filter(c => !c.isThread() && c.name.toLowerCase() === wanted);
  if (matches.size === 0) {
    const available = guild.channels.cache.filter(c => !c.isThread() && c.type !== ChannelType.GuildCategory).map(c => `"${c.name}"`).join(', ');
    throw new Error(`Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${available}`);
  }
  if (matches.size > 1) {
    throw new Error(`Multiple channels named "${channelIdentifier}" in server "${guild.name}": ${matches.map(c => `${c.name} (${c.id})`).join(', ')}. Please specify the channel ID.`);
  }
  return matches.first()!;
}

// Validation schemas
const CreateCategorySchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  name: z.string().describe('Category name'),
});

const CreateChannelSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  name: z.string().min(1).max(100).describe('Channel name'),
  category: z.string().optional().describe('Category name or ID to place the channel under'),
  topic: z.string().max(1024).optional().describe('Channel topic (text) or post guidelines (forum)'),
  type: z.enum(['text', 'voice', 'forum', 'announcement']).default('text'),
  tags: z.array(z.string().min(1).max(20)).max(20).optional().describe('Forum post tags'),
});

const ListChannelsSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
});

const SetChannelTopicSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  topic: z.string().describe('New channel topic'),
});

const LockChannelSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
});

const AddReactionSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID to react to'),
  emoji: z.string().describe('Emoji (unicode or custom format)'),
});

const DeleteChannelSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
});

const DeleteMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID to delete'),
});

const EditMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID to edit'),
  message: z.string().describe('New message content'),
});

const PinMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID to pin'),
});

const UnpinMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID to unpin'),
});

const CreateInviteSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().optional().describe('Channel for the invite (defaults to first text channel)'),
  maxAge: z.number().optional().describe('Invite expiry in seconds (0 = never)'),
  maxUses: z.number().optional().describe('Max uses (0 = unlimited)'),
});

const GetServerInfoSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
});

const SetSlowmodeSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  seconds: z.number().min(0).max(21600).describe('Slowmode delay in seconds (0 to disable, max 21600 = 6 hours)'),
});

const UnlockChannelSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
});

const KickMemberSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  user: z.string().describe('Username, display name, or user ID'),
  reason: z.string().optional().describe('Reason for the kick'),
});

const BanMemberSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  user: z.string().describe('Username, display name, or user ID'),
  reason: z.string().optional().describe('Reason for the ban'),
  deleteMessages: z.number().optional().describe('Days of messages to delete (0-7)'),
});

const UnbanUserSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  userId: z.string().describe('User ID to unban'),
});

const AssignRoleSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  user: z.string().describe('Username, display name, or user ID'),
  role: z.string().describe('Role name or ID'),
});

const RemoveRoleSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  user: z.string().describe('Username, display name, or user ID'),
  role: z.string().describe('Role name or ID'),
});

const ListMembersSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  limit: z.number().int().min(1).max(100).optional().describe('Max members to list'),
});

const resolvers: Resolvers = { findGuild, findChannel, findGuildChannel, findMember };

// Create server instance
const server = new Server(
  {
    name: "discord",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      ...lifecycleTools,
      {
        name: "send-message",
        description: "Send a message to a Discord channel, optionally as a reply",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: 'Server name or ID (optional if bot is only in one server)' },
            channel: { type: "string", description: 'Channel name (e.g., "general") or ID' },
            message: { type: "string", minLength: 1, maxLength: 2000, description: "Message content to send" },
            replyTo: { type: "string", description: "Message ID in the same channel to reply to" },
          },
          required: ["channel", "message"],
        },
      },
      {
        name: "read-messages",
        description: "Read recent messages with IDs, links, embeds, attachments, reactions, and reply references (newest first). Page with before/after; filter by author or drop system rows.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: 'Server name or ID (optional if bot is only in one server)' },
            channel: { type: "string", description: 'Channel name (e.g., "general") or ID' },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50, description: "Number of messages to fetch (max 100)" },
            before: { type: "string", description: "Only messages older than this message ID (paging)" },
            after: { type: "string", description: "Only messages newer than this message ID (not with before)" },
            author: { type: "string", description: "Keep only messages by this user ID, tag, username or display name (applied after the fetch)" },
            includePageInfo: { type: "boolean", default: false, description: "Return messages plus unfiltered page cursors, including when filters match nothing" },
            excludeSystem: { type: "boolean", default: false, description: "Drop system rows such as pin and join notices" },
          },
          required: ["channel"],
        },
      },
      {
        name: "create-category",
        description: "Create a channel category in a Discord server",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            name: { type: "string", description: "Category name" },
          },
          required: ["name"],
        },
      },
      {
        name: "create-channel",
        description: "Create a text, voice, forum or announcement channel, optionally under a category (announcement channels need a Community server)",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            name: { type: "string", description: "Channel name" },
            category: { type: "string", description: "Category name or ID to place the channel under" },
            topic: { type: "string", description: "Channel topic, or post guidelines for a forum" },
            type: { type: "string", enum: ["text", "voice", "forum", "announcement"], default: "text" },
            tags: { type: "array", items: { type: "string" }, maxItems: 20, description: "Forum only: post tags to offer" },
          },
          required: ["name"],
        },
      },
      {
        name: "list-channels",
        description: "List all channels in a Discord server",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
          },
        },
      },
      {
        name: "set-channel-topic",
        description: "Set or update a channel's topic/description",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
            topic: { type: "string", description: "New channel topic" },
          },
          required: ["channel", "topic"],
        },
      },
      {
        name: "lock-channel",
        description: "Lock a channel so only admins can send messages (everyone else can read)",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
          },
          required: ["channel"],
        },
      },
      {
        name: "send-embed",
        description: "Send a rich embed message to a Discord channel, optionally with text above it or as a reply",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
            content: { type: "string", minLength: 1, maxLength: 2000, description: "Plain text shown above the embed" },
            replyTo: { type: "string", description: "Message ID in the same channel to reply to" },
            title: { type: "string", minLength: 1, maxLength: 256, description: "Embed title" },
            description: { type: "string", minLength: 1, maxLength: 4096, description: "Embed body (supports markdown)" },
            color: { type: "string", pattern: "^#?[0-9a-fA-F]{6}$", description: "Hex color (e.g. #E8A33D)" },
            fields: { type: "array", maxItems: 25, items: { type: "object", properties: {
              name: { type: "string", minLength: 1, maxLength: 256 },
              value: { type: "string", minLength: 1, maxLength: 1024 }, inline: { type: "boolean" },
            }, required: ["name", "value"] }, description: "Embed fields" },
            footer: { type: "string", minLength: 1, maxLength: 2048, description: "Footer text" },
            thumbnail: { type: "string", format: "uri", description: "Thumbnail URL" },
            image: { type: "string", format: "uri", description: "Large image URL" },
          },
          required: ["channel"],
        },
      },
      {
        name: "add-reaction",
        description: "Add an emoji reaction to a message",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
            messageId: { type: "string", description: "Message ID to react to" },
            emoji: { type: "string", description: "Emoji (unicode or custom format)" },
          },
          required: ["channel", "messageId", "emoji"],
        },
      },
      {
        name: "create-role",
        description: "Create a role with optional colour, hoist (shown separately in the member list), mentionable flag and permissions",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            name: { type: "string", minLength: 1, maxLength: 100 },
            color: { type: "string", pattern: "^#?[0-9a-fA-F]{6}$", description: "Hex colour (e.g. #E8A33D)" },
            hoist: { type: "boolean", description: "Show members with this role in their own group in the member list" },
            mentionable: { type: "boolean", description: "Let anyone @mention the role" },
            permissions: { type: "array", items: { type: "string" }, description: "Permission names, e.g. [\"ManageMessages\", \"KickMembers\"]" },
            reason: { type: "string", description: "Audit log reason" },
          },
          required: ["name"],
        },
      },
      {
        name: "edit-role",
        description: "Change a role's name, colour (null clears), hoist, mentionable flag, permissions (replaces the set) or position",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, role: { type: "string", description: "Role name or ID" },
            name: { type: "string", minLength: 1, maxLength: 100 },
            color: { type: ["string", "null"], pattern: "^#?[0-9a-fA-F]{6}$" },
            hoist: { type: "boolean" }, mentionable: { type: "boolean" },
            permissions: { type: "array", items: { type: "string" } },
            position: { type: "integer", minimum: 1, description: "Higher numbers sit higher in the role list" },
            reason: { type: "string" },
          },
          required: ["role"],
        },
      },
      {
        name: "delete-role",
        description: "Delete a role (not @everyone or integration-managed roles)",
        inputSchema: { type: "object", properties: { server: { type: "string" }, role: { type: "string", description: "Role name or ID" }, reason: { type: "string" } }, required: ["role"] },
      },
      {
        name: "list-roles",
        description: "List roles (highest first) as JSON with id, colour, hoist, mentionable, position, member count and permission names",
        inputSchema: { type: "object", properties: { server: { type: "string", description: "Server name or ID" } } },
      },
      {
        name: "delete-channel",
        description: "Delete a channel from the Discord server",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
          },
          required: ["channel"],
        },
      },
      {
        name: "delete-message",
        description: "Delete a specific message from a channel",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
            messageId: { type: "string", description: "Message ID to delete" },
          },
          required: ["channel", "messageId"],
        },
      },
      {
        name: "edit-message",
        description: "Edit an existing message sent by the bot",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" }, messageId: { type: "string" }, message: { type: "string", description: "New content" } }, required: ["channel", "messageId", "message"] },
      },
      {
        name: "edit-embed",
        description: "Update one existing bot embed, preserving omitted fields and other embeds. Use null to remove a field; fields replaces the entire field list.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, channel: { type: "string" }, messageId: { type: "string" },
            embedIndex: { type: "integer", minimum: 0, maximum: 9, default: 0, description: "Zero-based index of the existing embed to edit" },
            title: { type: ["string", "null"], minLength: 1, maxLength: 256 },
            description: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
            color: { type: ["string", "null"], pattern: "^#?[0-9a-fA-F]{6}$" },
            fields: { type: ["array", "null"], maxItems: 25, items: { type: "object", properties: {
              name: { type: "string", minLength: 1, maxLength: 256 },
              value: { type: "string", minLength: 1, maxLength: 1024 }, inline: { type: "boolean" },
            }, required: ["name", "value"] } },
            footer: { type: ["string", "null"], minLength: 1, maxLength: 2048 },
            thumbnail: { type: ["string", "null"], format: "uri" },
            image: { type: ["string", "null"], format: "uri" },
          }, required: ["channel", "messageId"],
        },
      },
      {
        name: "pin-message",
        description: "Pin a message in a channel",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" }, messageId: { type: "string" } }, required: ["channel", "messageId"] },
      },
      {
        name: "unpin-message",
        description: "Unpin a message in a channel",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" }, messageId: { type: "string" } }, required: ["channel", "messageId"] },
      },
      {
        name: "create-invite",
        description: "Create a server invite link",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string", description: "Channel for the invite (defaults to first text channel)" }, maxAge: { type: "number", description: "Expiry in seconds (0 = never)" }, maxUses: { type: "number", description: "Max uses (0 = unlimited)" } } },
      },
      {
        name: "get-server-info",
        description: "Get server information: member count, boosts, creation date, roles",
        inputSchema: { type: "object", properties: { server: { type: "string" } } },
      },
      {
        name: "set-slowmode",
        description: "Set slowmode delay on a channel (0 to disable)",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" }, seconds: { type: "number", description: "Delay in seconds (0-21600)" } }, required: ["channel", "seconds"] },
      },
      {
        name: "unlock-channel",
        description: "Unlock a previously locked channel so everyone can send messages",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" } }, required: ["channel"] },
      },
      {
        name: "kick-member",
        description: "Kick a member from the server",
        inputSchema: { type: "object", properties: { server: { type: "string" }, user: { type: "string", description: "Username or ID" }, reason: { type: "string" } }, required: ["user"] },
      },
      {
        name: "ban-member",
        description: "Ban a member from the server",
        inputSchema: { type: "object", properties: { server: { type: "string" }, user: { type: "string", description: "Username or ID" }, reason: { type: "string" }, deleteMessages: { type: "number", description: "Days of messages to delete (0-7)" } }, required: ["user"] },
      },
      {
        name: "unban-user",
        description: "Unban a user by ID",
        inputSchema: { type: "object", properties: { server: { type: "string" }, userId: { type: "string" } }, required: ["userId"] },
      },
      {
        name: "assign-role",
        description: "Assign a role to a member",
        inputSchema: { type: "object", properties: { server: { type: "string" }, user: { type: "string" }, role: { type: "string", description: "Role name or ID" } }, required: ["user", "role"] },
      },
      {
        name: "remove-role",
        description: "Remove a role from a member",
        inputSchema: { type: "object", properties: { server: { type: "string" }, user: { type: "string" }, role: { type: "string", description: "Role name or ID" } }, required: ["user", "role"] },
      },
      {
        name: "list-members",
        description: "List server members with their roles",
        inputSchema: { type: "object", properties: { server: { type: "string" }, limit: { type: "number", description: "Max members (default 50, max 100)" } } },
      },
      {
        name: "get-message",
        description: "Fetch one message by link, or by channel and message ID, with its embeds, attachments, reactions and reply preview",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri", description: "Discord message link (https://discord.com/channels/<server>/<channel>/<message>)" },
            server: { type: "string", description: "Server name or ID (ignored when url is given)" },
            channel: { type: "string", description: "Channel name or ID (ignored when url is given)" },
            messageId: { type: "string", description: "Message ID (with channel)" },
          },
        },
      },
      {
        name: "list-pins",
        description: "List every pinned message in a channel, newest first, in the same shape as read-messages",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" } }, required: ["channel"] },
      },
      {
        name: "get-channel-info",
        description: "Channel settings: topic, category, slowmode, pin count, effective @everyone permissions and permission overwrites",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" } }, required: ["channel"] },
      },
      {
        name: "set-channel-permissions",
        description: "Set a channel permission overwrite for one role or member: allow, deny, or clear (inherit) named permissions",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, channel: { type: "string", description: "Channel name or ID (any type)" },
            role: { type: "string", description: "Role name or ID (use this or member)" },
            member: { type: "string", description: "Username, display name or user ID (use this or role)" },
            allow: { type: "array", items: { type: "string" }, description: "Permission names to grant, e.g. ViewChannel, SendMessages" },
            deny: { type: "array", items: { type: "string" } },
            clear: { type: "array", items: { type: "string" }, description: "Permission names to reset to inherit" },
            reason: { type: "string" },
          },
          required: ["channel"],
        },
      },
      {
        name: "remove-channel-overwrite",
        description: "Remove a role's or member's permission overwrite from a channel so it inherits from roles again",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" }, role: { type: "string" }, member: { type: "string" }, reason: { type: "string" } }, required: ["channel"] },
      },
      {
        name: "create-automod-rule",
        description: "Create a Discord AutoMod rule: keyword (words/regex), keyword_preset (profanity, sexual_content, slurs), spam, or mention_spam; actions block the message, alert a channel and/or time the member out",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 100 },
            trigger: { type: "string", enum: ["keyword", "keyword_preset", "spam", "mention_spam"] },
            keywords: { type: "array", items: { type: "string" }, description: "keyword: words or phrases; * wildcards allowed" },
            regexPatterns: { type: "array", items: { type: "string" }, maxItems: 10, description: "keyword: Rust-flavoured regexes" },
            allowList: { type: "array", items: { type: "string" }, description: "Words that never trigger the rule" },
            presets: { type: "array", items: { type: "string", enum: ["profanity", "sexual_content", "slurs"] } },
            mentionLimit: { type: "integer", minimum: 1, maximum: 50, description: "mention_spam: max unique mentions per message" },
            blockMessage: { type: "boolean", default: true },
            customMessage: { type: "string", maxLength: 150, description: "Shown to the member when their message is blocked" },
            alertChannel: { type: "string", description: "Text channel that receives an alert" },
            timeoutMinutes: { type: "integer", minimum: 1, maximum: 40320, description: "keyword and mention_spam only" },
            exemptRoles: { type: "array", items: { type: "string" } },
            exemptChannels: { type: "array", items: { type: "string" } },
            enabled: { type: "boolean", default: true },
            reason: { type: "string" },
          },
          required: ["name", "trigger"],
        },
      },
      {
        name: "list-automod-rules",
        description: "List AutoMod rules as JSON with triggers, keywords, presets, actions and exemptions",
        inputSchema: { type: "object", properties: { server: { type: "string" } } },
      },
      {
        name: "delete-automod-rule",
        description: "Delete an AutoMod rule by name or ID",
        inputSchema: { type: "object", properties: { server: { type: "string" }, rule: { type: "string" }, reason: { type: "string" } }, required: ["rule"] },
      },
      {
        name: "create-event",
        description: "Create a scheduled event, either in a voice/stage channel or at an external location (which needs an endTime)",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 100 },
            description: { type: "string", maxLength: 1000 },
            startTime: { type: "string", description: "ISO 8601 with offset, e.g. 2026-09-26T20:00:00-05:00" },
            endTime: { type: "string", description: "ISO 8601; required for external events" },
            location: { type: "string", description: "Free text such as the server name (external event)" },
            channel: { type: "string", description: "Voice or stage channel name or ID" },
            image: { type: "string", format: "uri", description: "Cover image URL" },
            reason: { type: "string" },
          },
          required: ["name", "startTime"],
        },
      },
      {
        name: "list-events",
        description: "List scheduled events as JSON with status, times, location or channel, and interested counts",
        inputSchema: { type: "object", properties: { server: { type: "string" } } },
      },
      {
        name: "delete-event",
        description: "Delete a scheduled event by name or ID",
        inputSchema: { type: "object", properties: { server: { type: "string" }, event: { type: "string" } }, required: ["event"] },
      },
      {
        name: "timeout-member",
        description: "Time a member out (Discord mute) for a number of minutes, up to 28 days",
        inputSchema: { type: "object", properties: { server: { type: "string" }, user: { type: "string", description: "Username, display name or user ID" }, minutes: { type: "integer", minimum: 1, maximum: 40320 }, reason: { type: "string" } }, required: ["user", "minutes"] },
      },
      {
        name: "remove-timeout",
        description: "End a member's timeout early",
        inputSchema: { type: "object", properties: { server: { type: "string" }, user: { type: "string" }, reason: { type: "string" } }, required: ["user"] },
      },
      {
        name: "get-onboarding",
        description: "Read the Community onboarding setup: prompts, their options with roles and channels, default channels, mode and whether it is enabled",
        inputSchema: { type: "object", properties: { server: { type: "string" } } },
      },
      {
        name: "set-onboarding",
        description: "Configure Community onboarding. prompts replaces the whole prompt list (each option grants roles and/or channels by name); defaultChannels, enabled and mode are optional. Requires the COMMUNITY feature.",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            prompts: { type: "array", maxItems: 15, items: { type: "object", properties: {
              title: { type: "string", maxLength: 100 },
              type: { type: "string", enum: ["multiple_choice", "dropdown"], default: "multiple_choice" },
              singleSelect: { type: "boolean", default: false },
              required: { type: "boolean", default: false },
              inOnboarding: { type: "boolean", default: true, description: "Ask during onboarding, not only on the Channels & Roles page" },
              options: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", properties: {
                title: { type: "string", maxLength: 50 }, description: { type: "string", maxLength: 100 }, emoji: { type: "string" },
                roles: { type: "array", items: { type: "string" } }, channels: { type: "array", items: { type: "string" } },
              }, required: ["title"] } },
            }, required: ["title", "options"] } },
            defaultChannels: { type: "array", items: { type: "string" }, description: "Channels every new member sees (Discord wants at least 7 @everyone-visible)" },
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["default", "advanced"] },
            reason: { type: "string" },
          },
        },
      },
      {
        name: "get-welcome-screen",
        description: "Read the Community welcome screen: enabled, description and featured channels",
        inputSchema: { type: "object", properties: { server: { type: "string" } } },
      },
      {
        name: "set-welcome-screen",
        description: "Set the Community welcome screen: enabled, description (max 140) and up to five featured channels with a short description and optional emoji",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, enabled: { type: "boolean" }, description: { type: "string", maxLength: 140 },
            channels: { type: "array", maxItems: 5, items: { type: "object", properties: {
              channel: { type: "string" }, description: { type: "string", maxLength: 50 }, emoji: { type: "string" },
            }, required: ["channel", "description"] } },
          },
        },
      },
      {
        name: "edit-channel",
        description: "Rename a channel, set or clear (null) its topic, move it under a category (null for none), set slowmode or NSFW",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" }, channel: { type: "string" }, name: { type: "string" },
            topic: { type: ["string", "null"] }, category: { type: ["string", "null"], description: "Category name or ID; null moves it out" },
            slowmodeSeconds: { type: "integer", minimum: 0, maximum: 21600 }, nsfw: { type: "boolean" }, reason: { type: "string" },
          },
          required: ["channel"],
        },
      },
      {
        name: "get-rules-screening",
        description: "Read Rules Screening (membership screening): whether it has been set up, its description and the rules new members must accept",
        inputSchema: { type: "object", properties: { server: { type: "string" } } },
      },
      {
        name: "set-rules-screening",
        description: "Set Rules Screening on a Community server: the list of rules (replaces all, max 16) new members must accept before they can talk, an optional description, and enabled",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string" },
            rules: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", maxLength: 300 } },
            enabled: { type: "boolean" },
            description: { type: ["string", "null"], maxLength: 300 },
            reason: { type: "string" },
          },
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "send-message": {
        return await sendMessage(args, findChannel);
      }

      case "read-messages": {
        return await readMessages(args, findChannel);
      }

      case "get-message": {
        return await getMessage(args, findChannel);
      }

      case "list-pins": {
        return await listPins(args, findChannel);
      }

      case "get-channel-info": {
        return await getChannelInfo(args, findChannel);
      }

      case "create-category": {
        const { server: srv, name: catName } = CreateCategorySchema.parse(args);
        const guild = await findGuild(srv);
        const category = await guild.channels.create({
          name: catName,
          type: ChannelType.GuildCategory,
        });
        return {
          content: [{ type: "text", text: `Category "${category.name}" created in ${guild.name}. ID: ${category.id}` }],
        };
      }

      case "create-channel": {
        const { server: srv, name: chName, category: catId, topic, type, tags } = CreateChannelSchema.parse(args);
        const guild = await findGuild(srv);
        let parent: string | undefined;
        let parentName = '';
        if (catId) {
          const found = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory &&
              (c.id === catId || c.name.toLowerCase() === catId.toLowerCase())
          );
          if (!found) throw new Error(`Category "${catId}" not found in ${guild.name}`);
          parent = found.id;
          parentName = found.name;
        }
        const channelType = {
          text: ChannelType.GuildText, voice: ChannelType.GuildVoice,
          forum: ChannelType.GuildForum, announcement: ChannelType.GuildAnnouncement,
        }[type];
        const channel = await guild.channels.create({
          name: chName,
          type: channelType,
          parent,
          topic: topic || undefined,
          ...(type === 'forum' && tags ? { availableTags: tags.map(tagName => ({ name: tagName })) } : {}),
        } as any);
        return {
          content: [{ type: "text", text: `${type} channel "${channel.name}" created in ${guild.name}${parent ? ` under ${parentName}` : ''}. ID: ${channel.id}` }],
        };
      }

      case "list-channels": {
        const { server: srv } = ListChannelsSchema.parse(args);
        const guild = await findGuild(srv);
        await guild.channels.fetch();
        const listable = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildAnnouncement]);
        const label = (c: { type: ChannelType; name: string }) =>
          c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice ? `\u{1F50A} ${c.name} (voice)`
          : c.type === ChannelType.GuildForum ? `\u{1F4CB} ${c.name} (forum)`
          : c.type === ChannelType.GuildAnnouncement ? `\u{1F4E2} ${c.name} (announcements)`
          : `#${c.name}`;
        const categories = guild.channels.cache
          .filter(c => c.type === ChannelType.GuildCategory)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const lines: string[] = [];
        for (const [, cat] of categories) {
          lines.push(`\n📁 ${cat.name.toUpperCase()}`);
          const children = guild.channels.cache
            .filter(c => c.parentId === cat.id && listable.has(c.type))
            .sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0));
          for (const [, ch] of children) {
            lines.push(`  ${label(ch)}`);
          }
        }
        const orphans = guild.channels.cache
          .filter(c => !c.parentId && listable.has(c.type))
          .sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0));
        if (orphans.size > 0) {
          lines.push(`\n📁 (no category)`);
          for (const [, ch] of orphans) {
            lines.push(`  ${label(ch)}`);
          }
        }
        return {
          content: [{ type: "text", text: `Channels in ${guild.name}:${lines.join('\n')}` }],
        };
      }

      case "set-channel-topic": {
        const { server: srv, channel: chId, topic } = SetChannelTopicSchema.parse(args);
        const channel = await findChannel(chId, srv);
        await channel.setTopic(topic);
        return {
          content: [{ type: "text", text: `Topic for #${channel.name} set to: ${topic}` }],
        };
      }

      case "lock-channel": {
        const { server: srv, channel: chId } = LockChannelSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const everyoneRole = channel.guild.roles.everyone;
        await channel.permissionOverwrites.edit(everyoneRole, {
          SendMessages: false,
          AddReactions: false,
        });
        return {
          content: [{ type: "text", text: `#${channel.name} locked — only admins can post, everyone else can read.` }],
        };
      }

      case "send-embed": {
        return await sendEmbed(args, findChannel);
      }

      case "add-reaction": {
        const { server: srv, channel: chId, messageId, emoji } = AddReactionSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const message = await channel.messages.fetch(messageId);
        await message.react(emoji);
        return {
          content: [{ type: "text", text: `Reacted with ${emoji} on message ${messageId} in #${channel.name}` }],
        };
      }

      case "create-role": {
        return await createRole(args, resolvers);
      }

      case "edit-role": {
        return await editRole(args, resolvers);
      }

      case "delete-role": {
        return await deleteRole(args, resolvers);
      }

      case "list-roles": {
        return await listRoles(args, resolvers);
      }

      case "delete-channel": {
        const { server: srv, channel: chId } = DeleteChannelSchema.parse(args);
        const channel = await findGuildChannel(chId, srv);
        const name = channel.name;
        await channel.delete();
        return {
          content: [{ type: "text", text: `Channel #${name} deleted.` }],
        };
      }

      case "delete-message": {
        const { server: srv, channel: chId, messageId } = DeleteMessageSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        return {
          content: [{ type: "text", text: `Message ${messageId} deleted from #${channel.name}.` }],
        };
      }

      case "edit-message": {
        const { server: srv, channel: chId, messageId, message: newContent } = EditMessageSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const msg = await channel.messages.fetch(messageId);
        await msg.edit(newContent);
        return { content: [{ type: "text", text: `Message ${messageId} edited in #${channel.name}.` }] };
      }

      case "edit-embed": {
        return await editEmbed(args, findChannel);
      }

      case "pin-message": {
        const { server: srv, channel: chId, messageId } = PinMessageSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const msg = await channel.messages.fetch(messageId);
        await msg.pin();
        return { content: [{ type: "text", text: `Message ${messageId} pinned in #${channel.name}.` }] };
      }

      case "unpin-message": {
        const { server: srv, channel: chId, messageId } = UnpinMessageSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const msg = await channel.messages.fetch(messageId);
        await msg.unpin();
        return { content: [{ type: "text", text: `Message ${messageId} unpinned in #${channel.name}.` }] };
      }

      case "create-invite": {
        const { server: srv, channel: chId, maxAge, maxUses } = CreateInviteSchema.parse(args);
        const guild = await findGuild(srv);
        let channel: TextChannel;
        if (chId) {
          channel = await findChannel(chId, srv);
        } else {
          const first = guild.channels.cache.find((c): c is TextChannel => c instanceof TextChannel);
          if (!first) throw new Error("No text channel found for invite");
          channel = first;
        }
        const invite = await channel.createInvite({
          maxAge: maxAge ?? 0,
          maxUses: maxUses ?? 0,
        });
        return { content: [{ type: "text", text: `Invite created: https://discord.gg/${invite.code} (expires: ${maxAge ? `${maxAge}s` : 'never'}, uses: ${maxUses || 'unlimited'})` }] };
      }

      case "get-server-info": {
        const { server: srv } = GetServerInfoSchema.parse(args);
        const guild = await findGuild(srv);
        const info = [
          `**${guild.name}**`,
          `ID: ${guild.id}`,
          `Owner: <@${guild.ownerId}>`,
          `Members: ${guild.memberCount}`,
          `Boosts: ${guild.premiumSubscriptionCount || 0} (Level ${guild.premiumTier})`,
          `Channels: ${guild.channels.cache.size}`,
          `Roles: ${guild.roles.cache.size}`,
          `Created: ${guild.createdAt.toISOString().split('T')[0]}`,
          `Verification level: ${guild.verificationLevel}`,
          `Features: ${guild.features.length ? guild.features.join(', ') : 'none'}`,
        ];
        return { content: [{ type: "text", text: info.join('\n') }] };
      }

      case "set-slowmode": {
        const { server: srv, channel: chId, seconds } = SetSlowmodeSchema.parse(args);
        const channel = await findChannel(chId, srv);
        await channel.setRateLimitPerUser(seconds);
        return { content: [{ type: "text", text: seconds > 0 ? `#${channel.name} slowmode set to ${seconds}s.` : `#${channel.name} slowmode disabled.` }] };
      }

      case "unlock-channel": {
        const { server: srv, channel: chId } = UnlockChannelSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const everyoneRole = channel.guild.roles.everyone;
        await channel.permissionOverwrites.edit(everyoneRole, {
          SendMessages: null,
          AddReactions: null,
        });
        return { content: [{ type: "text", text: `#${channel.name} unlocked — everyone can post.` }] };
      }

      case "kick-member": {
        const { server: srv, user, reason } = KickMemberSchema.parse(args);
        const guild = await findGuild(srv);
        const member = await findMember(guild, user);
        await member.kick(reason);
        return { content: [{ type: "text", text: `${member.user.tag} kicked from ${guild.name}.${reason ? ` Reason: ${reason}` : ''}` }] };
      }

      case "ban-member": {
        const { server: srv, user, reason, deleteMessages } = BanMemberSchema.parse(args);
        const guild = await findGuild(srv);
        const member = await findMember(guild, user);
        await member.ban({ reason: reason || undefined, deleteMessageSeconds: (deleteMessages || 0) * 86400 });
        return { content: [{ type: "text", text: `${member.user.tag} banned from ${guild.name}.${reason ? ` Reason: ${reason}` : ''}` }] };
      }

      case "unban-user": {
        const { server: srv, userId } = UnbanUserSchema.parse(args);
        const guild = await findGuild(srv);
        await guild.bans.remove(userId);
        return { content: [{ type: "text", text: `User ${userId} unbanned from ${guild.name}.` }] };
      }

      case "assign-role": {
        const { server: srv, user, role: roleId } = AssignRoleSchema.parse(args);
        const guild = await findGuild(srv);
        const member = await findMember(guild, user);
        const role = await findRole(guild, roleId);
        await member.roles.add(role);
        return { content: [{ type: "text", text: `Role "${role.name}" assigned to ${member.user.tag}.` }] };
      }

      case "remove-role": {
        const { server: srv, user, role: roleId } = RemoveRoleSchema.parse(args);
        const guild = await findGuild(srv);
        const member = await findMember(guild, user);
        const role = await findRole(guild, roleId);
        await member.roles.remove(role);
        return { content: [{ type: "text", text: `Role "${role.name}" removed from ${member.user.tag}.` }] };
      }

      case "list-members": {
        const { server: srv, limit } = ListMembersSchema.parse(args);
        const guild = await findGuild(srv);
        const fetched = await guild.members.list({ limit: limit || 50, cache: false });
        const members = fetched
          .sort((a: GuildMember, b: GuildMember) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0))
          .first(limit || 50);
        const lines = members?.map((m: GuildMember) => {
          const roles = m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ');
          return `${m.user.tag} (${m.displayName})${roles ? ` [${roles}]` : ''}`;
        }) || [];
        return { content: [{ type: "text", text: `Members of ${guild.name} (${guild.memberCount} total):\n${lines.join('\n')}` }] };
      }

      case "edit-automod-rule": return await editAutomodRule(args, resolvers);
      case "edit-event": return await editEvent(args, resolvers);

      case "set-channel-permissions": {
        return await setChannelPermissions(args, resolvers);
      }

      case "remove-channel-overwrite": {
        return await removeChannelOverwrite(args, resolvers);
      }

      case "create-automod-rule": {
        return await createAutomodRule(args, resolvers);
      }

      case "list-automod-rules": {
        return await listAutomodRules(args, resolvers);
      }

      case "delete-automod-rule": {
        return await deleteAutomodRule(args, resolvers);
      }

      case "create-event": {
        return await createEvent(args, resolvers);
      }

      case "list-events": {
        return await listEvents(args, resolvers);
      }

      case "delete-event": {
        return await deleteEvent(args, resolvers);
      }

      case "timeout-member": {
        return await timeoutMember(args, resolvers);
      }

      case "remove-timeout": {
        return await removeTimeout(args, resolvers);
      }

      case "get-onboarding": return await getOnboarding(args, resolvers);
      case "set-onboarding": return await setOnboarding(args, resolvers);
      case "get-welcome-screen": return await getWelcomeScreen(args, resolvers);
      case "set-welcome-screen": return await setWelcomeScreen(args, resolvers);
      case "edit-channel": return await editChannel(args, resolvers);
      case "get-rules-screening": return await getRulesScreening(args, resolvers);
      case "set-rules-screening": return await setRulesScreening(args, resolvers);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// Discord client login and error handling
client.once('ready', () => {
  console.error('Discord bot is ready!');
});

// Start the server
async function main() {
  // Check for Discord token
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is not set');
  }
  
  try {
    // Login to Discord
    await client.login(token);

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Discord MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main();