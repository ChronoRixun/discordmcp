import { z } from 'zod';
import { reason, text, type Resolvers } from './shared.js';

export const TimeoutMemberSchema = z.object({
  server: z.string().optional(),
  user: z.string().min(1),
  minutes: z.number().int().min(1).max(40320),
  reason,
});

export const RemoveTimeoutSchema = z.object({
  server: z.string().optional(),
  user: z.string().min(1),
  reason,
});

/** Discord's own mute: the member can read but not post, react, or speak until the time is up. */
export async function timeoutMember(args: unknown, r: Resolvers) {
  const { server, user, minutes, reason: why } = TimeoutMemberSchema.parse(args);
  const guild = await r.findGuild(server);
  const member = await r.findMember(guild, user);
  if (!member.moderatable) throw new Error(`${member.user.tag} cannot be timed out by this bot (higher role, owner, or missing Moderate Members permission)`);
  await member.timeout(minutes * 60_000, why);
  return text(`${member.user.tag} timed out for ${minutes} min in ${guild.name}, until ${member.communicationDisabledUntil?.toISOString() ?? 'unknown'}.${why ? ` Reason: ${why}` : ''}`);
}

export async function removeTimeout(args: unknown, r: Resolvers) {
  const { server, user, reason: why } = RemoveTimeoutSchema.parse(args);
  const guild = await r.findGuild(server);
  const member = await r.findMember(guild, user);
  await member.timeout(null, why);
  return text(`Timeout removed for ${member.user.tag} in ${guild.name}.`);
}
