import type { Role, RoleEditOptions } from 'discord.js';
import { z } from 'zod';
import { clearable, findRole, hexColor, json, parseColor, permissionList, reason, text, type Resolvers } from './shared.js';

export const CreateRoleSchema = z.object({
  server: z.string().optional(),
  name: z.string().min(1).max(100),
  color: hexColor.optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: permissionList.optional(),
  reason,
});

const editable = ['name', 'color', 'hoist', 'mentionable', 'permissions', 'position'] as const;
export const EditRoleSchema = z.object({
  server: z.string().optional(),
  role: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  color: clearable(hexColor),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: permissionList.optional(),
  position: z.number().int().min(1).optional(),
  reason,
}).refine(value => editable.some(key => value[key] !== undefined), 'Provide at least one role property to change');

export const DeleteRoleSchema = z.object({
  server: z.string().optional(),
  role: z.string().min(1),
  reason,
});

export const ListRolesSchema = z.object({ server: z.string().optional() });

export function serializeRole(role: Role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    position: role.position,
    managed: role.managed,
    members: role.members.size,
    permissions: role.permissions.toArray(),
  };
}

export async function createRole(args: unknown, r: Resolvers) {
  const { server, name, color, hoist, mentionable, permissions, reason: why } = CreateRoleSchema.parse(args);
  const guild = await r.findGuild(server);
  const role = await guild.roles.create({
    name,
    ...(color !== undefined && { color: parseColor(color) }),
    ...(hoist !== undefined && { hoist }),
    ...(mentionable !== undefined && { mentionable }),
    ...(permissions !== undefined && { permissions }),
    ...(why !== undefined && { reason: why }),
  });
  return text(`Role "${role.name}" created in ${guild.name}. ID: ${role.id}`);
}

export async function editRole(args: unknown, r: Resolvers) {
  const { server, role: identifier, name, color, hoist, mentionable, permissions, position, reason: why } = EditRoleSchema.parse(args);
  const guild = await r.findGuild(server);
  const role = findRole(guild, identifier);
  if (role.id === guild.id && (name !== undefined || hoist !== undefined || position !== undefined)) {
    throw new Error('@everyone cannot be renamed, hoisted or moved');
  }
  const data: RoleEditOptions = {};
  if (name !== undefined) data.name = name;
  if (color !== undefined) data.color = color === null ? 0 : parseColor(color);
  if (hoist !== undefined) data.hoist = hoist;
  if (mentionable !== undefined) data.mentionable = mentionable;
  if (permissions !== undefined) data.permissions = permissions;
  if (why !== undefined) data.reason = why;
  if (Object.keys(data).some(key => key !== 'reason')) await role.edit(data);
  if (position !== undefined) await role.setPosition(position, { reason: why });
  return text(`Role "${role.name}" updated in ${guild.name}.`);
}

export async function deleteRole(args: unknown, r: Resolvers) {
  const { server, role: identifier, reason: why } = DeleteRoleSchema.parse(args);
  const guild = await r.findGuild(server);
  const role = findRole(guild, identifier);
  if (role.id === guild.id) throw new Error('@everyone cannot be deleted');
  if (role.managed) throw new Error(`"${role.name}" is managed by an integration and cannot be deleted here`);
  const name = role.name;
  await role.delete(why);
  return text(`Role "${name}" deleted from ${guild.name}.`);
}

/** Every role except @everyone, highest first, with member counts and permission names. */
export async function listRoles(args: unknown, r: Resolvers) {
  const { server } = ListRolesSchema.parse(args);
  const guild = await r.findGuild(server);
  // Member counts need the member cache; a slow gateway chunk must not hang the tool.
  try { await guild.members.fetch({ time: 10_000 }); } catch { /* counts fall back to what is cached */ }
  const roles = Array.from(guild.roles.cache.values())
    .filter(role => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map(serializeRole);
  return json(roles);
}
