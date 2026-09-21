import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, EmbedBuilder } from 'discord.js';
import { readMessages, getMessage, listPins, parseMessageUrl } from '../build/read-messages.js';

function message(overrides = {}) {
  return {
    id: '1551098866785587201', url: 'https://discord.com/channels/123/456/1551098866785587201', member: null,
    author: { tag: 'Reader#1234', id: '789', bot: false },
    content: 'Hello', createdAt: new Date('2026-09-20T12:00:00Z'),
    editedAt: null, type: 0, pinned: false, embeds: [],
    attachments: new Collection(), reactions: { cache: new Collection() },
    reference: null, thread: null, ...overrides,
  };
}
function fixture(messages = []) {
  const calls = [];
  const channel = {
    id: '456', name: 'welcome', guild: { id: '123', name: 'Community' },
    messages: { fetch: async options => {
      calls.push(options);
      return new Collection(messages.map(m => [m.id, m]));
    } },
  };
  return { channel, calls };
}
async function read(messages, args = { channel: 'welcome' }) {
  const { channel, calls } = fixture(messages);
  const result = await readMessages(args, async () => channel);
  return { data: JSON.parse(result.content[0].text), calls };
}

test('embed-only messages preserve full embed and existing fields with usable IDs', async () => {
  const embed = new EmbedBuilder().setTitle('Welcome').setDescription('Start here')
    .setColor(0xe8a33d).addFields({ name: 'Connect', value: 'Read the guide', inline: true })
    .setImage('https://example.com/banner.png').setFooter({ text: 'Community' });
  const { data } = await read([message({ content: '', embeds: [embed] })]);
  assert.equal(data[0].content, '');
  assert.equal(data[0].id, '1551098866785587201');
  assert.deepEqual(data[0].embeds, JSON.parse(JSON.stringify([embed.toJSON()])));
  assert.equal(data[0].author, 'Reader#1234');
  assert.equal(data[0].channel, '#welcome');
  assert.equal(data[0].server, 'Community');
  assert.equal(data[0].timestamp, '2026-09-20T12:00:00.000Z');
});

test('attachments, unicode/custom reactions, edits and threads survive serialization', async () => {
  const attachment = { id: '9', name: 'clip.mp4', description: 'Match clip',
    url: 'https://example.com/clip.mp4', contentType: 'video/mp4', size: 4096,
    width: 1920, height: 1080, spoiler: true };
  const { data } = await read([message({
    attachments: new Collection([['9', attachment]]),
    reactions: { cache: new Collection([
      ['unicode', { emoji: { id: null, name: '\u{1f44d}' }, count: 2, me: false }],
      ['custom', { emoji: { id: '99', name: 'party', animated: true }, count: 1, me: true }],
    ]) },
    editedAt: new Date('2026-09-20T13:00:00Z'), pinned: true,
    thread: { id: '11', name: 'Discussion', archived: false, url: 'https://example.com/thread' },
  })]);
  assert.deepEqual(data[0].attachments, [attachment]);
  assert.deepEqual(data[0].reactions, [
    { emoji: { id: null, name: '\u{1f44d}', animated: false }, count: 2, me: false },
    { emoji: { id: '99', name: 'party', animated: true }, count: 1, me: true },
  ]);
  assert.equal(data[0].editedTimestamp, '2026-09-20T13:00:00.000Z');
  assert.equal(data[0].pinned, true);
  assert.equal(data[0].thread.name, 'Discussion');
});

test('reply previews use only the fetched batch and preserve history order', async () => {
  const parent = message({ id: '100', content: 'Original' });
  const reply = message({ reference: { messageId: '100', channelId: '456', guildId: '123' } });
  const { data, calls } = await read([reply, parent]);
  assert.equal(data[0].replyPreview.content, 'Original');
  assert.equal(data[0].reference.url, 'https://discord.com/channels/123/456/100');
  assert.equal(data[1].id, '100');
  assert.equal(calls.length, 1);
});

