import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType } from 'discord.js';
import { getOnboarding, setOnboarding, getWelcomeScreen, setWelcomeScreen, editChannel } from '../build/community.js';

function fixture() {
  const calls = { onboarding: [], welcome: [], edits: [] };
  const roles = new Collection([
    ['r1', { id: 'r1', name: 'MP' }], ['r2', { id: 'r2', name: 'Zombies' }], ['r3', { id: 'r3', name: 'US East' }],
  ]);
  const category = { id: 'cat', name: 'MODERATION', type: ChannelType.GuildCategory };
  const channels = {
    general: { id: 'c1', name: 'general', type: ChannelType.GuildText },
    rules: { id: 'c2', name: 'rules', type: ChannelType.GuildText },
    'moderator-only': { id: 'c3', name: 'moderator-only', type: ChannelType.GuildText },
  };
  const guild = {
    id: 'g', name: 'Community',
    roles: { cache: roles },
    channels: { cache: new Collection([['cat', category], ...Object.values(channels).map(c => [c.id, c])]) },
    fetchOnboarding: async () => onboardingResult(),
    editOnboarding: async data => { calls.onboarding.push(data); return onboardingResult(); },
    fetchWelcomeScreen: async () => welcomeResult(),
    editWelcomeScreen: async data => { calls.welcome.push(data); return welcomeResult(); },
  };
  function onboardingResult() {
    return {
      enabled: true, mode: 0,
      defaultChannels: new Collection([['c1', channels.general]]),
      prompts: new Collection([['p1', {
        id: 'p1', title: 'What do you play?', type: 0, singleSelect: false, required: true, inOnboarding: true,
        options: new Collection([['o1', { id: 'o1', title: 'Multiplayer', description: null, emoji: { name: '🔫' },
          roles: new Collection([['r1', roles.get('r1')]]), channels: new Collection([['c1', channels.general]]) }]]),
      }]]),
    };
  }
  function welcomeResult() {
    return { enabled: true, description: 'Welcome', welcomeChannels: new Collection([['c2', { channelId: 'c2', channel: channels.rules, description: 'Read first', emoji: { name: '📜' } }]]) };
  }
  for (const c of Object.values(channels)) {
    c.guild = guild;
    c.edit = async data => { calls.edits.push([c.name, data]); };
  }
  const r = {
    findGuild: async () => guild,
    findGuildChannel: async name => { const c = channels[name]; if (!c) throw new Error(`Channel "${name}" not found`); return c; },
  };
  return { calls, r, guild };
}

test('get-onboarding serializes prompts, options, roles and channels by name', async () => {
  const f = fixture();
  const data = JSON.parse((await getOnboarding({}, f.r)).content[0].text);
  assert.deepEqual(data, {
    enabled: true, mode: 'default', defaultChannels: ['general'],
    prompts: [{ id: 'p1', title: 'What do you play?', type: 'multiple_choice', singleSelect: false, required: true, inOnboarding: true,
      options: [{ id: 'o1', title: 'Multiplayer', description: null, emoji: '🔫', roles: ['MP'], channels: ['general'] }] }],
  });
});

test('set-onboarding resolves names to ids and maps the enums', async () => {
  const f = fixture();
  await setOnboarding({
    prompts: [{ title: 'Where are you?', type: 'dropdown', singleSelect: true, required: true, options: [
      { title: 'US East', roles: ['us east'] },
      { title: 'Zombies crowd', description: 'Undead', emoji: '🧟', roles: ['Zombies'], channels: ['general'] },
    ] }],
    defaultChannels: ['general', 'rules'], enabled: true, mode: 'advanced', reason: 'setup',
  }, f.r);
  assert.deepEqual(f.calls.onboarding, [{
    prompts: [{ title: 'Where are you?', type: 1, singleSelect: true, required: true, inOnboarding: true, options: [
      { title: 'US East', roles: ['r3'], channels: [] },
      { title: 'Zombies crowd', description: 'Undead', emoji: '🧟', roles: ['r2'], channels: ['c1'] },
    ] }],
    defaultChannels: ['c1', 'c2'], enabled: true, mode: 1, reason: 'setup',
  }]);
});

test('onboarding validation fails before any lookup', async () => {
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const args of [
    {},
    { prompts: [{ title: 'x', options: [] }] },
    { prompts: [{ title: 'x', options: [{ title: 'no target' }] }] },
    { prompts: [{ title: 'x', type: 'radio', options: [{ title: 'a', roles: ['MP'] }] }] },
    { mode: 'expert' },
  ]) await assert.rejects(setOnboarding(args, never), undefined, JSON.stringify(args));
  await assert.rejects(setOnboarding({ prompts: [{ title: 'x', options: [{ title: 'a', roles: ['Nope'] }] }] }, fixture().r), /Role "Nope" not found/);
});

test('welcome screen round-trips and resolves channel names', async () => {
  const f = fixture();
  const data = JSON.parse((await getWelcomeScreen({}, f.r)).content[0].text);
  assert.deepEqual(data, { enabled: true, description: 'Welcome', channels: [{ channel: 'rules', description: 'Read first', emoji: '📜' }] });
  await setWelcomeScreen({ enabled: true, description: 'Start here', channels: [{ channel: 'rules', description: 'The rules', emoji: '📜' }, { channel: 'general', description: 'Chat' }] }, f.r);
  assert.deepEqual(f.calls.welcome, [{ enabled: true, description: 'Start here', welcomeChannels: [{ channel: 'c2', description: 'The rules', emoji: '📜' }, { channel: 'c1', description: 'Chat' }] }]);
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const args of [{}, { description: 'x'.repeat(141) }, { channels: [{ channel: 'a', description: 'x'.repeat(51) }] }]) {
    await assert.rejects(setWelcomeScreen(args, never));
  }
});

test('edit-channel moves under a category, renames and clears a topic', async () => {
  const f = fixture();
  const result = await editChannel({ channel: 'moderator-only', category: 'moderation', topic: null, reason: 'tidy' }, f.r);
  assert.deepEqual(f.calls.edits, [['moderator-only', { topic: null, parent: 'cat', reason: 'tidy' }]]);
  assert.match(result.content[0].text, /topic cleared, moved under MODERATION/);
  await editChannel({ channel: 'general', name: 'chat', slowmodeSeconds: 5, category: null }, f.r);
  assert.deepEqual(f.calls.edits[1], ['general', { name: 'chat', rateLimitPerUser: 5, parent: null }]);
  await assert.rejects(editChannel({ channel: 'general', category: 'Nope' }, f.r), /Category "Nope" not found/);
  await assert.rejects(editChannel({ channel: 'general' }, { findGuildChannel: async () => assert.fail('must validate first') }));
});
