import { EmbedBuilder, type APIEmbed, type TextChannel } from 'discord.js';
import { z } from 'zod';
import { snowflake } from './read-messages.js';

const embedProperties = ['title', 'description', 'color', 'fields', 'footer', 'thumbnail', 'image'] as const;

export const SendMessageSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
  message: z.string().min(1).max(2000),
  replyTo: snowflake.optional(),
});

export const SendEmbedSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
  content: z.string().min(1).max(2000).optional(),
  replyTo: snowflake.optional(),
  title: z.string().min(1).max(256).optional(),
  description: z.string().min(1).max(4096).optional(),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(z.object({
    name: z.string().min(1).max(256),
    value: z.string().min(1).max(1024),
    inline: z.boolean().optional(),
  })).max(25).optional(),
  footer: z.string().min(1).max(2048).optional(),
  thumbnail: z.string().url().optional(),
  image: z.string().url().optional(),
}).refine(value => embedProperties.some(key => value[key] !== undefined),
  'Provide at least one embed property');

type ChannelResolver = (channel: string, server?: string) => Promise<TextChannel>;
type EmbedInput = Pick<z.infer<typeof SendEmbedSchema>, typeof embedProperties[number]>;

/** Builds and validates the embed; omitted properties are left out entirely. */
export function buildEmbed(input: EmbedInput): APIEmbed {
  const embed: APIEmbed = {};
  if (input.title !== undefined) embed.title = input.title;
  if (input.description !== undefined) embed.description = input.description;
  if (input.color !== undefined) embed.color = parseInt(input.color.replace('#', ''), 16);
  if (input.fields !== undefined) embed.fields = input.fields;
  if (input.footer !== undefined) embed.footer = { text: input.footer };
  if (input.thumbnail !== undefined) embed.thumbnail = { url: input.thumbnail };
  if (input.image !== undefined) embed.image = { url: input.image };
  return new EmbedBuilder(embed).toJSON();
}

function replyOptions(replyTo: string | undefined) {
  // failIfNotExists: a mistyped id must not silently post as a plain message.
  return replyTo ? { reply: { messageReference: replyTo, failIfNotExists: true } } : {};
}

export async function sendMessage(args: unknown, findChannel: ChannelResolver) {
  const { server, channel: identifier, message, replyTo } = SendMessageSchema.parse(args);
  const channel = await findChannel(identifier, server);
  const sent = await channel.send({ content: message, ...replyOptions(replyTo) });
  return { content: [{ type: 'text' as const,
    text: `Message sent to #${channel.name} in ${channel.guild.name}. Message ID: ${sent.id}. Link: ${sent.url}` }] };
}

export async function sendEmbed(args: unknown, findChannel: ChannelResolver) {
  const { server, channel: identifier, content, replyTo, ...embedInput } = SendEmbedSchema.parse(args);
  const embed = buildEmbed(embedInput);
  const channel = await findChannel(identifier, server);
  const sent = await channel.send({ ...(content !== undefined && { content }), embeds: [embed], ...replyOptions(replyTo) });
  return { content: [{ type: 'text' as const,
    text: `Embed sent to #${channel.name} in ${channel.guild.name}. Message ID: ${sent.id}. Link: ${sent.url}` }] };
}
