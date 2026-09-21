import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField, PermissionFlagsBits, OverwriteType } from 'discord.js';
import { getChannelInfo } from '../build/channel-info.js';

function fixture({ deny = [], pins = [] } = {}) {
  const everyoneRole = { id: '123', name: '@everyone' };
  const denied = new PermissionsBitField(deny);
  const effective = new PermissionsBitField(PermissionsBitField.Default).remove(denied);
  const channel = {
    id: '456', name: 'server-status', url: 'https://discord.com/channels/123/456',
    guild: {
      id: '123', name: 'Community',
      roles: { everyone: everyoneRole, cache: new Collection([['123', everyoneRole], ['77', { id: '77', name: 'Admin' }]]) },
      members: { cache: new Collection([['555', { user: { tag: 'CodWW2-Mod#8710' } }]]) },
    },
    parent: { name: 'INFO' }, parentId: '900', topic: 'Live server info', nsfw: false,
    rateLimitPerUser: 0, createdAt: new Date('2026-09-20T00:00:00Z'), lastMessageId: '999',
    permissionsFor: role => { assert.equal(role, everyoneRole); return effective; },
    permissionOverwrites: { cache: new Collection([
      ['123', { id: '123', type: OverwriteType.Role, allow: new PermissionsBitField(), deny: denied }],
      ['555', { id: '555', type: OverwriteType.Member, allow: new PermissionsBitField([PermissionFlagsBits.SendMessages]), deny: new PermissionsBitField() }],
    ]) },
    messages: { fetchPinned: async () => new Collection(pins.map(id => [id, { id }])) },
  };
  return channel;
}

test('a locked info channel reports read-only @everyone, named overwrites and its pins', async () => {
  const channel = fixture({ deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions], pins: ['1', '2'] });
  const resolved = [];
  const result = await getChannelInfo({ server: 'community', channel: 'server-status' }, async (...args) => {
    resolved.push(args); return channel;
  });
  const info = JSON.parse(result.content[0].text);
  assert.deepEqual(resolved, [['server-status', 'community']]);
  assert.equal(info.name, '#server-status');
  assert.equal(info.category, 'INFO');
  assert.equal(info.topic, 'Live server info');
  assert.deepEqual(info.everyone, { view: true, readHistory: true, send: false, react: false });
  assert.equal(info.pinnedCount, 2);
  assert.deepEqual(info.pinnedMessageIds, ['1', '2']);
  assert.deepEqual(info.overwrites[0], { id: '123', type: 'role', name: '@everyone', allow: [], deny: ['AddReactions', 'SendMessages'] });
  assert.deepEqual(info.overwrites[1], { id: '555', type: 'member', name: 'CodWW2-Mod#8710', allow: ['SendMessages'], deny: [] });
});

test('an open channel reports send and react as allowed and nulls for missing settings', async () => {
  const channel = fixture();
  channel.topic = null; channel.parent = null; channel.parentId = null; channel.lastMessageId = null; channel.rateLimitPerUser = null;
  const info = JSON.parse((await getChannelInfo({ channel: 'general' }, async () => channel)).content[0].text);
  assert.deepEqual(info.everyone, { view: true, readHistory: true, send: true, react: true });
  assert.equal(info.topic, null);
  assert.equal(info.category, null);
  assert.equal(info.slowmodeSeconds, 0);
  assert.equal(info.pinnedCount, 0);
});

test('validation and lookup failures surface instead of partial results', async () => {
  await assert.rejects(getChannelInfo({}, async () => assert.fail('must validate first')));
  await assert.rejects(getChannelInfo({ channel: 'missing' }, async () => { throw new Error('Channel not found'); }), /Channel not found/);
});
