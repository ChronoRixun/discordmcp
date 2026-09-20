import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from 'dotenv';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, ChannelType, PermissionFlagsBits, GuildMember } from 'discord.js';
import { z } from 'zod';
import { readMessages } from './read-messages.js';

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

// Updated validation schemas
const SendMessageSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Channel name (e.g., "general") or ID'),
  message: z.string(),
});

const CreateCategorySchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  name: z.string().describe('Category name'),
});

const CreateChannelSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  name: z.string().describe('Channel name'),
  category: z.string().optional().describe('Category name or ID to place the channel under'),
  topic: z.string().optional().describe('Channel topic/description'),
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

const SendEmbedSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  title: z.string().optional().describe('Embed title'),
  description: z.string().optional().describe('Embed body text (supports markdown)'),
  color: z.string().optional().describe('Hex color (e.g. "#E8A33D")'),
  fields: z.array(z.object({
    name: z.string(),
    value: z.string(),
    inline: z.boolean().optional(),
  })).optional().describe('Embed fields'),
  footer: z.string().optional().describe('Footer text'),
  thumbnail: z.string().optional().describe('Thumbnail URL'),
  image: z.string().optional().describe('Large image URL'),
});

const AddReactionSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID to react to'),
  emoji: z.string().describe('Emoji (unicode or custom format)'),
});

const CreateRoleSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  name: z.string().describe('Role name'),
  color: z.string().optional().describe('Hex color (e.g. "#E8A33D")'),
});

const ListRolesSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
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

const EditEmbedSchema = z.object({
  server: z.string().optional().describe('Server name or ID'),
  channel: z.string().describe('Channel name or ID'),
  messageId: z.string().describe('Message ID containing the embed to edit'),
  title: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  fields: z.array(z.object({ name: z.string(), value: z.string(), inline: z.boolean().optional() })).optional(),
  footer: z.string().optional(),
  thumbnail: z.string().optional(),
  image: z.string().optional(),
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
  limit: z.number().min(1).max(100).optional().describe('Max members to list'),
});

// Helper to find a member by name or ID
async function findMember(guild: any, userIdentifier: string): Promise<GuildMember> {
  try {
    const member = await guild.members.fetch(userIdentifier);
    if (member) return member;
  } catch {}
  await guild.members.fetch();
  const found = guild.members.cache.find(
    (m: GuildMember) =>
      m.user.username.toLowerCase() === userIdentifier.toLowerCase() ||
      m.displayName.toLowerCase() === userIdentifier.toLowerCase() ||
      m.user.tag.toLowerCase() === userIdentifier.toLowerCase()
  );
  if (!found) throw new Error(`Member "${userIdentifier}" not found`);
  return found;
}

