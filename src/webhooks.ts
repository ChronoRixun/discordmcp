import { open, unlink, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { WebhookType, type Guild, type Webhook } from 'discord.js';
import { z } from 'zod';
import { json, reason, selectUnique, text, type Resolvers } from './shared.js';

// Discord accepts a service's own payload format when its name is appended to the webhook URL,
// so a /github URL can be pasted straight into a GitHub repository webhook (content type application/json).
const SUFFIX = { discord: '', github: '/github', slack: '/slack' } as const;

export const CreateWebhookSchema = z.object({
  server: z.string().optional(),
  channel: z.string().min(1),
  name: z.string().min(1).max(80),
  avatar: z.string().url().optional(),
  format: z.enum(['discord', 'github', 'slack']).default('discord'),
  urlFile: z.string().min(1).refine(isAbsolute, 'urlFile must be an absolute path').optional(),
  reason,
});
export const ListWebhooksSchema = z.object({ server: z.string().optional(), channel: z.string().min(1).optional() });
export const DeleteWebhookSchema = z.object({
  server: z.string().optional(),
  webhook: z.string().min(1),
  channel: z.string().min(1).optional(),
  reason,
});

/** Never includes the token: a webhook URL lets anyone who holds it post to the channel. */
export function serializeWebhook(hook: Webhook, guild: Pick<Guild, 'channels'>) {
  return {
    id: hook.id,
    name: hook.name,
    channel: guild.channels.cache.get(hook.channelId)?.name ?? null,
    channelId: hook.channelId,
    type: WebhookType[hook.type] ?? hook.type,
    createdBy: hook.owner?.username ?? null,
    application: hook.applicationId ?? null,
    source: hook.sourceGuild ? `${hook.sourceGuild.name} #${hook.sourceChannel?.name ?? '?'}` : null,
    createdAt: hook.createdAt.toISOString(),
  };
}

/**
 * The URL is the webhook's only credential. With urlFile it goes to that file (which must not exist yet)
 * instead of the tool result; the file is claimed before the webhook is created so a bad path costs nothing.
 */
export async function createWebhook(args: unknown, r: Resolvers) {
  const p = CreateWebhookSchema.parse(args);
  const channel = await r.findGuildChannel(p.channel, p.server);
  if (!('createWebhook' in channel)) throw new Error(`#${channel.name} cannot have webhooks; use a text, announcement, forum or voice channel`);
  let file: FileHandle | undefined = p.urlFile ? await open(p.urlFile, 'wx', 0o600) : undefined;
  try {
    const hook = await channel.createWebhook({ name: p.name, avatar: p.avatar, reason: p.reason });
    const url = hook.url + SUFFIX[p.format];
    if (file) await file.writeFile(`${url}\n`);
    return json({ ...serializeWebhook(hook, channel.guild), ...(file ? { urlFile: p.urlFile } : { url }) });
  } catch (error) {
    if (file) {
      await file.close();
      file = undefined;
      await unlink(p.urlFile!);
    }
    throw error;
  } finally {
    await file?.close();
  }
}

export async function listWebhooks(args: unknown, r: Resolvers) {
  const p = ListWebhooksSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const channelId = p.channel ? (await r.findGuildChannel(p.channel, p.server)).id : undefined;
  const hooks = await guild.fetchWebhooks();
  return json(Array.from(hooks.values())
    .filter(hook => !channelId || hook.channelId === channelId)
    .map(hook => serializeWebhook(hook, guild)));
}

/** By ID or exact name; `channel` narrows a name that several channels' webhooks share. */
export async function deleteWebhook(args: unknown, r: Resolvers) {
  const p = DeleteWebhookSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const channelId = p.channel ? (await r.findGuildChannel(p.channel, p.server)).id : undefined;
  const hooks = Array.from((await guild.fetchWebhooks()).values()).filter(hook => !channelId || hook.channelId === channelId);
  const hook = selectUnique(hooks, p.webhook, 'webhook');
  if (!hook) {
    const names = hooks.map(h => `"${h.name}"`).join(', ');
    throw new Error(`Webhook "${p.webhook}" not found in ${guild.name}. Available webhooks: ${names || 'none'}`);
  }
  await hook.delete(p.reason);
  const where = guild.channels.cache.get(hook.channelId)?.name;
  return text(`Webhook "${hook.name}" (${hook.id})${where ? ` in #${where}` : ''} deleted; anything still posting to its URL will now fail.`);
}
