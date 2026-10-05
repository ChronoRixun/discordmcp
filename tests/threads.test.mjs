import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';
import { parseChannelUrl, threadsNamed, collectGuildThreads, resolveChannel, serializeThread, listThreads } from '../build/threads.js';
import { sendMessage } from '../build/send.js';

const GUILD_ID = '12300000000000001';
const FORUM_ID = '45600000000000001';
const TEXT_ID = '45600000000000002';

function thread(overrides = {}) {
  return {
    id: '1551098866785587201',
    type: ChannelType.PublicThread,
    name: 'Bug report',
    url: `https://discord.com/channels/${GUILD_ID}/1551098866785587201`,
    guild: { id: GUILD_ID, name: 'Test Server', members: { cache: new Collection() } },
    parent: { id: FORUM_ID, name: 'port-bugs' },
    parentId: FORUM_ID,
    ownerId: '78900000000000001',
    createdAt: new Date('2026-09-20T12:00:00Z'),
    messageCount: 7,
    archived: false,
    locked: false,
    appliedTags: [],
    ...overrides,
  };
}

function forum(overrides = {}) {
  return {
    id: FORUM_ID,
    type: ChannelType.GuildForum,
    name: 'port-bugs',
    availableTags: [
      { id: 'tag1', name: 'crash', moderated: false, emoji: null },
      { id: 'tag2', name: 'ui', moderated: true, emoji: null },
    ],
    ...overrides,
  };
}

/** A guild mock: postable channels in cache, active/archived thread fetches stubbed per parent. */
function guild({ channels = [], active = [], archived = {}, fetch = null } = {}) {
  const activeCollection = new Collection(active.map(t => [t.id, t]));
  return {
    id: GUILD_ID,
    name: 'Test Server',
    client: { channels: { fetch: fetch ?? (async () => { throw new Error('Unknown Channel'); }) } },
    channels: {
      cache: new Collection(channels.map(c => [c.id, c])),
      fetchActiveThreads: async () => ({ threads: activeCollection }),
    },
    members: { cache: new Collection() },
    _archived: archived,
  };
}

/** Gives a parent channel its archived-threads stub from the guild's _archived map. */
function withArchived(g, parent) {
  const archived = g._archived[parent.id] ?? [];
  parent.threads = {
    fetchArchived: async () => ({ threads: new Collection(archived.map(t => [t.id, t])) }),
  };
  return parent;
}

// --- parseChannelUrl ---

test('parseChannelUrl accepts channel and message links on every Discord host', () => {
  assert.deepEqual(parseChannelUrl(`https://discord.com/channels/${GUILD_ID}/${FORUM_ID}`), { serverId: GUILD_ID, channelId: FORUM_ID, messageId: null });
  assert.deepEqual(parseChannelUrl(`https://discord.com/channels/${GUILD_ID}/${FORUM_ID}/1551098866785587201`), { serverId: GUILD_ID, channelId: FORUM_ID, messageId: '1551098866785587201' });
  assert.deepEqual(parseChannelUrl(`https://canary.discord.com/channels/${GUILD_ID}/${FORUM_ID}/`), { serverId: GUILD_ID, channelId: FORUM_ID, messageId: null });
  assert.deepEqual(parseChannelUrl(`https://ptb.discordapp.com/channels/${GUILD_ID}/${FORUM_ID}`), { serverId: GUILD_ID, channelId: FORUM_ID, messageId: null });
});

test('parseChannelUrl rejects server-only links, foreign hosts and plain names', () => {
  for (const value of [
    `https://discord.com/channels/${GUILD_ID}`,
    'https://example.com/channels/123/456',
    'port-bugs',
    `https://discord.com/channels/${GUILD_ID}/${FORUM_ID}/nope`,
  ]) {
    assert.equal(parseChannelUrl(value), null, value);
  }
});

// --- collectGuildThreads / threadsNamed ---

test('collectGuildThreads merges active and archived threads, skipping non-parent channels', async () => {
  const activeThread = thread();
  const archivedThread = thread({ id: '1551098866785587999', name: 'Old post', archived: true });
  const f = forum();
  withThreads(f, [archivedThread]);
  const voice = { id: '99900000000000001', type: ChannelType.GuildVoice, name: 'lobby' };
  const g = guild({ channels: [f, voice], active: [activeThread] });
  const collected = await collectGuildThreads(g);
  assert.deepEqual(collected.map(t => t.id).sort(), [activeThread.id, archivedThread.id].sort());
  // The voice channel has no threads manager and must not be consulted
  assert.equal(voice.threads, undefined);
});

