import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { findMember } from '../build/member-lookup.js';
const member = (id, name = 'Same') => ({ id, displayName: name, user: { username: `user${id}`, tag: `user${id}#0001`, globalName: name } });
function fixture(candidates) {
  const calls = [], cache = new Collection(candidates.map(m => [m.id, m]));
  return { calls, guild: { name: 'Test', members: { cache, search: async () => cache, fetch: async id => { calls.push(id); return member(id); } } } };
}
test('member display-name collisions cannot select a moderation target', async () => {
  const f = fixture([member('1'), member('2')]);
  await assert.rejects(findMember(f.guild, 'Same'), /Multiple members/);
  assert.equal(f.calls.length, 0);
});
test('member IDs and mentions use direct REST fetch', async () => {
  const f = fixture([]);
  for (const value of ['12345678901234567', '<@12345678901234567>', '<@!12345678901234567>']) {
    assert.equal((await findMember(f.guild, value)).id, '12345678901234567');
  }
  assert.deepEqual(f.calls, Array(3).fill('12345678901234567'));
});
test('exact username works, failed or truncated searches never guess', async () => {
  const f = fixture([member('1')]);
  assert.equal((await findMember(f.guild, 'USER1')).id, '1');
  f.guild.members.search = async () => { throw new Error('Missing Access'); };
  await assert.rejects(findMember(f.guild, 'Same'), /Missing Access/);
  const full = fixture(Array.from({length:100}, (_,i) => member(String(i), `name${i}`)));
  await assert.rejects(findMember(full.guild, 'name0'), /truncated/);
});
