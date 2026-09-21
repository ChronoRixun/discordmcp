import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { setChannelPermissions, removeChannelOverwrite } from '../build/channel-permissions.js';

function fixture({ thread = false } = {}) {
  const edits = [], deletes = [];
  const mod = { id: '20000000000000000', name: 'Mod' };
  const guild = { id: '12300000000000000', name: 'Community', roles: { cache: new Collection([[mod.id, mod]]) } };
  const channel = { id: '45600000000000000', name: 'mod-chat', guild };
  if (!thread) {
    channel.permissionOverwrites = {
      edit: async (target, options, extra) => { edits.push([target, options, extra]); },
      delete: async (id, reason) => { deletes.push([id, reason]); },
    };
  }
  const member = { id: '55500000000000000', user: { tag: 'chrono#0001' } };
  const r = {
    findGuildChannel: async (name, server) => { r.resolved = [name, server]; return channel; },
    findMember: async (g, user) => { r.memberLookup = user; return member; },
  };
  return { edits, deletes, mod, member, r };
}

test('set-channel-permissions maps allow/deny/clear onto one overwrite for a role', async () => {
  const f = fixture();
  const result = await setChannelPermissions({ server: 'community', channel: 'mod-chat', role: 'mod', allow: ['ViewChannel', 'SendMessages'], deny: ['MentionEveryone'], clear: ['AddReactions'], reason: 'mods only' }, f.r);
  assert.deepEqual(f.r.resolved, ['mod-chat', 'community']);
  assert.deepEqual(f.edits, [[f.mod, { ViewChannel: true, SendMessages: true, MentionEveryone: false, AddReactions: null }, { reason: 'mods only' }]]);
  assert.match(result.content[0].text, /role "Mod" in #mod-chat updated: allow \[ViewChannel, SendMessages\] deny \[MentionEveryone\] cleared \[AddReactions\]/);
});

test('set-channel-permissions resolves a member target through findMember', async () => {
  const f = fixture();
  const result = await setChannelPermissions({ channel: 'mod-chat', member: 'chrono', deny: ['SendMessages'] }, f.r);
  assert.equal(f.r.memberLookup, 'chrono');
  assert.deepEqual(f.edits[0][0], f.member);
  assert.match(result.content[0].text, /member chrono#0001/);
});

test('invalid targets, empty changes, overlaps and unknown permissions fail before any lookup', async () => {
  const never = { findGuildChannel: async () => assert.fail('must validate first'), findMember: async () => assert.fail('must validate first') };
  for (const args of [
    { channel: 'c', allow: ['ViewChannel'] },
    { channel: 'c', role: 'a', member: 'b', allow: ['ViewChannel'] },
    { channel: 'c', role: 'a' },
    { channel: 'c', role: 'a', allow: ['ViewChannel'], deny: ['ViewChannel'] },
    { channel: 'c', role: 'a', allow: ['FlyPlanes'] },
  ]) await assert.rejects(setChannelPermissions(args, never));
  await assert.rejects(removeChannelOverwrite({ channel: 'c' }, never));
});

test('threads cannot take overwrites, and Discord failures propagate', async () => {
  const f = fixture({ thread: true });
  await assert.rejects(setChannelPermissions({ channel: 'mod-chat', role: 'mod', allow: ['ViewChannel'] }, f.r), /does not support permission overwrites/);
  const g = fixture();
  g.r.findGuildChannel = async () => { throw new Error('Missing Access'); };
  await assert.rejects(setChannelPermissions({ channel: 'mod-chat', role: 'mod', allow: ['ViewChannel'] }, g.r), /Missing Access/);
});

test('remove-channel-overwrite deletes the overwrite by target id', async () => {
  const f = fixture();
  const result = await removeChannelOverwrite({ channel: 'mod-chat', role: 'Mod', reason: 'open up' }, f.r);
  assert.deepEqual(f.deletes, [[f.mod.id, 'open up']]);
  assert.match(result.content[0].text, /role "Mod" removed from #mod-chat/);
});
