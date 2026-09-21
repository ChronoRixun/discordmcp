import test from 'node:test';
import assert from 'node:assert/strict';
import { timeoutMember, removeTimeout } from '../build/moderation.js';

function fixture({ moderatable = true } = {}) {
  const calls = [];
  const until = new Date('2026-09-22T00:00:00Z');
  const member = {
    moderatable, user: { tag: 'troll#0001' }, communicationDisabledUntil: null,
    timeout: async (ms, reason) => { calls.push([ms, reason]); member.communicationDisabledUntil = ms ? until : null; },
  };
  const guild = { name: 'Community' };
  const r = { findGuild: async () => guild, findMember: async (g, user) => { r.lookup = user; return member; } };
  return { calls, member, r };
}

test('timeout-member converts minutes to milliseconds and reports when it ends', async () => {
  const f = fixture();
  const result = await timeoutMember({ user: 'troll', minutes: 30, reason: 'rule 1' }, f.r);
  assert.deepEqual(f.calls, [[1_800_000, 'rule 1']]);
  assert.equal(f.r.lookup, 'troll');
  assert.match(result.content[0].text, /troll#0001 timed out for 30 min in Community, until 2026-09-22T00:00:00\.000Z\. Reason: rule 1/);
});

test('members the bot cannot moderate are refused before any call', async () => {
  const f = fixture({ moderatable: false });
  await assert.rejects(timeoutMember({ user: 'owner', minutes: 5 }, f.r), /cannot be timed out/);
  assert.deepEqual(f.calls, []);
});

test('remove-timeout clears the timeout, and bad durations fail before lookup', async () => {
  const f = fixture();
  await removeTimeout({ user: 'troll', reason: 'appeal accepted' }, f.r);
  assert.deepEqual(f.calls, [[null, 'appeal accepted']]);
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const minutes of [0, 40321, 1.5, '10']) await assert.rejects(timeoutMember({ user: 'x', minutes }, never));
});