function withThreads(parent, archived) {
  parent.threads = {
    fetchArchived: async () => ({ threads: new Collection(archived.map(t => [t.id, t])) }),
  };
  return parent;
}

test('threadsNamed matches case-insensitively and exactly, tolerating a leading #', () => {
  const a = thread({ name: 'Steam Deck Bug' });
  const b = thread({ id: '1551098866785587302', name: 'steam deck bug' });
  const c = thread({ id: '1551098866785587303', name: 'Steam Deck Bugs' });
  assert.deepEqual(threadsNamed([a, b, c], 'STEAM DECK BUG'), [a, b]);
  assert.deepEqual(threadsNamed([a, b, c], '#steam deck bug'), [a, b]);
  assert.deepEqual(threadsNamed([a, b, c], 'nope'), []);
});

// --- resolveChannel ---

test('resolveChannel finds a thread by ID through the client fetch', async () => {
  const target = thread();
  const g = guild({ fetch: async id => (id === target.id ? target : null) });
  const resolved = await resolveChannel(g, target.id);
  assert.equal(resolved.id, target.id);
});

test('resolveChannel resolves a channel or message link to its channel ID', async () => {
  const target = thread();
  const fetches = [];
  const g = guild({ fetch: async id => { fetches.push(id); return target; } });
  const byChannelLink = await resolveChannel(g, `https://discord.com/channels/${GUILD_ID}/${target.id}`);
  assert.equal(byChannelLink.id, target.id);
  const byMessageLink = await resolveChannel(g, `https://discord.com/channels/${GUILD_ID}/${target.id}/1551098866785587999`);
  assert.equal(byMessageLink.id, target.id);
  assert.deepEqual(fetches, [target.id, target.id]);
});

test('resolveChannel rejects a link that points at a different server', async () => {
  const g = guild();
  await assert.rejects(
    resolveChannel(g, 'https://discord.com/channels/99900000000000001/1551098866785587201'),
    /points to server 99900000000000001/);
});

test('resolveChannel finds an archived thread by exact name', async () => {
  const archived = thread({ id: '1551098866785587999', name: 'Old crash', archived: true });
  const f = withThreads(forum(), [archived]);
  const g = guild({ channels: [f] });
  const resolved = await resolveChannel(g, 'old crash');
  assert.equal(resolved.id, archived.id);
});

test('resolveChannel finds a channel by name and prefers the ID lookup', async () => {
  const text = { id: TEXT_ID, type: ChannelType.GuildText, name: 'general' };
  const g = guild({ channels: [text] });
  assert.equal((await resolveChannel(g, 'GENERAL')).id, TEXT_ID);
  assert.equal((await resolveChannel(g, '#general')).id, TEXT_ID);
});

test('resolveChannel errors on a forum for message tools but resolves it when forums are allowed', async () => {
  const f = forum();
  const g = guild({ channels: [f] });
  await assert.rejects(resolveChannel(g, 'port-bugs'), /forum channel.*list-threads/s);
  assert.equal((await resolveChannel(g, 'port-bugs', { includeForums: true })).id, FORUM_ID);
});