// Helper to find a role by name or ID
async function findRole(guild: any, roleIdentifier: string) {
  const role = guild.roles.cache.find(
    (r: any) => r.id === roleIdentifier || r.name.toLowerCase() === roleIdentifier.toLowerCase()
  );
  if (!role) throw new Error(`Role "${roleIdentifier}" not found`);
  return role;
}

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
      {
        name: "send-message",
        description: "Send a message to a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            channel: {
              type: "string",
              description: 'Channel name (e.g., "general") or ID',
            },
            message: {
              type: "string",
              description: "Message content to send",
            },
          },
          required: ["channel", "message"],
        },
      },
      {
        name: "read-messages",
        description: "Read recent messages with IDs, links, embeds, attachments, reactions, and reply references (newest first)",
        inputSchema: {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: 'Server name or ID (optional if bot is only in one server)',
            },
            channel: {
              type: "string",
              description: 'Channel name (e.g., "general") or ID',
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              description: "Number of messages to fetch (max 100)",
              default: 50,
            },
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
        description: "Create a text channel, optionally under a category",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            name: { type: "string", description: "Channel name" },
            category: { type: "string", description: "Category name or ID to place the channel under" },
            topic: { type: "string", description: "Channel topic/description" },
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
        description: "Send a rich embed message to a Discord channel",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            channel: { type: "string", description: "Channel name or ID" },
            title: { type: "string", description: "Embed title" },
            description: { type: "string", description: "Embed body (supports markdown)" },
            color: { type: "string", description: "Hex color (e.g. #E8A33D)" },
            fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, inline: { type: "boolean" } }, required: ["name", "value"] }, description: "Embed fields" },
            footer: { type: "string", description: "Footer text" },
            thumbnail: { type: "string", description: "Thumbnail URL" },
            image: { type: "string", description: "Large image URL" },
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
        description: "Create a role in the Discord server",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
            name: { type: "string", description: "Role name" },
            color: { type: "string", description: "Hex color (e.g. #E8A33D)" },
          },
          required: ["name"],
        },
      },
      {
        name: "list-roles",
        description: "List all roles in the Discord server",
        inputSchema: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server name or ID" },
          },
        },
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
        description: "Edit an existing embed message sent by the bot",
        inputSchema: { type: "object", properties: { server: { type: "string" }, channel: { type: "string" }, messageId: { type: "string" }, title: { type: "string" }, description: { type: "string" }, color: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, inline: { type: "boolean" } }, required: ["name", "value"] } }, footer: { type: "string" }, thumbnail: { type: "string" }, image: { type: "string" } }, required: ["channel", "messageId"] },
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
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "send-message": {
        const { channel: channelIdentifier, message } = SendMessageSchema.parse(args);
        const channel = await findChannel(channelIdentifier);
        
        const sent = await channel.send(message);
        return {
          content: [{
            type: "text",
            text: `Message sent successfully to #${channel.name} in ${channel.guild.name}. Message ID: ${sent.id}`,
          }],
        };
      }

      case "read-messages": {
        return await readMessages(args, findChannel);
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
        const { server: srv, name: chName, category: catId, topic } = CreateChannelSchema.parse(args);
        const guild = await findGuild(srv);
        let parent = undefined;
        if (catId) {
          const found = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory &&
              (c.id === catId || c.name.toLowerCase() === catId.toLowerCase())
          );
          if (found) parent = found.id;
        }
        const channel = await guild.channels.create({
          name: chName,
          type: ChannelType.GuildText,
          parent,
          topic: topic || undefined,
        });
        return {
          content: [{ type: "text", text: `Channel #${channel.name} created in ${guild.name}${parent ? ` under category` : ''}. ID: ${channel.id}` }],
        };
      }

      case "list-channels": {
        const { server: srv } = ListChannelsSchema.parse(args);
        const guild = await findGuild(srv);
        await guild.channels.fetch();
        const categories = guild.channels.cache
          .filter(c => c.type === ChannelType.GuildCategory)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const lines: string[] = [];
        for (const [, cat] of categories) {
          lines.push(`\n📁 ${cat.name.toUpperCase()}`);
          const children = guild.channels.cache
            .filter(c => c.parentId === cat.id && c.type === ChannelType.GuildText)
            .sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0));
          for (const [, ch] of children) {
            lines.push(`  #${ch.name}`);
          }
        }
        const orphans = guild.channels.cache
          .filter(c => !c.parentId && c.type === ChannelType.GuildText)
          .sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0));
        if (orphans.size > 0) {
          lines.push(`\n📁 (no category)`);
          for (const [, ch] of orphans) {
            lines.push(`  #${ch.name}`);
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
        const { server: srv, channel: chId, title, description, color, fields, footer, thumbnail, image } = SendEmbedSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const embed: any = {};
        if (title) embed.title = title;
        if (description) embed.description = description;
        if (color) embed.color = parseInt(color.replace('#', ''), 16);
        if (fields) embed.fields = fields;
        if (footer) embed.footer = { text: footer };
        if (thumbnail) embed.thumbnail = { url: thumbnail };
        if (image) embed.image = { url: image };
        const sent = await channel.send({ embeds: [embed] });
        return {
          content: [{ type: "text", text: `Embed sent to #${channel.name}. Message ID: ${sent.id}` }],
        };
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
        const { server: srv, name: roleName, color: roleColor } = CreateRoleSchema.parse(args);
        const guild = await findGuild(srv);
        const role = await guild.roles.create({
          name: roleName,
          color: roleColor ? (parseInt(roleColor.replace('#', ''), 16)) : undefined,
        });
        return {
          content: [{ type: "text", text: `Role "${role.name}" created in ${guild.name}. ID: ${role.id}` }],
        };
      }

      case "list-roles": {
        const { server: srv } = ListRolesSchema.parse(args);
        const guild = await findGuild(srv);
        const roles = guild.roles.cache
          .filter(r => r.name !== '@everyone')
          .sort((a, b) => b.position - a.position)
          .map(r => `${r.name} (${r.hexColor}, ${r.members.size} members)`);
        return {
          content: [{ type: "text", text: `Roles in ${guild.name}:\n${roles.join('\n')}` }],
        };
      }

      case "delete-channel": {
        const { server: srv, channel: chId } = DeleteChannelSchema.parse(args);
        const channel = await findChannel(chId, srv);
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
        const { server: srv, channel: chId, messageId, title, description, color, fields, footer, thumbnail, image } = EditEmbedSchema.parse(args);
        const channel = await findChannel(chId, srv);
        const msg = await channel.messages.fetch(messageId);
        const embed: any = {};
        if (title) embed.title = title;
        if (description) embed.description = description;
        if (color) embed.color = parseInt(color.replace('#', ''), 16);
        if (fields) embed.fields = fields;
        if (footer) embed.footer = { text: footer };
        if (thumbnail) embed.thumbnail = { url: thumbnail };
        if (image) embed.image = { url: image };
        await msg.edit({ embeds: [embed] });
        return { content: [{ type: "text", text: `Embed ${messageId} edited in #${channel.name}.` }] };
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
        await guild.members.fetch();
        const info = [
          `**${guild.name}**`,
          `ID: ${guild.id}`,
          `Owner: <@${guild.ownerId}>`,
          `Members: ${guild.memberCount}`,
          `Boosts: ${guild.premiumSubscriptionCount || 0} (Level ${guild.premiumTier})`,
          `Channels: ${guild.channels.cache.size}`,
          `Roles: ${guild.roles.cache.size}`,
          `Created: ${guild.createdAt.toISOString().split('T')[0]}`,
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
        await guild.members.fetch({ limit: limit || 50 });
        const members = guild.members.cache
          .sort((a: GuildMember, b: GuildMember) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0))
          .first(limit || 50);
        const lines = members?.map((m: GuildMember) => {
          const roles = m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ');
          return `${m.user.tag} (${m.displayName})${roles ? ` [${roles}]` : ''}`;
        }) || [];
        return { content: [{ type: "text", text: `Members of ${guild.name} (${guild.memberCount} total):\n${lines.join('\n')}` }] };
      }

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