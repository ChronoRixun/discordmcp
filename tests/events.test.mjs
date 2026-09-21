import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType } from 'discord.js';
import { createEvent, listEvents, deleteEvent } from '../build/events.js';

const future = new Date(Date.now() + 86_400_000);
const start = future.toISOString();
const end = new Date(future.getTime() + 7_200_000).toISOString();

function fixture(events = [], channel = { id: '45600000000000000', name: 'Lobby', type: ChannelType.GuildVoice }) {
  const created = [];
  const guild = {
    id: '12300000000000000', name: 'Community',
    scheduledEvents: {
      create: async options => { created.push(options); return { id: '888', name: options.name, scheduledStartAt: options.scheduledStartTime, url: 'https://discord.com/events/123/888' }; },
      fetch: async options => { guild.fetchOptions = options; return new Collection(events.map(e => [e.id, e])); },
    },
  };
  const r = { findGuild: async () => guild, findGuildChannel: async () => channel };
  return { created, guild, r };
}

test('external events carry a location, both times and the guild-only privacy level', async () => {
  const f = fixture();
  const result = await createEvent({ name: 'Shipment night', description: 'Dom and HP', startTime: start, endTime: end, location: "CR's server", image: 'https://example.com/cover.png', reason: 'weekly' }, f.r);
  assert.deepEqual(f.created, [{
    name: 'Shipment night', scheduledStartTime: new Date(start), scheduledEndTime: new Date(end), privacyLevel: 2, entityType: 3,
    description: 'Dom and HP', entityMetadata: { location: "CR's server" }, image: 'https://example.com/cover.png', reason: 'weekly',
  }]);
  assert.match(result.content[0].text, /Event "Shipment night" created in Community for .*ID: 888\. Link: https:\/\/discord\.com\/events\/123\/888/);
});

test('voice channel events use the channel id and reject text channels', async () => {
  const f = fixture();
  await createEvent({ name: 'Voice hangout', startTime: start, channel: 'Lobby' }, f.r);
  assert.equal(f.created[0].entityType, 2);
  assert.equal(f.created[0].channel, '45600000000000000');
  assert.equal(f.created[0].scheduledEndTime, undefined);
  const text = fixture([], { id: '1', name: 'general', type: ChannelType.GuildText });
  await assert.rejects(createEvent({ name: 'x', startTime: start, channel: 'general' }, text.r), /not a voice or stage channel/);
});

test('incoherent events fail before any lookup', async () => {
  const never = { findGuild: async () => assert.fail('must validate first') };
  for (const args of [
    { name: 'x', startTime: start },
    { name: 'x', startTime: start, location: 'a', channel: 'b', endTime: end },
    { name: 'x', startTime: start, location: 'a' },
    { name: 'x', startTime: end, endTime: start, location: 'a' },
    { name: 'x', startTime: '2020-01-01T00:00:00Z', endTime: '2020-01-01T01:00:00Z', location: 'a' },
    { name: 'x', startTime: 'next friday', endTime: end, location: 'a' },
  ]) await assert.rejects(createEvent(args, never), undefined, JSON.stringify(args));
});

function event(overrides = {}) {
  const made = {
    id: '888', name: 'Shipment night', description: 'Dom and HP', status: 1,
    scheduledStartAt: new Date(start), scheduledStartTimestamp: Date.parse(start), scheduledEndAt: new Date(end),
    entityMetadata: { location: "CR's server" }, channel: null, userCount: 4, creator: { tag: 'chrono#0001' },
    url: 'https://discord.com/events/123/888',
    ...overrides,
  };
  made.delete = async () => { made.deleted = true; };
  return made;
}

test('list-events asks for user counts and returns events soonest first', async () => {
  const later = event({ id: '889', name: 'Later', scheduledStartTimestamp: Date.parse(start) + 1, status: 2, userCount: null, creator: null, entityMetadata: null, channel: { name: 'Lobby' } });
  const f = fixture([later, event()]);
  const data = JSON.parse((await listEvents({}, f.r)).content[0].text);
  assert.deepEqual(f.guild.fetchOptions, { withUserCount: true });
  assert.deepEqual(data.map(e => e.name), ['Shipment night', 'Later']);
  assert.deepEqual(data[0], { id: '888', name: 'Shipment night', description: 'Dom and HP', status: 'Scheduled', start: start, end: end, location: "CR's server", channel: null, interested: 4, creator: 'chrono#0001', url: 'https://discord.com/events/123/888' });
  assert.equal(data[1].status, 'Active');
  assert.equal(data[1].channel, 'Lobby');
});

test('delete-event matches by name and reports missing events', async () => {
  const target = event();
  const f = fixture([target]);
  await deleteEvent({ event: 'shipment NIGHT' }, f.r);
  assert.equal(target.deleted, true);
  await assert.rejects(deleteEvent({ event: 'nothing' }, f.r), /Events: "Shipment night"/);
});
