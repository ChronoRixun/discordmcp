import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { editAutomodRule, editEvent, lifecycleTools } from '../build/lifecycle.js';
import { createEvent, deleteEvent } from '../build/events.js';
import { deleteAutomodRule } from '../build/automod.js';

const start = new Date(Date.now() + 86400000).toISOString();
const end = new Date(Date.now() + 172800000).toISOString();
function setup(overrides = {}, kind = 'rule') {
  const edits = [], deletes = [];
  const item = {
    id: '12345678901234567', name: 'Test', triggerType: 1,
    triggerMetadata: { keywordFilter: ['spam'], regexPatterns: ['sp[a@]m'], allowList: ['spamton'], presets: [] },
    status: 1, entityType: 3, scheduledStartTimestamp: Date.parse(start), scheduledEndTimestamp: Date.parse(end),
    url: 'https://discord.com/events/1/12345678901234567',
    edit: async data => { edits.push(data); }, delete: async data => { deletes.push(data); }, ...overrides,
  };
  const items = new Collection([[item.id, item]]);
  const guild = { name: 'Community', autoModerationRules: { fetch: async () => items }, scheduledEvents: { fetch: async () => items } };
  return { edits, deletes, item, items, r: { findGuild: async () => guild } };
}
test('AutoMod enable/rename preserves actions, metadata and exemptions by omission', async () => {
  const f = setup();
  await editAutomodRule({ rule: 'TEST', enabled: false, name: 'Paused', reason: 'review' }, f.r);
  assert.deepEqual(f.edits, [{ name: 'Paused', enabled: false, reason: 'review' }]);
});
test('AutoMod keyword edit preserves regex and allow list, [] clears exemptions', async () => {
  const f = setup();
  await editAutomodRule({ rule: 'Test', keywords: ['other'], exemptRoles: [], exemptChannels: [] }, f.r);
  assert.deepEqual(f.edits, [{ exemptRoles: [], exemptChannels: [], triggerMetadata: { keywordFilter: ['other'], regexPatterns: ['sp[a@]m'], allowList: ['spamton'] } }]);
  assert.deepEqual(f.item.triggerMetadata.keywordFilter, ['spam']);
});
test('AutoMod rejects incompatible metadata and empty keyword matchers before mutation', async () => {
  const f = setup();
  for (const patch of [{ mentionLimit: 2 }, { keywords: [], regexPatterns: [] }, { allowList: Array(101).fill('a') }]) {
    await assert.rejects(editAutomodRule({ rule: 'Test', ...patch }, f.r));
  }
  const spam = setup({ triggerType: 3 });
  await assert.rejects(editAutomodRule({ rule: 'Test', keywords: ['x'] }, spam.r));
  assert.equal(f.edits.length + spam.edits.length, 0);
});
test('AutoMod preset and mention edits retain companion metadata', async () => {
  const p = setup({ triggerType: 4, triggerMetadata: { presets: [1,3], allowList: [] } });
  await editAutomodRule({ rule: 'Test', allowList: ['ok'] }, p.r);
  assert.deepEqual(p.edits[0], { triggerMetadata: { presets: [1,3], allowList: ['ok'] } });
  const m = setup({ triggerType: 5, triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true } });
  await editAutomodRule({ rule: 'Test', mentionLimit: 3 }, m.r);
  assert.deepEqual(m.edits[0], { triggerMetadata: { mentionTotalLimit: 3, mentionRaidProtectionEnabled: true } });
});
test('event rename is a partial edit, and status transitions are guarded', async () => {
  const f = setup();
  await editEvent({ event: 'Test', name: 'New name' }, f.r);
  assert.deepEqual(f.edits, [{ name: 'New name' }]);
  await editEvent({ event: 'Test', status: 'active' }, f.r);
  assert.deepEqual(f.edits[1], { status: 2 });
  await assert.rejects(editEvent({ event: 'Test', status: 'completed' }, f.r), /transition/);
  const active = setup({ status: 2 });
  await editEvent({ event: 'Test', status: 'completed' }, active.r);
  await assert.rejects(editEvent({ event: 'Test', status: 'canceled' }, active.r), /transition/);
  const finished = setup({ status: 3 });
  await assert.rejects(editEvent({ event: 'Test', name: 'New' }, finished.r), /cannot be edited/);
});
test('event times are checked against existing values and require timezones', async () => {
  const f = setup();
  await assert.rejects(editEvent({ event: 'Test', endTime: new Date(Date.parse(start) - 1000).toISOString() }, f.r), /after startTime/);
  await assert.rejects(editEvent({ event: 'Test', startTime: new Date(Date.parse(end) + 1000).toISOString() }, f.r), /after startTime/);
  for (const date of ['2027-01-01', '2027-01-01T12:00:00', '01/01/2027']) {
    await assert.rejects(editEvent({ event: 'Test', startTime: date }, f.r));
    await assert.rejects(createEvent({ name: 'Test', channel: 'Voice', startTime: date }, f.r));
  }
  await editEvent({ event: 'Test', startTime: start, endTime: end }, f.r);
  assert.deepEqual(f.edits, [{ scheduledStartTime: new Date(start), scheduledEndTime: new Date(end) }]);
  const voice = setup({ entityType: 2 });
  await assert.rejects(editEvent({ event: 'Test', location: 'Somewhere' }, voice.r), /external/);
});
test('duplicate event/rule names cannot silently edit or delete the first match; IDs win', async () => {
  const f = setup();
  f.items.set('22345678901234567', { ...f.item, id: '22345678901234567', name: 'TEST' });
  for (const [fn, args] of [[editEvent, { event: 'test', name: 'x' }], [deleteEvent, { event: 'test' }], [editAutomodRule, { rule: 'test', enabled: false }], [deleteAutomodRule, { rule: 'test' }]]) {
    await assert.rejects(fn(args, f.r), /Multiple/);
  }
  assert.equal(f.edits.length + f.deletes.length, 0);
  await editEvent({ event: f.item.id, name: 'x' }, f.r);
  assert.equal(f.edits.length, 1);
});
test('empty edits, unknown fields and API failures are surfaced', async () => {
  const never = { findGuild: async () => assert.fail('no API lookup for invalid input') };
  await assert.rejects(editEvent({ event: 'x' }, never));
  await assert.rejects(editAutomodRule({ rule: 'x', enabled: false, trigger: 'spam' }, never));
  const f = setup({ edit: async () => { throw new Error('Missing Permissions'); } });
  await assert.rejects(editEvent({ event: 'Test', name: 'x' }, f.r), /Missing Permissions/);
  await assert.rejects(editAutomodRule({ rule: 'Test', enabled: false }, f.r), /Missing Permissions/);
  assert.deepEqual(lifecycleTools.map(t => t.name), ['edit-automod-rule', 'edit-event']);
});
