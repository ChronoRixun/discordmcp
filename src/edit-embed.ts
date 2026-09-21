import { EmbedBuilder, type APIEmbed, type TextChannel } from 'discord.js';
import { z } from 'zod';
import { clearable } from './shared.js';

const text = (max: number) => clearable(z.string().min(1).max(max));
export const EditEmbedSchema = z.object({
  server: z.string().optional(),
  channel: z.string(),
  messageId: z.string(),
  embedIndex: z.number().int().min(0).max(9).default(0),
  title: text(256),
  description: text(4096),
  color: clearable(z.string().regex(/^#?[0-9a-fA-F]{6}$/)),
  fields: clearable(z.array(z.object({
    name: z.string().min(1).max(256),
    value: z.string().min(1).max(1024),
    inline: z.boolean().optional(),
  })).max(25)),
  footer: text(2048),
  thumbnail: clearable(z.string().url()),
  image: clearable(z.string().url()),
}).refine(value => ['title', 'description', 'color', 'fields', 'footer', 'thumbnail', 'image']
  .some(key => value[key as keyof typeof value] !== undefined),
  'Provide at least one embed field to update');

type Patch = z.infer<typeof EditEmbedSchema>;

/** Omission preserves a field; null explicitly removes it. */
export function patchEmbed(existing: APIEmbed, patch: Patch): APIEmbed {
  const result = structuredClone(existing);
  for (const key of ['title', 'description', 'fields'] as const) {
    const value = patch[key];
    if (value === null) delete result[key];
    else if (value !== undefined) Object.assign(result, { [key]: value });
  }
  if (patch.color === null) delete result.color;
  else if (patch.color !== undefined) result.color = parseInt(patch.color.replace('#', ''), 16);
  if (patch.footer === null) delete result.footer;
  else if (patch.footer !== undefined) result.footer = { ...result.footer, text: patch.footer };
  for (const key of ['image', 'thumbnail'] as const) {
    if (patch[key] === null) delete result[key];
    else if (patch[key] !== undefined) result[key] = { url: patch[key] };
  }
  // Validate the resulting embed, including combinations created by the merge.
  return new EmbedBuilder(result).toJSON();
}

export async function editEmbed(
  args: unknown,
  findChannel: (channel: string, server?: string) => Promise<TextChannel>,
) {
  const patch = EditEmbedSchema.parse(args);
  const channel = await findChannel(patch.channel, patch.server);
  const message = await channel.messages.fetch({ message: patch.messageId, force: true });
  if (message.author.id !== channel.client.user.id) {
    throw new Error('Only messages sent by this bot can be edited');
  }
  if (patch.embedIndex >= message.embeds.length) {
    throw new Error(`Embed index ${patch.embedIndex} does not exist on this message`);
  }
  const embeds = message.embeds.map(embed => embed.toJSON());
  embeds[patch.embedIndex] = patchEmbed(embeds[patch.embedIndex], patch);
  const totalText = embeds.reduce((total, embed) => total + (embed.title?.length ?? 0)
    + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0)
    + (embed.author?.name.length ?? 0)
    + (embed.fields?.reduce((n, field) => n + field.name.length + field.value.length, 0) ?? 0), 0);
  if (totalText > 6000) throw new Error('Combined embed text exceeds the 6000-character message limit');
  // Omitted message properties (text, attachments, components) stay unchanged.
  await message.edit({ embeds });
  return { content: [{ type: 'text' as const,
    text: `Embed ${patch.embedIndex} on message ${patch.messageId} edited in #${channel.name}.` }] };
}
