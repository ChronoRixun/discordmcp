import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';
import { createWebhook, listWebhooks, deleteWebhook } from '../build/webhooks.js';

function hook(id, name, channelId, extra = {}) {
  const deleted = [];
  return {
    id, name, channelId, type: 1, owner: { username: 'chrono' }, applicationId: null, sourceGuild: null, sourceChannel: null,
    createdAt: new Date('2026-10-03T00:00:00Z'), url: `https://discord.com/api/webhooks/${id}/secret-token`,
    delete: async reason => { deleted.push(reason); }, deleted, ...extra,
  };
}

function fixture({ createFails = false, hooks = [] } = {}) {
  const created = [];
  const github = { id: '45600000000000001', name: 'github' };
  const general = { id: '45600000000000002', name: 'general' };
  const info = { id: '45600000000000003', name: 'INFO' };
  const guild = {
    id: '12300000000000000', name: 'Legends',
    channels: { cache: new Collection([[github.id, github], [general.id, general], [info.id, info]]) },
    fetchWebhooks: async () => new Collection(hooks.map(h => [h.id, h])),
  };
  for (const c of [github, general, info]) c.guild = guild;
  github.createWebhook = async options => {
    created.push(options);
    if (createFails) throw new Error('Maximum number of webhooks reached (15)');
    return hook('70000000000000001', options.name, github.id);
  };
  const byName = { github, general, info };
  const r = {
    findGuild: async () => guild,
    findGuildChannel: async name => { if (!byName[name]) throw new Error(`Channel "${name}" not found`); return byName[name]; },
  };
  return { created, r, github, general };
}

const tempFile = async name => join(await mkdtemp(join(tmpdir(), 'discordmcp-')), name);

test('create-webhook passes name, avatar and reason, and appends the github suffix to the returned URL', async () => {
  const f = fixture();
  const result = await createWebhook({ channel: 'github', name: 'GitHub', avatar: 'https://github.githubassets.com/favicon.png', format: 'github', reason: 'repo feed' }, f.r);
  assert.deepEqual(f.created, [{ name: 'GitHub', avatar: 'https://github.githubassets.com/favicon.png', reason: 'repo feed' }]);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.url, 'https://discord.com/api/webhooks/70000000000000001/secret-token/github');
  assert.deepEqual({ ...data, url: undefined }, {
    id: '70000000000000001', name: 'GitHub', channel: 'github', channelId: f.github.id, type: 'Incoming',
    createdBy: 'chrono', application: null, source: null, createdAt: '2026-10-03T00:00:00.000Z', url: undefined,
  });
});

test('create-webhook with urlFile writes the URL there and keeps it out of the result', async () => {
  const f = fixture();
  const file = await tempFile('hook.txt');
  const result = await createWebhook({ channel: 'github', name: 'GitHub', format: 'github', urlFile: file }, f.r);
  assert.equal(await readFile(file, 'utf8'), 'https://discord.com/api/webhooks/70000000000000001/secret-token/github\n');
  assert.doesNotMatch(result.content[0].text, /secret-token/);
  assert.equal(JSON.parse(result.content[0].text).urlFile, file);
});

test('an existing urlFile is refused before any webhook is created', async () => {
  const f = fixture();
  const file = await tempFile('taken.txt');
  await writeFile(file, 'keep me');
  await assert.rejects(createWebhook({ channel: 'github', name: 'GitHub', urlFile: file }, f.r), /EEXIST/);
  assert.deepEqual(f.created, []);
  assert.equal(await readFile(file, 'utf8'), 'keep me');
});

test('a Discord failure propagates and removes the claimed urlFile', async () => {
  const f = fixture({ createFails: true });
  const file = await tempFile('hook.txt');
  await assert.rejects(createWebhook({ channel: 'github', name: 'GitHub', urlFile: file }, f.r), /Maximum number of webhooks/);
  await assert.rejects(access(file));
});

test('invalid create arguments fail before any lookup, and categories are refused', async () => {
  const never = { findGuildChannel: async () => assert.fail('must validate first') };
  for (const args of [
    { channel: 'github' },
    { channel: 'github', name: '' },
    { channel: 'github', name: 'x'.repeat(81) },
    { channel: 'github', name: 'GitHub', format: 'gitlab' },
    { channel: 'github', name: 'GitHub', avatar: 'not a url' },
    { channel: 'github', name: 'GitHub', urlFile: 'relative/hook.txt' },
  ]) await assert.rejects(createWebhook(args, never));
  await assert.rejects(createWebhook({ channel: 'info', name: 'GitHub' }, fixture().r), /cannot have webhooks/);
});

test('list-webhooks serializes every type without URLs and filters by channel', async () => {
  const hooks = [
    hook('70000000000000001', 'GitHub', '45600000000000001'),
    hook('70000000000000002', 'News', '45600000000000002', { type: 2, owner: null, sourceGuild: { name: 'Upstream' }, sourceChannel: { name: 'releases' } }),
    hook('70000000000000003', 'Bot hook', '45600000000000002', { type: 3, applicationId: '80000000000000000' }),
  ];
  const all = await listWebhooks({}, fixture({ hooks }).r);
  assert.doesNotMatch(all.content[0].text, /secret-token|webhooks\//);
  const data = JSON.parse(all.content[0].text);
  assert.deepEqual(data.map(h => h.type), ['Incoming', 'ChannelFollower', 'Application']);
  assert.equal(data[1].source, 'Upstream #releases');
  assert.equal(data[1].createdBy, null);
  assert.equal(data[2].application, '80000000000000000');
  const general = JSON.parse((await listWebhooks({ channel: 'general' }, fixture({ hooks }).r)).content[0].text);
  assert.deepEqual(general.map(h => h.name), ['News', 'Bot hook']);
});

test('delete-webhook selects by ID or unique name, and channel narrows a shared name', async () => {
  const hooks = [hook('70000000000000001', 'GitHub', '45600000000000001'), hook('70000000000000002', 'GitHub', '45600000000000002')];
  const f = fixture({ hooks });
  await assert.rejects(deleteWebhook({ webhook: 'github' }, f.r), /Multiple webhooks named "github"/);
  const result = await deleteWebhook({ webhook: 'GitHub', channel: 'general', reason: 'moved' }, f.r);
  assert.deepEqual(hooks[1].deleted, ['moved']);
  assert.deepEqual(hooks[0].deleted, []);
  assert.match(result.content[0].text, /"GitHub" \(70000000000000002\) in #general deleted/);
  await deleteWebhook({ webhook: '70000000000000001' }, f.r);
  assert.deepEqual(hooks[0].deleted, [undefined]);
  await assert.rejects(deleteWebhook({ webhook: 'Jenkins' }, f.r), /not found in Legends\. Available webhooks: "GitHub", "GitHub"/);
  await assert.rejects(deleteWebhook({}, f.r));
});