test('resolveChannel reports ambiguity with each candidate, its ID and parent channel', async () => {
  const first = thread({ id: '1551098866785587101', name: 'dupe' });
  const second = thread({ id: '1551098866785587102', name: 'Dupe', parent: { id: TEXT_ID, name: 'general' }, parentId: TEXT_ID });
  const text = { id: TEXT_ID, type: ChannelType.GuildText, name: 'general' };
  const f = withThreads(forum(), [second]);
  const g = guild({ channels: [text, f], active: [first] });
  await assert.rejects(resolveChannel(g, 'dupe'),
    /Multiple channels or threads.*"dupe" \(thread in #port-bugs, id 1551098866785587101\).*"Dupe" \(thread in #general, id 1551098866785587102\)/s);
});

test('resolveChannel does not double-count a thread that is cached and active', async () => {
  const t = thread();
  const g = guild({ channels: [t], active: [t] });
  assert.equal((await resolveChannel(g, 'bug report')).id, t.id);
});

test('resolveChannel not-found error points at list-threads for forum posts', async () => {
  const text = { id: TEXT_ID, type: ChannelType.GuildText, name: 'general' };
  const g = guild({ channels: [text] });
  await assert.rejects(resolveChannel(g, 'missing'),
    /Channel "missing" not found in server "Test Server".*Available channels: "#general".*list-threads/s);
});

test('resolveChannel rejects a non-postable channel fetched by ID with its kind', async () => {
  const voice = { id: '99900000000000001', type: ChannelType.GuildVoice, name: 'lobby', guild: { id: GUILD_ID } };
  const g = guild({ fetch: async () => voice });
  await assert.rejects(resolveChannel(g, voice.id), /is a voice channel, not a text, announcement or thread/);
});

// --- serializeThread / listThreads ---

test('serializeThread maps tag IDs to names and prefers the owner tag over the raw ID', async () => {
  const t = thread({ appliedTags: ['tag1', 'tag2', 'tag3'] });
  t.parent = forum();
  t.guild = {
    id: GUILD_ID, name: 'Test Server',
    members: { cache: new Collection([['78900000000000001', { user: { tag: 'Deckard#0001' } }]]) },
  };
  const data = serializeThread(t);
  assert.deepEqual(data.tags, ['crash', 'ui', 'tag3']);
  assert.equal(data.owner, 'Deckard#0001');
  assert.equal(data.parent.name, 'port-bugs');
  assert.equal(data.createdAt, '2026-09-20T12:00:00.000Z');
  assert.equal(data.messageCount, 7);
  assert.equal(data.archived, false);
  assert.equal(data.locked, false);
});

test('listThreads channel mode merges active and archived newest first and applies the limit', async () => {
  const older = thread({ id: '1551098866785587101', name: 'older', archived: true, messageCount: 1 });
  const newest = thread({ id: '1551098866785587303', name: 'newest' });
  const f = withThreads(forum(), [older]);
  f.threads.fetchActive = async () => ({ threads: new Collection([[newest.id, newest]]) });
  const resolutions = [];
  const result = await listThreads({ channel: 'port-bugs', limit: 1 }, {
    findGuild: async name => (assert.equal(name, undefined), guild()),
    findGuildChannel: async (...args) => { resolutions.push(args); return f; },
  });
  assert.deepEqual(resolutions, [['port-bugs', undefined]]);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.length, 1);
  assert.equal(data[0].name, 'newest');
  const all = await listThreads({ channel: 'port-bugs' }, {
    findGuild: async () => guild(),
    findGuildChannel: async () => f,
  });
  assert.deepEqual(JSON.parse(all.content[0].text).map(t => t.name), ['newest', 'older']);
});

test('listThreads server-wide mode returns active threads only', async () => {
  const t = thread();
  const g = guild({ active: [t] });
  const result = await listThreads({}, { findGuild: async () => g });
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(data.map(x => x.id), [t.id]);
});

test('listThreads refuses channels that cannot hold threads', async () => {
  const voice = { id: '99900000000000001', type: ChannelType.GuildVoice, name: 'lobby' };
  await assert.rejects(
    listThreads({ channel: 'lobby' }, { findGuild: async () => guild(), findGuildChannel: async () => voice }),
    /"lobby" is a voice channel.*read-messages with the thread name or ID/s);
});

// --- sending into a thread ---

test('send-message posts into a thread resolved by name', async () => {
  const sends = [];
  const target = thread({ name: 'Steam Deck Bug' });
  target.send = async payload => { sends.push(payload); return { id: '900', url: target.url + '/900' }; };
  const g = guild({ active: [target] });
  const result = await sendMessage({ server: 'Test Server', channel: 'steam deck bug', message: 'Fixed in 1.0.1' },
    async (channel, server) => {
      assert.deepEqual([channel, server], ['steam deck bug', 'Test Server']);
      return resolveChannel(g, channel);
    });
  assert.deepEqual(sends, [{ content: 'Fixed in 1.0.1' }]);
  assert.match(result.content[0].text, /Message sent to #Steam Deck Bug in Test Server\. Message ID: 900\./);
});
