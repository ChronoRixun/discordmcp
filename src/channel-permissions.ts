import type { GuildMember, PermissionOverwriteOptions, Role } from 'discord.js';
import { z } from 'zod';
import { findRole, permissionList, reason, text, type Resolvers } from './shared.js';

const target = {
  server: z.string().optional(),
  channel: z.string().min(1),
  role: z.string().min(1).optional(),
  member: z.string().min(1).optional(),
};
const oneTarget = (value: { role?: string; member?: string }) => (value.role ? 1 : 0) + (value.member ? 1 : 0) === 1;

export const SetChannelPermissionsSchema = z.object({
  ...target,
  allow: permissionList.optional(),
  deny: permissionList.optional(),
  clear: permissionList.optional(),
  reason,
})
  .refine(oneTarget, 'Provide exactly one of role or member')
  .refine(value => (value.allow?.length ?? 0) + (value.deny?.length ?? 0) + (value.clear?.length ?? 0) > 0,
    'Provide at least one permission in allow, deny or clear')
  .refine(value => {
    const seen = new Set<string>();
    for (const name of [...(value.allow ?? []), ...(value.deny ?? []), ...(value.clear ?? [])]) {
      if (seen.has(name)) return false;
      seen.add(name);
    }
    return true;
  }, 'A permission can appear in only one of allow, deny and clear');

export const RemoveChannelOverwriteSchema = z.object({ ...target, reason }).refine(oneTarget, 'Provide exactly one of role or member');

async function resolveTarget(r: Resolvers, channelName: string, server: string | undefined, role: string | undefined, member: string | undefined) {
  const channel = await r.findGuildChannel(channelName, server);
  if (!('permissionOverwrites' in channel)) throw new Error(`#${channel.name} does not support permission overwrites`);
  const subject: Role | GuildMember = role ? findRole(channel.guild, role) : await r.findMember(channel.guild, member!);
  const label = role ? `role "${(subject as Role).name}"` : `member ${(subject as GuildMember).user.tag}`;
  return { channel, subject, label };
}

/** allow → explicitly granted, deny → explicitly denied, clear → back to inheriting from roles. */
export async function setChannelPermissions(args: unknown, r: Resolvers) {
  const p = SetChannelPermissionsSchema.parse(args);
  const { channel, subject, label } = await resolveTarget(r, p.channel, p.server, p.role, p.member);
  const options: Record<string, boolean | null> = {};
  for (const name of p.allow ?? []) options[name] = true;
  for (const name of p.deny ?? []) options[name] = false;
  for (const name of p.clear ?? []) options[name] = null;
  await channel.permissionOverwrites.edit(subject, options as PermissionOverwriteOptions, { reason: p.reason });
  const part = (title: string, names: string[] | undefined) => names?.length ? ` ${title} [${names.join(', ')}]` : '';
  return text(`Permissions for ${label} in #${channel.name} updated:${part('allow', p.allow)}${part('deny', p.deny)}${part('cleared', p.clear)}`);
}

export async function removeChannelOverwrite(args: unknown, r: Resolvers) {
  const p = RemoveChannelOverwriteSchema.parse(args);
  const { channel, subject, label } = await resolveTarget(r, p.channel, p.server, p.role, p.member);
  await channel.permissionOverwrites.delete(subject.id, p.reason);
  return text(`Permission overwrite for ${label} removed from #${channel.name}; it now inherits from roles.`);
}
