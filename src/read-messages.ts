import type { Message, TextChannel } from 'discord.js';
import { z } from 'zod';

export const ReadMessagesSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** Explicit projection: never serialize the Discord client or download attachments. */
export function serializeMessage(message: Message, channel: TextChannel) {
  const reference = message.reference;
  return {
    id: message.id,
    url: message.url,
    channel: `#${channel.name}`,
    channelId: channel.id,
    server: channel.guild.name,
    serverId: channel.guild.id,
    author: message.author.tag,
    authorId: message.author.id,
    authorBot: message.author.bot,
    content: message.content,
    timestamp: message.createdAt.toISOString(),
    editedTimestamp: message.editedAt?.toISOString() ?? null,
    type: message.type,
    pinned: message.pinned,
    embeds: message.embeds.map(embed => embed.toJSON()),
    attachments: Array.from(message.attachments.values(), attachment => ({
      id: attachment.id,
      name: attachment.name,
      description: attachment.description,
      url: attachment.url,
      contentType: attachment.contentType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      spoiler: attachment.spoiler,
    })),
    reactions: Array.from(message.reactions.cache.values(), reaction => ({
      emoji: {
        id: reaction.emoji.id,
        name: reaction.emoji.name,
        animated: reaction.emoji.animated ?? false,
      },
      count: reaction.count,
      me: reaction.me,
    })),
    reference: reference ? {
      messageId: reference.messageId ?? null,
      channelId: reference.channelId,
      serverId: reference.guildId ?? null,
      url: reference.messageId && reference.guildId
        ? `https://discord.com/channels/${reference.guildId}/${reference.channelId}/${reference.messageId}`
        : null,
    } : null,
    thread: message.thread ? {
      id: message.thread.id,
      name: message.thread.name,
      archived: message.thread.archived,
      url: message.thread.url,
    } : null,
  };
}

/** One history request, with reply previews limited to messages in that batch. */
export async function readMessages(
  args: unknown,
  findChannel: (channel: string, server?: string) => Promise<TextChannel>,
) {
  const { server, channel: identifier, limit } = ReadMessagesSchema.parse(args);
  const channel = await findChannel(identifier, server);
  const messages = await channel.messages.fetch({ limit, cache: false });
  const formatted = Array.from(messages.values(), message => {
    const reference = message.reference;
    const repliedTo = reference?.channelId === channel.id && reference.messageId
      ? messages.get(reference.messageId)
      : undefined;
    return {
      ...serializeMessage(message, channel),
      replyPreview: repliedTo ? {
        id: repliedTo.id,
        author: repliedTo.author.tag,
        content: repliedTo.content,
        embeds: repliedTo.embeds.map(embed => embed.toJSON()),
      } : null,
    };
  });
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
  };
}
