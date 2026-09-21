import { PermissionFlagsBits, type Guild, type GuildBasedChannel, type GuildMember, type PermissionsString, type Role, type TextChannel } from 'discord.js';
import { z } from 'zod';

/** Lookups owned by index.ts (they close over the Discord client). */
export type Resolvers = {
  findGuild: (server?: string) => Promise<Guild>;
  findChannel: (channel: string, server?: string) => Promise<TextChannel>;
  findGuildChannel: (channel: string, server?: string) => Promise<GuildBasedChannel>;
  findMember: (guild: Guild, user: string) => Promise<GuildMember>;
};

export const reason = z.string().min(1).max(512).optional();

/** Some MCP clients send null as the string "null"; treat that as an explicit clear. */
export function clearable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(value => (value === 'null' ? null : value), schema.nullable().optional());
}
export const hexColor = z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #E8A33D');
export const permissionName = z.string().refine(
  name => Object.prototype.hasOwnProperty.call(PermissionFlagsBits, name),
  name => ({ message: `Unknown permission "${name}"; use discord.js names such as SendMessages or ViewChannel` }),
);
export const permissionList = z.array(permissionName).max(64).transform(names => names as PermissionsString[]);

export function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

/** Role by ID or case-insensitive name. "@everyone" resolves to the guild's base role. */
export function findRole(guild: Guild, identifier: string): Role {
  const role = selectUnique(guild.roles.cache.values(), identifier, 'role');
  if (!role) {
    const names = guild.roles.cache.filter(r => r.id !== guild.id).map(r => `"${r.name}"`).join(', ');
    throw new Error(`Role "${identifier}" not found in ${guild.name}. Available roles: ${names || 'none'}`);
  }
  return role;
}

/** IDs win over names; ambiguous names must never select a mutation target. */
export function selectUnique<T extends { id: string; name: string }>(items: Iterable<T>, identifier: string, kind: string): T | undefined {
  const all = Array.from(items);
  const byId = all.find(item => item.id === identifier);
  if (byId) return byId;
  const matches = all.filter(item => item.name.toLowerCase() === identifier.toLowerCase());
  if (matches.length > 1) throw new Error(`Multiple ${kind}s named "${identifier}"; use an ID: ${matches.map(item => item.id).join(', ')}`);
  return matches[0];
}
