import { ChannelType, ForumChannel, type FetchedThreads, type Guild, type GuildBasedChannel, type ThreadChannel } from 'discord.js';
import { z } from 'zod';
import { newestFirst } from './read-messages.js';
import { json, type PostableChannel, type Resolvers } from './shared.js';

// Channels whose threads can be listed: text and announcement channels, forums and media channels.
const THREAD_PARENT_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

const KIND_LABELS: Record<number, string> = {
  [ChannelType.GuildText]: 'a text',
  [ChannelType.GuildVoice]: 'a voice',
  [ChannelType.GuildCategory]: 'a category',
  [ChannelType.GuildAnnouncement]: 'an announcement',
  [ChannelType.GuildStageVoice]: 'a stage',
  [ChannelType.GuildForum]: 'a forum',
  [ChannelType.GuildMedia]: 'a media',
  [ChannelType.PublicThread]: 'a thread',
  [ChannelType.PrivateThread]: 'a private thread',
  [ChannelType.AnnouncementThread]: 'a thread',
};

export function channelKind(type: number): string {
  return KIND_LABELS[type] ?? `type ${type}`;
}

/** Duck-typed on the numeric type so plain-object test fixtures classify like real channels. */
export function isThreadChannelType(type: number): boolean {
  return type === ChannelType.PublicThread || type === ChannelType.PrivateThread || type === ChannelType.AnnouncementThread;
}

/** Text and announcement channels, where messages live directly. */
export function isPostableChannelType(type: number): boolean {
  return type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement || isThreadChannelType(type);
}

/** Forums and media channels: thread containers with guidelines (topic) and available tags. */
export function isForumChannelType(type: number): boolean {
  return type === ChannelType.GuildForum || type === ChannelType.GuildMedia;
}

export function isForumChannel(channel: unknown): channel is ForumChannel {
  return channel instanceof ForumChannel;
}

/**
 * A Discord channel link (https://discord.com/channels/<server>/<channel>) or message link
 * (one segment more). Returns null for anything else, including bare server links.
 */
export function parseChannelUrl(identifier: string): { serverId: string; channelId: string; messageId: string | null } | null {
  const match = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})(?:\/(\d{17,20}))?\/?$/.exec(identifier.trim());
  if (!match) return null;
  return { serverId: match[1], channelId: match[2], messageId: match[3] ?? null };
}

type ThreadListing = {
  threads?: {
    fetchActive?: (cache?: boolean) => Promise<FetchedThreads>;
    fetchArchived?: (options?: { type?: 'public' | 'private' }) => Promise<FetchedThreads>;
  };
};

async function fetchActiveThreads(guild: Guild): Promise<ThreadChannel[]> {
  const fetched = await guild.channels.fetchActiveThreads();
  return Array.from(fetched.threads.values()) as ThreadChannel[];
}

async function fetchArchivedThreads(parent: GuildBasedChannel): Promise<ThreadChannel[]> {
  const manager = (parent as ThreadListing).threads;
  if (!manager?.fetchArchived) return [];
  const fetched = await manager.fetchArchived({ type: 'public' });
  return Array.from(fetched.threads.values()) as ThreadChannel[];
}

/**
 * Every thread the bot can see in the guild: all active threads plus the recently archived
 * public threads of every text, announcement, forum and media channel. Deduplicated by ID
 * (a thread can be both returned active guild-wide and listed under its parent's archive).
 */
export async function collectGuildThreads(guild: Guild): Promise<ThreadChannel[]> {
  const byId = new Map<string, ThreadChannel>();
  for (const thread of await fetchActiveThreads(guild)) byId.set(thread.id, thread);
  for (const parent of guild.channels.cache.values()) {
    if (!THREAD_PARENT_TYPES.has(parent.type)) continue;
    for (const thread of await fetchArchivedThreads(parent)) {
      if (!byId.has(thread.id)) byId.set(thread.id, thread);
    }
  }
  return Array.from(byId.values());
}

