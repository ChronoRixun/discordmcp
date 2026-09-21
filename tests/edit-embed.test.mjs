import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder } from 'discord.js';
import { editEmbed } from '../build/edit-embed.js';

const original = {
  title: 'Welcome', description: 'Original guide', color: 123,
  fields: [{ name: 'Setup', value: 'Read this' }],
  footer: { text: 'Community', icon_url: 'https://example.com/icon.png' },
  image: { url: 'https://example.com/banner.png' },
  thumbnail: { url: 'https://example.com/thumb.png' },
  author: { name: 'Host' }, url: 'https://example.com', timestamp: '2026-09-20T00:00:00.000Z',
};
const base = { channel: 'welcome', server: 'community', messageId: '123' };
function fixture(embeds = [original], authorId = 'bot') {
  const edits = [], fetches = [], resolutions = [];
  const message = {
    author: { id: authorId }, embeds: embeds.map(e => new EmbedBuilder(e)),
    edit: async payload => { edits.push(payload); },
  };
  const channel = { name: 'welcome', client: { user: { id: 'bot' } }, messages: {
    fetch: async options => { fetches.push(options); return message; },
  } };
  const resolve = async (...args) => { resolutions.push(args); return channel; };
  return { edits, fetches, resolutions, message, resolve };
}

test('title-only edit preserves all other fields and does not mutate source embeds', async () => {
  const f = fixture();
  const before = f.message.embeds[0].toJSON();
  await editEmbed({ ...base, title: 'New title' }, f.resolve);
  assert.deepEqual(f.edits, [{ embeds: [{ ...before, title: 'New title' }] }]);
  assert.deepEqual(f.message.embeds[0].toJSON(), before);
  assert.deepEqual(f.resolutions, [['welcome', 'community']]);
  assert.deepEqual(f.fetches, [{ message: '123', force: true }]);
});

test('selected embed changes while all other embeds remain intact', async () => {
  const f = fixture([original, { title: 'Second', description: 'Keep me' }]);
  await editEmbed({ ...base, embedIndex: 1, title: 'Updated' }, f.resolve);
  assert.deepEqual(f.edits[0].embeds[0], original);
  assert.deepEqual(f.edits[0].embeds[1], { title: 'Updated', description: 'Keep me' });
});

test('explicit null clears only selected properties; footer text preserves its icon', async () => {
  const f = fixture();
  await editEmbed({ ...base, image: null, thumbnail: null, color: null, fields: [], footer: 'New footer' }, f.resolve);
  const updated = f.edits[0].embeds[0];
  assert.equal(updated.image, undefined);
  assert.equal(updated.thumbnail, undefined);
  assert.equal(updated.color, undefined);
  assert.deepEqual(updated.fields, []);
  assert.deepEqual(updated.footer, { ...original.footer, text: 'New footer' });
  assert.equal(updated.description, original.description);
});

test('the string "null" clears a property like a real null', async () => {
  const f = fixture();
  await editEmbed({ ...base, image: 'null', color: 'null', footer: 'null' }, f.resolve);
  const updated = f.edits[0].embeds[0];
  assert.equal(updated.image, undefined);
  assert.equal(updated.color, undefined);
  assert.equal(updated.footer, undefined);
  assert.equal(updated.title, original.title);
});

test('black color and replacement field list are retained', async () => {
  const f = fixture();
  await editEmbed({ ...base, color: '#000000', fields: [{ name: 'New', value: 'Value' }] }, f.resolve);
  assert.equal(f.edits[0].embeds[0].color, 0);
  assert.deepEqual(f.edits[0].embeds[0].fields, [{ name: 'New', value: 'Value' }]);
});

test('invalid patches and no-op requests fail before fetching', async () => {
  for (const patch of [{}, { title: '' }, { color: 'xyz' }, { title: 'x'.repeat(257) },
    { embedIndex: -1, title: 'New' }, { embedIndex: 0.5, title: 'New' }, { image: 'not-a-url' }]) {
    const f = fixture();
    await assert.rejects(editEmbed({ ...base, ...patch }, f.resolve));
    assert.equal(f.fetches.length, 0);
    assert.equal(f.edits.length, 0);
  }
});

test('missing embeds and messages owned by others are never edited', async () => {
  for (const f of [fixture([]), fixture([original], 'someone-else')]) {
    await assert.rejects(editEmbed({ ...base, title: 'New' }, f.resolve));
    assert.equal(f.edits.length, 0);
  }
  const f = fixture();
  await assert.rejects(editEmbed({ ...base, embedIndex: 1, title: 'New' }, f.resolve), /does not exist/);
  assert.equal(f.edits.length, 0);
});

test('combined embed text limit is enforced after merging', async () => {
  const f = fixture([{ description: 'x'.repeat(3000) }, { description: 'x'.repeat(3000) }]);
  await assert.rejects(editEmbed({ ...base, title: 'Over limit' }, f.resolve), /6000/);
  assert.equal(f.edits.length, 0);
});

test('Discord edit failure propagates instead of claiming success', async () => {
  const f = fixture();
  f.message.edit = async () => { throw new Error('Missing Permissions'); };
  await assert.rejects(editEmbed({ ...base, title: 'New' }, f.resolve), /Missing Permissions/);
});
