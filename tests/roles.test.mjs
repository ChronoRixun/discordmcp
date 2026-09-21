import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { createRole, editRole, deleteRole, listRoles } from '../build/roles.js';

function role(overrides = {}) {
  const calls = { edit: [], setPosition: [], delete: [] };
  return {
    id: '20000000000000000', name: 'Mod', hexColor: '#e8a33d', hoist: true, mentionable: false, position: 2,
    managed: false, members: new Collection([['u1', {}]]),
    permissions: new PermissionsBitField([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers]),
    calls,
    edit: async data => { calls.edit.push(data); },
    setPosition: async (position, options) => { calls.setPosition.push([position, options]); },
    delete: async reason => { calls.delete.push(reason); },
    ...overrides,
  };
}
function guild(roles) {
  const everyone = role({ id: '12300000000000000', name: '@everyone', position: 0, hexColor: '#000000', hoist: false, members: new Collection() });
  const created = [];
  const cache = new Collection([[everyone.id, everyone], ...roles.map(r => [r.id, r])]);
  const g = {
    id: '12300000000000000', name: 'Community',
    roles: { cache, everyone, create: async options => { created.push(options); return { id: '999', name: options.name }; } },
    members: { fetch: async () => {} },
    created,
  };
  return g;
}
const resolvers = g => ({ findGuild: async server => { g.requestedServer = server; return g; } });

test('create-role forwards only the given properties with the colour parsed', async () => {
  const g = guild([]);
  const result = await createRole({ server: 'community', name: 'Regular', color: '#34C759', hoist: true, permissions: ['SendMessages'], reason: 'setup' }, resolvers(g));
  assert.deepEqual(g.created, [{ name: 'Regular', color: 0x34C759, hoist: true, permissions: ['SendMessages'], reason: 'setup' }]);
  assert.equal(g.requestedServer, 'community');
  assert.match(result.content[0].text, /Role "Regular" created in Community\. ID: 999/);
  await createRole({ name: 'Plain' }, resolvers(g));
  assert.deepEqual(g.created[1], { name: 'Plain' });
});

test('edit-role edits named properties, clears colour with null and moves position separately', async () => {
  const mod = role();
  const g = guild([mod]);
  await editRole({ role: 'mod', name: 'Moderator', color: null, mentionable: true, reason: 'tidy' }, resolvers(g));
  assert.deepEqual(mod.calls.edit, [{ name: 'Moderator', color: 0, mentionable: true, reason: 'tidy' }]);
  await editRole({ role: 'mod', color: 'null' }, resolvers(g));   // clients that stringify null
  assert.deepEqual(mod.calls.edit[1], { color: 0 });
  assert.deepEqual(mod.calls.setPosition, []);
  await editRole({ role: mod.id, position: 5 }, resolvers(g));
  assert.deepEqual(mod.calls.edit.length, 2);
  assert.deepEqual(mod.calls.setPosition, [[5, { reason: undefined }]]);
});

test('edit-role refuses to rename or move @everyone but allows changing its permissions', async () => {
  const g = guild([]);
  await assert.rejects(editRole({ role: '@everyone', name: 'people' }, resolvers(g)), /@everyone/);
  await assert.rejects(editRole({ role: '@everyone', position: 1 }, resolvers(g)), /@everyone/);
  await editRole({ role: '@everyone', permissions: ['ViewChannel'] }, resolvers(g));
  assert.deepEqual(g.roles.everyone.calls.edit, [{ permissions: ['ViewChannel'] }]);
});

test('role validation fails before any lookup and unknown roles list what exists', async () => {
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const args of [{ role: 'Mod' }, { role: 'Mod', color: 'red' }, { name: '' }, { name: 'X', permissions: ['FlyPlanes'] }, { role: 'Mod', position: 0 }]) {
    await assert.rejects(args.name !== undefined ? createRole(args, never) : editRole(args, never));
  }
  await assert.rejects(editRole({ role: 'Nope', name: 'x' }, resolvers(guild([role()]))), /Available roles: "Mod"/);
});

test('delete-role refuses @everyone and managed roles, otherwise deletes with the reason', async () => {
  const bot = role({ id: '30000000000000000', name: 'CodWW2-Mod', managed: true });
  const mod = role();
  const g = guild([bot, mod]);
  await assert.rejects(deleteRole({ role: '@everyone' }, resolvers(g)), /cannot be deleted/);
  await assert.rejects(deleteRole({ role: 'CodWW2-Mod' }, resolvers(g)), /managed/);
  assert.deepEqual(bot.calls.delete, []);
  const result = await deleteRole({ role: 'Mod', reason: 'unused' }, resolvers(g));
  assert.deepEqual(mod.calls.delete, ['unused']);
  assert.match(result.content[0].text, /Role "Mod" deleted/);
});

test('list-roles returns JSON highest first, without @everyone, with permission names', async () => {
  const g = guild([role(), role({ id: '30000000000000000', name: 'Admin', position: 5, permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]) })]);
  const data = JSON.parse((await listRoles({}, resolvers(g))).content[0].text);
  assert.deepEqual(data.map(r => r.name), ['Admin', 'Mod']);
  assert.deepEqual(data[1], { id: '20000000000000000', name: 'Mod', color: '#e8a33d', hoist: true, mentionable: false, position: 2, managed: false, members: 1, permissions: ['KickMembers', 'ManageMessages'] });
});

test('duplicate role names are refused for edit/delete and IDs still select exactly one', async () => {
  const a = role(), b = role({ id: '30000000000000000', name: 'MOD' });
  const r = resolvers(guild([a,b]));
  await assert.rejects(editRole({ role: 'mod', name: 'x' }, r), /Multiple/);
  await assert.rejects(deleteRole({ role: 'mod' }, r), /Multiple/);
  assert.equal(a.calls.edit.length + a.calls.delete.length + b.calls.edit.length + b.calls.delete.length, 0);
  await editRole({ role: b.id, name: 'Selected' }, r);
  assert.deepEqual(b.calls.edit, [{ name: 'Selected' }]);
});

test('role counts are explicitly unknown when the member fetch fails', async () => {
  const g = guild([role()]);
  g.members.fetch = async () => { throw new Error('timeout'); };
  const data = JSON.parse((await listRoles({}, resolvers(g))).content[0].text);
  assert.equal(data[0].members, null);
  assert.equal(data[0].cachedMembers, 1);
});
