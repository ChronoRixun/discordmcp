import { MessageType, type Message, type TextChannel } from 'discord.js';
import { z } from 'zod';

export const snowflake = z.string().regex(/^\d{17,20}$/, 'Expected a Discord ID');

export const ReadMessagesSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
  limit: z.number().int().min(1).max(100).default(50),
  before: snowflake.optional(),
  after: snowflake.optional(),
  author: z.string().min(1).optional(),
  excludeSystem: z.boolean().default(false),
  includePageInfo: z.boolean().default(false),
}).refine(value => !(value.before && value.after), 'Use before or after, not both');

export const GetMessageSchema = z.object({
  server: z.string().optional(),
  channel: z.string().optional(),
  messageId: snowflake.optional(),
  url: z.string().url().optional(),
}).refine(value => value.url || (value.channel && value.messageId),
  'Provide a message url, or channel and messageId');

export const ListPinsSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
});

type ChannelResolver = (channel: string, server?: string) => Promise<TextChannel>;

/** Snowflakes are time-ordered, so a numeric compare is a chronological compare. */
export function newestFirst(a: { id: string }, b: { id: string }): number {
  const left = BigInt(a.id), right = BigInt(b.id);
  return left === right ? 0 : left < right ? 1 : -1;
}

/** Accepts discord.com, discordapp.com and the ptb/canary hosts. */
export function parseMessageUrl(url: string) {
  const match = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(url);
  if (!match) throw new Error('Not a Discord message link');
  return { serverId: match[1], channelId: match[2], messageId: match[3] };
}

function matchesAuthor(message: Message, author: string | undefined): boolean {
  if (!author) return true;
  const wanted = author.toLowerCase();
  const candidates = [message.author.id, message.author.tag, message.author.username, message.member?.displayName];
  return candidates.some(candidate => candidate?.toLowerCase() === wanted);
}

/** Ordinary posts and replies; pin notices, joins and other system rows are not. */
function isUserMessage(message: Message): boolean {
  return message.type === MessageType.Default || message.type === MessageType.Reply;
}

function preview(message: Message | undefined) {
  return message ? {
    id: message.id,
    author: message.author.tag,
    content: message.content,
    embeds: message.embeds.map(embed => embed.toJSON()),
  } : null;
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

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

/**
 * One history request, with reply previews limited to messages in that batch.
 * `author` and `excludeSystem` filter after the fetch, so a page can come back
 * shorter than `limit`; includePageInfo supplies cursors from the unfiltered page.
 */
export async function readMessages(args: unknown, findChannel: ChannelResolver) {
  const { server, channel: identifier, limit, before, after, author, excludeSystem, includePageInfo } = ReadMessagesSchema.parse(args);
  const channel = await findChannel(identifier, server);
  const messages = await channel.messages.fetch({
    limit, cache: false, ...(before && { before }), ...(after && { after }),
  });
  // Discord returns an `after` page oldest first; keep every page newest first.
  const ordered = Array.from(messages.values()).sort(newestFirst);
  const formatted = ordered
    .filter(message => matchesAuthor(message, author) && (!excludeSystem || isUserMessage(message)))
    .map(message => {
      const reference = message.reference;
      const repliedTo = reference?.channelId === channel.id && reference.messageId
        ? messages.get(reference.messageId)
        : undefined;
      return { ...serializeMessage(message, channel), replyPreview: preview(repliedTo) };
    });
  return json(includePageInfo ? { messages: formatted, page: {
    fetched: ordered.length, returned: formatted.length,
    nextBefore: ordered.at(-1)?.id ?? null, nextAfter: ordered[0]?.id ?? null,
    mayHaveMore: ordered.length === limit,
  } } : formatted);
}

/** One message by link or by channel + id; a same-channel reply target is fetched for the preview. */
export async function getMessage(args: unknown, findChannel: ChannelResolver) {
  const parsed = GetMessageSchema.parse(args);
  const target = parsed.url
    ? parseMessageUrl(parsed.url)
    : { serverId: parsed.server, channelId: parsed.channel!, messageId: parsed.messageId! };
  const channel = await findChannel(target.channelId, target.serverId);
  const message = await channel.messages.fetch({ message: target.messageId, force: true });
  let repliedTo: Message | undefined;
  const reference = message.reference;
  if (reference?.channelId === channel.id && reference.messageId) {
    try {
      repliedTo = await channel.messages.fetch({ message: reference.messageId, force: true });
    } catch {
      repliedTo = undefined; // Deleted or unreadable reply target: report the reference only.
    }
  }
  return json({ ...serializeMessage(message, channel), replyPreview: preview(repliedTo) });
}

/** Every pinned message in the channel, newest first. */
export async function listPins(args: unknown, findChannel: ChannelResolver) {
  const { server, channel: identifier } = ListPinsSchema.parse(args);
  const channel = await findChannel(identifier, server);
  const pinned = await channel.messages.fetchPinned(false);
  const ordered = Array.from(pinned.values()).sort(newestFirst);
  return json(ordered.map(message => serializeMessage(message, channel)));
}