test('missing references do not trigger extra fetches or invented previews', async () => {
  for (const channelId of ['456', 'other']) {
    const { data, calls } = await read([message({ reference: { messageId: '100', channelId, guildId: '123' } })]);
    assert.equal(data[0].reference.messageId, '100');
    assert.equal(data[0].replyPreview, null);
    assert.equal(calls.length, 1);
  }
});

test('requested server and integer limits reach the resolver and history fetch', async () => {
  const { channel, calls } = fixture();
  const resolved = [];
  await readMessages({ server: 'second-server', channel: 'welcome', limit: 100 }, async (...args) => {
    resolved.push(args); return channel;
  });
  assert.deepEqual(resolved, [['welcome', 'second-server']]);
  assert.deepEqual(calls, [{ limit: 100, cache: false }]);
  const result = await read([]);
  assert.deepEqual(result.data, []);
  assert.deepEqual(result.calls, [{ limit: 50, cache: false }]);
});

test('invalid limits fail before channel or network access', async () => {
  for (const limit of [0, 101, 1.5, '10', null]) {
    await assert.rejects(readMessages({ channel: 'welcome', limit }, async () => {
      assert.fail('must validate before resolving a channel');
    }), /Number|number|integer|Expected/);
  }
});

test('lookup and history permission failures remain visible', async () => {
  await assert.rejects(readMessages({ channel: 'missing' }, async () => {
    throw new Error('Channel not found');
  }), /Channel not found/);
  const { channel } = fixture();
  channel.messages.fetch = async () => { throw new Error('Missing Access'); };
  await assert.rejects(readMessages({ channel: 'welcome' }, async () => channel), /Missing Access/);
});

// --- paging, filters, get-message, list-pins ---

test('before/after reach the fetch and an ascending after-page comes back newest first', async () => {
  const older = message({ id: '10000000000000000' }), newer = message({ id: '20000000000000000' });
  const { data, calls } = await read([older, newer], { channel: 'welcome', after: '99999999999999999' });
  assert.deepEqual(calls, [{ limit: 50, cache: false, after: '99999999999999999' }]);
  assert.deepEqual(data.map(m => m.id), ['20000000000000000', '10000000000000000']);
  const paged = await read([], { channel: 'welcome', before: '99999999999999999', limit: 10 });
  assert.deepEqual(paged.calls, [{ limit: 10, cache: false, before: '99999999999999999' }]);
});

test('author filter matches id, tag, username or display name case-insensitively', async () => {
  const chrono = message({ id: '30000000000000000', author: { tag: 'chrono#0001', id: '42', bot: false, username: 'chrono' }, member: { displayName: 'CR' } });
  const other = message({ id: '20000000000000000', author: { tag: 'Other#9', id: '43', bot: false, username: 'other' } });
  for (const author of ['42', 'CHRONO#0001', 'Chrono', 'cr']) {
    const { data } = await read([chrono, other], { channel: 'welcome', author });
    assert.deepEqual(data.map(m => m.id), ['30000000000000000'], author);
  }
});

test('excludeSystem drops pin notices but keeps posts and replies', async () => {
  const pinNotice = message({ id: '30000000000000000', type: 6 });
  const reply = message({ id: '20000000000000000', type: 19 });
  const post = message({ id: '10000000000000000', type: 0 });
  const { data } = await read([pinNotice, reply, post], { channel: 'welcome', excludeSystem: true });
  assert.deepEqual(data.map(m => m.id), ['20000000000000000', '10000000000000000']);
  const all = await read([pinNotice, reply, post]);
  assert.equal(all.data.length, 3);
});

test('before with after, and malformed ids, fail before resolving a channel', async () => {
  for (const args of [
    { channel: 'welcome', before: '99999999999999999', after: '99999999999999998' },
    { channel: 'welcome', before: 'abc' },
    { channel: 'welcome', after: '12' },
  ]) {
    await assert.rejects(readMessages(args, async () => assert.fail('must validate first')));
  }
});

