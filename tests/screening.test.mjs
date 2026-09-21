import test from 'node:test';
import assert from 'node:assert/strict';
import { getRulesScreening, setRulesScreening } from '../build/screening.js';

function fixture({ form = null, gate = false } = {}) {
  const calls = [];
  const stored = form;
  const guild = {
    id: '12300000000000000', name: 'Community', features: gate ? ['COMMUNITY', 'MEMBER_VERIFICATION_GATE_ENABLED'] : ['COMMUNITY'],
    client: { rest: {
      get: async route => { calls.push(['get', route]); if (!stored) { const e = new Error('Unknown Guild Member Verification Form'); e.status = 404; throw e; } return stored; },
      patch: async (route, options) => { calls.push(['patch', route, options]); return { version: '2026-09-21T00:00:00Z', description: options.body.description ?? null, form_fields: options.body.form_fields ?? [] }; },
    } },
  };
  return { calls, r: { findGuild: async () => guild } };
}

test('get-rules-screening reports a never-configured server without throwing', async () => {
  const f = fixture();
  const data = JSON.parse((await getRulesScreening({}, f.r)).content[0].text);
  assert.equal(data.enabled, false);
  assert.deepEqual(data.rules, []);
  assert.match(data.note, /never been set up/);
  assert.deepEqual(f.calls, [['get', '/guilds/12300000000000000/member-verification']]);
});

test('get-rules-screening serializes the terms field and reads the gate from the guild features', async () => {
  const form = { version: 'v', description: 'Welcome', form_fields: [{ field_type: 'TERMS', label: 'Rules', values: ['Be kind', 'No cheating'], required: true }] };
  const off = JSON.parse((await getRulesScreening({}, fixture({ form }).r)).content[0].text);
  assert.deepEqual(off, { enabled: false, description: 'Welcome', label: 'Rules', rules: ['Be kind', 'No cheating'], updated: 'v' });
  const on = JSON.parse((await getRulesScreening({}, fixture({ form, gate: true }).r)).content[0].text);
  assert.equal(on.enabled, true);
});

test('set-rules-screening sends the terms form as an array with enabled and reason', async () => {
  const f = fixture();
  const result = await setRulesScreening({ rules: ['Be kind', 'No cheating'], enabled: true, reason: 'gate' }, f.r);
  const [, route, options] = f.calls[0];
  assert.equal(route, '/guilds/12300000000000000/member-verification');
  assert.equal(options.reason, 'gate');
  assert.equal(options.body.enabled, true);
  assert.deepEqual(options.body.form_fields, [{ field_type: 'TERMS', label: 'Read and agree to the following rules', values: ['Be kind', 'No cheating'], required: true }]);
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(data.rules, ['Be kind', 'No cheating']);
  assert.equal(data.enabled, true);
});

test('set-rules-screening validates before any request and toggles without touching the rules', async () => {
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const args of [{}, { rules: [] }, { rules: Array(17).fill('r') }, { rules: ['x'.repeat(301)] }]) await assert.rejects(setRulesScreening(args, never));
  const f = fixture();
  await setRulesScreening({ enabled: false }, f.r);
  assert.deepEqual(f.calls[0][2].body, { enabled: false });
  const gated = fixture({ gate: true });
  const data = JSON.parse((await setRulesScreening({ rules: ['Be kind'] }, gated.r)).content[0].text);
  assert.equal(data.enabled, true);
});
