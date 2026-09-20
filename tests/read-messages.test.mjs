import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, EmbedBuilder } from 'discord.js';
import { readMessages } from '../build/read-messages.js';

function message(overrides = {}) {
  return {
    id: '1551098866785587201', url: 'https://discord.com/channels/123/456/1551098866785587201',
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
