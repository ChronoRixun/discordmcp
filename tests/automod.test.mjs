import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { createAutomodRule, listAutomodRules, deleteAutomodRule } from '../build/automod.js';

function fixture(rules = []) {
  const created = [];
  const mod = { id: '20000000000000000', name: 'Mod' };
  const alerts = { id: '45600000000000000', name: 'mod-alerts' };
  const guild = {
    id: '12300000000000000', name: 'Community',
    roles: { cache: new Collection([[mod.id, mod]]) },
    channels: { cache: new Collection([[alerts.id, alerts]]) },
    autoModerationRules: {
      create: async options => { created.push(options); return { id: '777', name: options.name }; },
      fetch: async () => new Collection(rules.map(rule => [rule.id, rule])),
    },
  };
  const r = {
    findGuild: async () => guild,
    findChannel: async name => { r.channelLookup = name; return alerts; },
    findGuildChannel: async name => ({ id: '9', name }),
  };
  return { created, guild, mod, alerts, r };
}

test('keyword rule builds Discord trigger metadata, all three actions and exemptions', async () => {
  const f = fixture();
  const result = await createAutomodRule({
    name: 'No slurs', trigger: 'keyword', keywords: ['badword', 'worse*'], regexPatterns: ['b[a4]d'], allowList: ['badminton'],
    customMessage: 'Not here.', alertChannel: 'mod-alerts', timeoutMinutes: 10, exemptRoles: ['mod'], exemptChannels: ['staff'], reason: 'rule 1',
  }, f.r);
  assert.equal(f.created.length, 1);
  const options = f.created[0];
  assert.equal(options.name, 'No slurs');
  assert.equal(options.eventType, 1);
  assert.equal(options.triggerType, 1);
  assert.deepEqual(options.triggerMetadata, { keywordFilter: ['badword', 'worse*'], regexPatterns: ['b[a4]d'], allowList: ['badminton'] });
  assert.deepEqual(options.actions, [
    { type: 1, metadata: { customMessage: 'Not here.' } },
    { type: 2, metadata: { channel: f.alerts } },
    { type: 3, metadata: { durationSeconds: 600 } },
  ]);
  assert.equal(options.enabled, true);
  assert.deepEqual(options.exemptRoles, [f.mod]);
  assert.deepEqual(options.exemptChannels, [{ id: '9', name: 'staff' }]);
  assert.equal(options.reason, 'rule 1');
  assert.equal(f.r.channelLookup, 'mod-alerts');
  assert.match(result.content[0].text, /"No slurs" \(keyword\) created in Community\. ID: 777/);
});

test('preset, spam and mention rules map their trigger types and metadata', async () => {
  const f = fixture();
  await createAutomodRule({ name: 'Presets', trigger: 'keyword_preset', presets: ['profanity', 'slurs'], enabled: false }, f.r);
  await createAutomodRule({ name: 'Spam', trigger: 'spam', blockMessage: false, alertChannel: 'mod-alerts' }, f.r);
  await createAutomodRule({ name: 'Mentions', trigger: 'mention_spam', mentionLimit: 5, timeoutMinutes: 1 }, f.r);
  assert.equal(f.created[0].triggerType, 4);
  assert.deepEqual(f.created[0].triggerMetadata, { presets: [1, 3], allowList: [] });
  assert.equal(f.created[0].enabled, false);
  assert.equal(f.created[1].triggerType, 3);
  assert.deepEqual(f.created[1].triggerMetadata, {});
  assert.deepEqual(f.created[1].actions, [{ type: 2, metadata: { channel: f.alerts } }]);
  assert.equal(f.created[2].triggerType, 5);
  assert.deepEqual(f.created[2].triggerMetadata, { mentionTotalLimit: 5 });
  assert.deepEqual(f.created[2].actions, [{ type: 1 }, { type: 3, metadata: { durationSeconds: 60 } }]);
});

test('incoherent rules fail before any lookup', async () => {
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const args of [
    { name: 'x', trigger: 'keyword' },
    { name: 'x', trigger: 'keyword_preset' },
    { name: 'x', trigger: 'mention_spam' },
    { name: 'x', trigger: 'spam', timeoutMinutes: 5 },
    { name: 'x', trigger: 'spam', blockMessage: false },
    { name: 'x', trigger: 'keyword', keywords: ['a'], timeoutMinutes: 999999 },
    { name: 'x', trigger: 'keyword', regexPatterns: Array(11).fill('a') },
  ]) await assert.rejects(createAutomodRule(args, never), undefined, JSON.stringify(args));
});

function rule(overrides = {}) {
  const made = {
    id: '777', name: 'No slurs', enabled: true, triggerType: 1,
    triggerMetadata: { keywordFilter: ['badword'], regexPatterns: [], allowList: ['badminton'], presets: [], mentionTotalLimit: null },
    actions: [{ type: 1, metadata: { customMessage: 'Not here.' } }, { type: 2, metadata: { channelId: '45600000000000000' } }, { type: 3, metadata: { durationSeconds: 600 } }],
    exemptRoles: new Collection([['1', { name: 'Mod' }]]), exemptChannels: new Collection(),
    ...overrides,
  };
  made.delete = async reason => { made.deleted = reason; };
  return made;
}

test('list-automod-rules serializes triggers, actions and exemptions by name', async () => {
  const f = fixture([rule(), rule({ id: '778', name: 'Presets', triggerType: 4, triggerMetadata: { keywordFilter: [], regexPatterns: [], allowList: [], presets: [1, 3], mentionTotalLimit: null }, actions: [{ type: 1, metadata: {} }] })]);
  const data = JSON.parse((await listAutomodRules({}, f.r)).content[0].text);
  assert.equal(data.length, 2);
  assert.deepEqual(data[0], {
    id: '777', name: 'No slurs', enabled: true, trigger: 'keyword', keywords: ['badword'], regexPatterns: [], allowList: ['badminton'], presets: [], mentionLimit: null,
    actions: [
      { type: 'block_message', channel: null, durationSeconds: null, customMessage: 'Not here.' },
      { type: 'send_alert', channel: 'mod-alerts', durationSeconds: null, customMessage: null },
      { type: 'timeout', channel: null, durationSeconds: 600, customMessage: null },
    ],
    exemptRoles: ['Mod'], exemptChannels: [],
  });
  assert.equal(data[1].trigger, 'keyword_preset');
  assert.deepEqual(data[1].presets, ['profanity', 'slurs']);
});

test('delete-automod-rule matches by name case-insensitively and names the rules when missing', async () => {
  const target = rule();
  const f = fixture([target]);
  await deleteAutomodRule({ rule: 'no SLURS', reason: 'retired' }, f.r);
  assert.equal(target.deleted, 'retired');
  await assert.rejects(deleteAutomodRule({ rule: 'nothing' }, f.r), /Rules: "No slurs"/);
});
