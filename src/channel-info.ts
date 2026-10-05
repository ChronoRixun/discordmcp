import { ChannelType, OverwriteType, PermissionFlagsBits, type ForumChannel, type ThreadChannel } from 'discord.js';
import type { PostableChannel } from './shared.js';
import { isThreadChannelType } from './threads.js';
import { z } from 'zod';

export const GetChannelInfoSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
});

type InfoChannel = PostableChannel | ForumChannel;
type ChannelResolver = (channel: string, server?: string) => Promise<InfoChannel>;

/** Settings, pins and the effective @everyone permissions for a text, announcement, thread or forum channel. */
export async function getChannelInfo(args: unknown, findChannel: ChannelResolver) {
  const { server, channel: identifier } = GetChannelInfoSchema.parse(args);
  const channel = await findChannel(identifier, server);
  const guild = channel.guild;
  const everyone = channel.permissionsFor(guild.roles.everyone);
  const thread = isThreadChannelType(channel.type) ? channel as ThreadChannel : null;
  const forum = !thread && 'availableTags' in channel ? channel as ForumChannel : null;
  const pinned = !forum && 'messages' in channel && channel.messages
    ? await channel.messages.fetchPinned(false)
    : null;
  const overwrites = 'permissionOverwrites' in channel && channel.permissionOverwrites
    ? Array.from(channel.permissionOverwrites.cache.values(), overwrite => ({
      id: overwrite.id,
      type: overwrite.type === OverwriteType.Role ? 'role' : 'member',
      name: overwrite.type === OverwriteType.Role
        ? guild.roles.cache.get(overwrite.id)?.name ?? null
        : guild.members.cache.get(overwrite.id)?.user.tag ?? null,
      allow: overwrite.allow.toArray(),
      deny: overwrite.deny.toArray(),
    }))
    : [];
  const availableTags = forum?.availableTags ?? null;
  const parentTags = thread?.parent && 'availableTags' in thread.parent ? thread.parent.availableTags : null;
  const info = {
    id: channel.id,
    name: `#${channel.name}`,
    url: channel.url,
    server: guild.name,
    serverId: guild.id,
    type: ChannelType[channel.type] ?? channel.type,
    category: channel.parent?.name ?? null,
    categoryId: channel.parentId ?? null,
    topic: (channel as { topic?: string | null }).topic ?? null,
    nsfw: (channel as { nsfw?: boolean }).nsfw ?? null,
    slowmodeSeconds: (channel as { rateLimitPerUser?: number | null }).rateLimitPerUser ?? 0,
    createdAt: channel.createdAt ? channel.createdAt.toISOString() : null,
    lastMessageId: (channel as { lastMessageId?: string | null }).lastMessageId ?? null,
    pinnedCount: pinned?.size ?? 0,
    pinnedMessageIds: pinned ? Array.from(pinned.keys()) : [],
    // What a member with no roles can do here, after overwrites.
    everyone: {
      view: everyone?.has(PermissionFlagsBits.ViewChannel) ?? false,
      readHistory: everyone?.has(PermissionFlagsBits.ReadMessageHistory) ?? false,
      send: everyone?.has(PermissionFlagsBits.SendMessages) ?? false,
      react: everyone?.has(PermissionFlagsBits.AddReactions) ?? false,
    },
    overwrites,
    // Forums carry post guidelines as their topic and offer these tags on posts.
    ...(availableTags ? {
      availableTags: availableTags.map(tag => ({
        id: tag.id,
        name: tag.name,
        moderated: tag.moderated,
        emoji: tag.emoji ? (tag.emoji.name ?? tag.emoji.id) : null,
      })),
    } : {}),
    // Threads inherit permissions from their parent and have no topic or overwrites of their own.
    ...(thread ? {
      thread: {
        parentId: thread.parentId ?? null,
        parent: thread.parent?.name ?? null,
        ownerId: thread.ownerId ?? null,
        archived: thread.archived ?? false,
        locked: thread.locked ?? false,
        messageCount: thread.messageCount ?? 0,
        appliedTags: (thread.appliedTags ?? []).map(tagId =>
          parentTags?.find(tag => tag.id === tagId)?.name ?? tagId),
      },
    } : {}),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
}
