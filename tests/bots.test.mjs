import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { BotPool, tokensFromEnv } from '../build/bots.js';

const guild = (id, name, client) => ({ id, name, memberCount: 3, client });
function bot(tag, guilds, fetchable = {}) {
  const client = { user: { tag, id: tag.replace(/\D/g, '') }, guilds: { cache: new Collection(), fetch: async id => { if (fetchable[id]) return fetchable[id](client); throw new Error('Unknown Guild'); } } };
  for (const [id, name] of guilds) client.guilds.cache.set(id, guild(id, name, client));
  return client;
}

test('tokens: DISCORD_TOKEN, DISCORD_TOKENS and DISCORD_TOKEN_<name>, trimmed, deduped, in order', () => {
  const env = { DISCORD_TOKEN: ' a ', DISCORD_TOKENS: 'b, c;a\nd', DISCORD_TOKEN_ZED: 'e', DISCORD_TOKEN_ALPHA: 'b', DISCORD_TOKENX: 'nope', OTHER: 'x' };
  assert.deepEqual(tokensFromEnv(env), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(tokensFromEnv({}), []);
  assert.throws(() => new BotPool([]), /No Discord bots/);
});

test('guilds are searched across every bot; the first bot wins a shared guild', async () => {
  const one = bot('One#0001', [['100', 'Alpha'], ['300', 'Shared']]);
  const two = bot('Two#0002', [['200', 'Beta'], ['300', 'Shared']]);
  const pool = new BotPool([one, two]);
  assert.deepEqual(pool.guilds().map(g => g.id), ['100', '300', '200']);
  assert.equal((await pool.findGuild('200')).client, two);
  assert.equal((await pool.findGuild('beta')).client, two);
  assert.equal((await pool.findGuild('300')).client, one);
  assert.match(pool.describe().join(','), /"Beta" \(200\) via Two#0002/);
});

test('no identifier: the only guild, else an error naming every server and its bot', async () => {
  const only = new BotPool([bot('One#0001', [['100', 'Alpha']])]);
  assert.equal((await only.findGuild()).id, '100');
  const many = new BotPool([bot('One#0001', [['100', 'Alpha']]), bot('Two#0002', [['200', 'Beta']])]);
  await assert.rejects(many.findGuild(), /2 servers.*"Alpha" \(100\) via One#0001.*"Beta" \(200\) via Two#0002/);
  await assert.rejects(many.findGuild('Gamma'), /not found.*Available servers/);
});

test('an uncached ID is fetched from each bot in turn; ambiguous names never select', async () => {
  const late = bot('Two#0002', [], { '999000000000000000': c => guild('999000000000000000', 'Fresh', c) });
  const pool = new BotPool([bot('One#0001', [['100', 'Dup']]), late, bot('Three#0003', [['101', 'Dup']])]);
  assert.equal((await pool.findGuild('999000000000000000')).client, late);
  await assert.rejects(pool.findGuild('dup'), /Multiple servers found.*specify the server ID/);
  await assert.rejects(pool.findGuild('123456789012345678'), /not found/);
});