/** Case-insensitive exact name match; a leading # is ignored. */
export function threadsNamed(threads: Iterable<ThreadChannel>, name: string): ThreadChannel[] {
  const wanted = name.toLowerCase().replace(/^#/, '');
  return Array.from(threads).filter(thread => thread.name.toLowerCase() === wanted);
}

function describeChoice(channel: PostableChannel | ForumChannel): string {
  if (isThreadChannelType(channel.type)) {
    const parent = (channel as ThreadChannel).parent;
    return `"${channel.name}" (thread in #${parent?.name ?? 'unknown'}, id ${channel.id})`;
  }
  return `#${channel.name} (id ${channel.id})`;
}

/**
 * The shared lookup behind findChannel: a postable channel (text, announcement or thread)
 * by ID, Discord link, or exact case-insensitive name. With `includeForums` a forum channel
 * resolves too (get-channel-info), otherwise it errors with a pointer to list-threads.
 */
export async function resolveChannel(
  guild: Guild,
  identifier: string,
  { includeForums = false }: { includeForums?: boolean } = {},
): Promise<PostableChannel | ForumChannel> {
  const url = parseChannelUrl(identifier);
  if (url && url.serverId !== guild.id) {
    throw new Error(`That link points to server ${url.serverId}, not "${guild.name}" (${guild.id}). Pass the matching server or use its channels.`);
  }
  const wanted = url?.channelId ?? identifier;

  let found: GuildBasedChannel | null = null;
  try {
    found = (await guild.client.channels.fetch(wanted)) as GuildBasedChannel | null;
  } catch {
    found = null; // An unknown ID or a name that is not a snowflake: fall through to the name search.
  }
  if (found && found.guild?.id === guild.id) {
    if (isPostableChannelType(found.type)) return found as PostableChannel;
    if (isForumChannelType(found.type)) {
      if (includeForums) return found as ForumChannel;
      throw new Error(`"${found.name}" is a forum channel: it holds posts (threads), not messages. Use list-threads on "${found.name}" to see its posts, then read-messages on a thread by name or ID.`);
    }
    throw new Error(`Channel "${identifier}" is ${channelKind(found.type)} channel, not a text, announcement or thread channel in server "${guild.name}"`);
  }

  const name = wanted.toLowerCase().replace(/^#/, '');
  const matches: (PostableChannel | ForumChannel)[] = [];
  const threads = new Map((await collectGuildThreads(guild)).map(thread => [thread.id, thread]));
  for (const channel of guild.channels.cache.values()) {
    // Cached threads join the search once, without double-counting the collected ones.
    if (isThreadChannelType(channel.type)) {
      if (!threads.has(channel.id)) threads.set(channel.id, channel as ThreadChannel);
      continue;
    }
    if (isForumChannelType(channel.type) && channel.name.toLowerCase() === name) {
      if (includeForums) {
        matches.push(channel as ForumChannel);
        continue;
      }
      throw new Error(`"${channel.name}" is a forum channel: it holds posts (threads), not messages. Use list-threads on "${channel.name}" to see its posts, then read-messages on a thread by name or ID.`);
    }
    if (isPostableChannelType(channel.type) && channel.name.toLowerCase() === name) {
      matches.push(channel as PostableChannel);
    }
  }
  matches.push(...threadsNamed(threads.values(), name));

  if (matches.length === 0) {
    const available = Array.from(guild.channels.cache.values())
      .filter(channel => isPostableChannelType(channel.type))
      .map(channel => `"#${channel.name}"`).join(', ');
    throw new Error(`Channel "${identifier}" not found in server "${guild.name}". Available channels: ${available}. Forum posts and other threads are not listed here — use list-threads on a forum or text channel to find them.`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple channels or threads found with name "${identifier}" in server "${guild.name}": ${matches.map(describeChoice).join('; ')}. Please specify the channel ID.`);
  }
  return matches[0];
}

export const ListThreadsSchema = z.object({
  server: z.string().optional(),
  channel: z.string().optional().describe('Forum, text or announcement channel name or ID; omit for every active thread in the server'),
  limit: z.number().int().min(1).max(100).default(50),
});

/** One thread as list-threads reports it: identity, parent, owner, activity and forum tags. */
export function serializeThread(thread: ThreadChannel) {
  const parent = thread.parent ?? null;
  const availableTags = parent && 'availableTags' in parent ? parent.availableTags : [];
  const ownerId = thread.ownerId ?? null;
  const owner = ownerId ? thread.guild?.members.cache.get(ownerId) : undefined;
  return {
    id: thread.id,
    name: thread.name,
    url: thread.url,
    parent: parent ? { id: parent.id, name: parent.name } : null,
    owner: owner ? owner.user.tag : ownerId,
    createdAt: thread.createdAt ? thread.createdAt.toISOString() : null,
    messageCount: thread.messageCount ?? 0,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    tags: (thread.appliedTags ?? []).map(tagId => availableTags.find(tag => tag.id === tagId)?.name ?? tagId),
  };
}

/**
 * With a channel: its active and recently archived public threads, newest first.
 * Without one: every active thread in the server.
 */
export async function listThreads(args: unknown, r: Pick<Resolvers, 'findGuild' | 'findGuildChannel'>) {
  const { server, channel: identifier, limit } = ListThreadsSchema.parse(args);
  const guild = await r.findGuild(server);
  let threads: ThreadChannel[];
  if (identifier) {
    const parent = await r.findGuildChannel(identifier, server);
    if (!THREAD_PARENT_TYPES.has(parent.type)) {
      throw new Error(`list-threads works on forum, text and announcement channels; "${parent.name}" is ${channelKind(parent.type)} channel. To read a thread's messages, use read-messages with the thread name or ID.`);
    }
    const manager = (parent as ThreadListing).threads!;
    const byId = new Map<string, ThreadChannel>();
    for (const thread of Array.from((await manager.fetchActive!()).threads.values()) as ThreadChannel[]) byId.set(thread.id, thread);
    for (const thread of Array.from((await manager.fetchArchived!({ type: 'public' })).threads.values()) as ThreadChannel[]) {
      if (!byId.has(thread.id)) byId.set(thread.id, thread);
    }
    threads = Array.from(byId.values());
  } else {
    threads = await fetchActiveThreads(guild);
  }
  threads.sort(newestFirst);
  return json(threads.slice(0, limit).map(serializeThread));
}
