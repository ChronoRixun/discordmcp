import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage, sendEmbed, buildEmbed } from '../build/send.js';

function fixture() {
  const sends = [], resolutions = [];
  const channel = {
    name: 'general', guild: { name: 'Community' },
    send: async payload => { sends.push(payload); return { id: '900', url: 'https://discord.com/channels/123/456/900' }; },
  };
  const resolve = async (...args) => { resolutions.push(args); return channel; };
  return { sends, resolutions, resolve, channel };
}

test('send-message forwards the server, posts plain text and reports the link', async () => {
  const f = fixture();
  const result = await sendMessage({ server: 'community', channel: 'general', message: 'Hello' }, f.resolve);
  assert.deepEqual(f.resolutions, [['general', 'community']]);
  assert.deepEqual(f.sends, [{ content: 'Hello' }]);
  assert.match(result.content[0].text, /Message ID: 900\. Link: https:\/\/discord\.com\/channels\/123\/456\/900/);
});

test('replyTo becomes a strict reply on messages and embeds', async () => {
  const f = fixture();
  await sendMessage({ channel: 'general', message: 'Yes', replyTo: '99999999999999999' }, f.resolve);
  await sendEmbed({ channel: 'general', title: 'Card', replyTo: '99999999999999999' }, f.resolve);
  const reply = { messageReference: '99999999999999999', failIfNotExists: true };
  assert.deepEqual(f.sends[0], { content: 'Yes', reply });
  assert.deepEqual(f.sends[1], { embeds: [{ title: 'Card' }], reply });
});

test('send-embed builds only the given properties, parses colour and keeps text above the embed', async () => {
  const f = fixture();
  await sendEmbed({
    channel: 'general', content: 'Server card', title: 'CR', color: '#E8A33D',
    fields: [{ name: 'Connect', value: 'connect 1.2.3.4:27016', inline: false }], footer: 'Community',
    thumbnail: 'https://example.com/t.png',
  }, f.resolve);
  assert.deepEqual(f.sends, [{ content: 'Server card', embeds: [{
    title: 'CR', color: 0xE8A33D,
    fields: [{ name: 'Connect', value: 'connect 1.2.3.4:27016', inline: false }],
    footer: { text: 'Community' }, thumbnail: { url: 'https://example.com/t.png' },
  }] }]);
  assert.deepEqual(buildEmbed({ description: 'Only body' }), { description: 'Only body' });
});

test('invalid payloads fail before resolving a channel', async () => {
  const never = async () => assert.fail('must validate first');
  for (const args of [
    { channel: 'general', message: '' },
    { channel: 'general', message: 'x'.repeat(2001) },
    { channel: 'general', message: 'Hi', replyTo: 'abc' },
  ]) await assert.rejects(sendMessage(args, never));
  for (const args of [
    { channel: 'general' },
    { channel: 'general', content: 'text only' },
    { channel: 'general', title: '' },
    { channel: 'general', color: 'red' },
    { channel: 'general', image: 'not-a-url' },
    { channel: 'general', fields: [{ name: 'a', value: '' }] },
  ]) await assert.rejects(sendEmbed(args, never));
});

test('Discord send failures propagate instead of claiming success', async () => {
  const f = fixture();
  f.channel.send = async () => { throw new Error('Missing Permissions'); };
  await assert.rejects(sendMessage({ channel: 'general', message: 'Hi' }, f.resolve), /Missing Permissions/);
  await assert.rejects(sendEmbed({ channel: 'general', title: 'Hi' }, f.resolve), /Missing Permissions/);
});
