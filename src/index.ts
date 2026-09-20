import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from 'dotenv';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, ChannelType, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
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

const ReadMessagesSchema = z.object({
  server: z.string().optional().describe('Server name or ID (optional if bot is only in one server)'),
  channel: z.string().describe('Channel name (e.g., "general") or ID'),
  limit: z.number().min(1).max(100).default(50),
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
        description: "Read recent messages from a Discord channel",
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
              type: "number",
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
        const { channel: channelIdentifier, limit } = ReadMessagesSchema.parse(args);
        const channel = await findChannel(channelIdentifier);
        
        const messages = await channel.messages.fetch({ limit });
        const formattedMessages = Array.from(messages.values()).map(msg => ({
          channel: `#${channel.name}`,
          server: channel.guild.name,
          author: msg.author.tag,
          content: msg.content,
          timestamp: msg.createdAt.toISOString(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify(formattedMessages, null, 2),
          }],
        };
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