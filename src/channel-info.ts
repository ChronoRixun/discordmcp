import { OverwriteType, PermissionFlagsBits, type TextChannel } from 'discord.js';
import { z } from 'zod';

export const GetChannelInfoSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
});

type ChannelResolver = (channel: string, server?: string) => Promise<TextChannel>;

/** Settings, pins and the effective @everyone permissions for one text channel. */
export async function getChannelInfo(args: unknown, findChannel: ChannelResolver) {
  const { server, channel: identifier } = GetChannelInfoSchema.parse(args);
  const channel = await findChannel(identifier, server);
  const guild = channel.guild;
  const everyone = channel.permissionsFor(guild.roles.everyone);
  const pinned = await channel.messages.fetchPinned(false);
  const overwrites = Array.from(channel.permissionOverwrites.cache.values(), overwrite => ({
    id: overwrite.id,
    type: overwrite.type === OverwriteType.Role ? 'role' : 'member',
    name: overwrite.type === OverwriteType.Role
      ? guild.roles.cache.get(overwrite.id)?.name ?? null
      : guild.members.cache.get(overwrite.id)?.user.tag ?? null,
    allow: overwrite.allow.toArray(),
    deny: overwrite.deny.toArray(),
  }));
  const info = {
    id: channel.id,
    name: `#${channel.name}`,
    url: channel.url,
    server: guild.name,
    serverId: guild.id,
    category: channel.parent?.name ?? null,
    categoryId: channel.parentId ?? null,
    topic: channel.topic ?? null,
    nsfw: channel.nsfw,
    slowmodeSeconds: channel.rateLimitPerUser ?? 0,
    createdAt: channel.createdAt.toISOString(),
    lastMessageId: channel.lastMessageId ?? null,
    pinnedCount: pinned.size,
    pinnedMessageIds: Array.from(pinned.keys()),
    // What a member with no roles can do here, after overwrites.
    everyone: {
      view: everyone.has(PermissionFlagsBits.ViewChannel),
      readHistory: everyone.has(PermissionFlagsBits.ReadMessageHistory),
      send: everyone.has(PermissionFlagsBits.SendMessages),
      react: everyone.has(PermissionFlagsBits.AddReactions),
    },
    overwrites,
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
}
