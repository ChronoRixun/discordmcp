import type { Guild, GuildMember } from 'discord.js';

/** Names are convenience only: reject every known ambiguity and prefer IDs for moderation. */
export async function findMember(guild: Guild, identifier: string): Promise<GuildMember> {
  const id = /^(?:<@!?)?(\d{17,20})>?$/.exec(identifier)?.[1];
  if (id) return guild.members.fetch(id);
  const wanted = identifier.toLowerCase().replace(/^@/, '');
  const matches = (m: GuildMember) => [m.user.username, m.displayName, m.user.tag, m.user.globalName]
    .some(name => name?.toLowerCase() === wanted);
  const found = await guild.members.search({ query: wanted.split('#')[0], limit: 100 });
  const known = new Map([...guild.members.cache, ...found]);
  const exact = [...known.values()].filter(matches);
  if (exact.length > 1) throw new Error(`Multiple members match "${identifier}"; use a user ID: ${exact.map(m => m.id).join(', ')}`);
  if (found.size === 100) throw new Error('Member search was truncated; use a user ID');
  if (exact.length === 1) return exact[0];
  throw new Error(`Member "${identifier}" not found in ${guild.name}; use a user ID for uncached display names`);
}