function single(target, replyTarget, { failReplyFetch = false } = {}) {
  const fetches = [];
  const channel = {
    id: '45600000000000000', name: 'welcome', guild: { id: '12300000000000000', name: 'Community' },
    messages: {
      fetch: async options => {
        fetches.push(options);
        if (options.message === target.id) return target;
        if (failReplyFetch) throw new Error('Unknown Message');
        if (replyTarget && options.message === replyTarget.id) return replyTarget;
        throw new Error('Unknown Message');
      },
      fetchPinned: async () => new Collection(),
    },
  };
  return { channel, fetches };
}

test('get-message by link resolves the channel from the link and previews a same-channel reply', async () => {
  const parent = message({ id: '10000000000000000', content: 'Parent' });
  const target = message({ id: '20000000000000000', reference: { messageId: '10000000000000000', channelId: '45600000000000000', guildId: '12300000000000000' } });
  const { channel, fetches } = single(target, parent);
  const resolved = [];
  const result = await getMessage({ url: 'https://discord.com/channels/12300000000000000/45600000000000000/20000000000000000' }, async (...args) => {
    resolved.push(args); return channel;
  });
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(resolved, [['45600000000000000', '12300000000000000']]);
  assert.deepEqual(fetches, [{ message: '20000000000000000', force: true }, { message: '10000000000000000', force: true }]);
  assert.equal(data.id, '20000000000000000');
  assert.equal(data.replyPreview.content, 'Parent');
});

test('get-message by channel + id works, and a missing reply target yields a null preview', async () => {
  const target = message({ id: '20000000000000000', reference: { messageId: '10000000000000000', channelId: '45600000000000000', guildId: '12300000000000000' } });
  const { channel } = single(target, undefined, { failReplyFetch: true });
  const resolved = [];
  const result = await getMessage({ server: 'community', channel: 'welcome', messageId: '20000000000000000' }, async (...args) => {
    resolved.push(args); return channel;
  });
  assert.deepEqual(resolved, [['welcome', 'community']]);
  assert.equal(JSON.parse(result.content[0].text).replyPreview, null);
});

test('get-message needs a link or channel + id, and rejects non-message links', async () => {
  for (const args of [{}, { channel: 'welcome' }, { messageId: '20000000000000000' },
    { url: 'https://example.com/channels/12300000000000000/45600000000000000/20000000000000000' }, { url: 'https://discord.com/channels/12300000000000000/45600000000000000' }]) {
    await assert.rejects(getMessage(args, async () => assert.fail('must validate first')));
  }
  assert.deepEqual(parseMessageUrl('https://canary.discord.com/channels/12300000000000000/45600000000000000/20000000000000000/'),
    { serverId: '12300000000000000', channelId: '45600000000000000', messageId: '20000000000000000' });
});

test('list-pins serializes pinned messages newest first', async () => {
  const first = message({ id: '10000000000000000', pinned: true }), second = message({ id: '20000000000000000', pinned: true });
  const channel = {
    id: '45600000000000000', name: 'welcome', guild: { id: '12300000000000000', name: 'Community' },
    messages: { fetchPinned: async () => new Collection([[first.id, first], [second.id, second]]) },
  };
  const result = await listPins({ channel: 'welcome' }, async () => channel);
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(data.map(m => m.id), ['20000000000000000', '10000000000000000']);
  assert.equal(data[0].channel, '#welcome');
  assert.equal(data[0].replyPreview, undefined);
});

test('page metadata advances through a fully filtered page while the default stays an array', async () => {
  const newer = message({ id: '20000000000000000', type: 6 });
  const older = message({ id: '10000000000000000', type: 6 });
  const { data } = await read([older, newer], { channel: 'welcome', excludeSystem: true, limit: 2, includePageInfo: true });
  assert.deepEqual(data, { messages: [], page: { fetched: 2, returned: 0, nextBefore: older.id, nextAfter: newer.id, mayHaveMore: true } });
  const empty = await read([], { channel: 'welcome', includePageInfo: true });
  assert.deepEqual(empty.data.page, { fetched: 0, returned: 0, nextBefore: null, nextAfter: null, mayHaveMore: false });
  assert.ok(Array.isArray((await read([older])).data));
});
