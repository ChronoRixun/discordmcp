import {
  ChannelType, GuildOnboardingMode, GuildOnboardingPromptType,
  type Guild, type GuildOnboarding, type GuildOnboardingEditOptions, type WelcomeScreen,
} from 'discord.js';
import { z } from 'zod';
import { findRole, json, reason, text, type Resolvers } from './shared.js';

const promptTypes = { multiple_choice: GuildOnboardingPromptType.MultipleChoice, dropdown: GuildOnboardingPromptType.Dropdown } as const;
const modes = { default: GuildOnboardingMode.OnboardingDefault, advanced: GuildOnboardingMode.OnboardingAdvanced } as const;
const nameOf = (table: Record<string, number>, value: number) => Object.entries(table).find(([, v]) => v === value)?.[0] ?? String(value);

const OptionSchema = z.object({
  title: z.string().min(1).max(50),
  description: z.string().min(1).max(100).optional(),
  emoji: z.string().min(1).max(64).optional(),
  roles: z.array(z.string().min(1)).max(10).default([]),
  channels: z.array(z.string().min(1)).max(50).default([]),
}).refine(option => option.roles.length + option.channels.length > 0, 'Each option needs at least one role or channel');

const PromptSchema = z.object({
  title: z.string().min(1).max(100),
  type: z.enum(['multiple_choice', 'dropdown']).default('multiple_choice'),
  singleSelect: z.boolean().default(false),
  required: z.boolean().default(false),
  inOnboarding: z.boolean().default(true),
  options: z.array(OptionSchema).min(1).max(50),
});

export const GetOnboardingSchema = z.object({ server: z.string().optional() });
export const SetOnboardingSchema = z.object({
  server: z.string().optional(),
  prompts: z.array(PromptSchema).max(15).optional(),
  defaultChannels: z.array(z.string().min(1)).max(50).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(['default', 'advanced']).optional(),
  reason,
}).refine(value => ['prompts', 'defaultChannels', 'enabled', 'mode'].some(key => value[key as keyof typeof value] !== undefined),
  'Provide prompts, defaultChannels, enabled or mode');

export const GetWelcomeScreenSchema = z.object({ server: z.string().optional() });
export const SetWelcomeScreenSchema = z.object({
  server: z.string().optional(),
  enabled: z.boolean().optional(),
  description: z.string().min(1).max(140).optional(),
  channels: z.array(z.object({
    channel: z.string().min(1),
    description: z.string().min(1).max(50),
    emoji: z.string().min(1).max(64).optional(),
  })).max(5).optional(),
}).refine(value => ['enabled', 'description', 'channels'].some(key => value[key as keyof typeof value] !== undefined),
  'Provide enabled, description or channels');

export const EditChannelSchema = z.object({
  server: z.string().optional(),
  channel: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  topic: z.string().max(1024).nullable().optional(),
  category: z.string().min(1).nullable().optional(),
  slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
  nsfw: z.boolean().optional(),
  reason,
}).refine(value => ['name', 'topic', 'category', 'slowmodeSeconds', 'nsfw'].some(key => value[key as keyof typeof value] !== undefined),
  'Provide at least one channel property to change');

export function serializeOnboarding(onboarding: GuildOnboarding) {
  return {
    enabled: onboarding.enabled,
    mode: nameOf(modes, onboarding.mode),
    defaultChannels: onboarding.defaultChannels.map(channel => channel.name),
    prompts: onboarding.prompts.map(prompt => ({
      id: prompt.id,
      title: prompt.title,
      type: nameOf(promptTypes, prompt.type),
      singleSelect: prompt.singleSelect,
      required: prompt.required,
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map(option => ({
        id: option.id,
        title: option.title,
        description: option.description ?? null,
        emoji: option.emoji?.name ?? null,
        roles: option.roles.map(role => role.name),
        channels: option.channels.map(channel => channel.name),
      })),
    })),
  };
}

export function serializeWelcomeScreen(screen: WelcomeScreen) {
  return {
    enabled: screen.enabled,
    description: screen.description ?? null,
    channels: screen.welcomeChannels.map(entry => ({
      channel: entry.channel?.name ?? entry.channelId,
      description: entry.description,
      emoji: entry.emoji?.name ?? null,
    })),
  };
}

export async function getOnboarding(args: unknown, r: Resolvers) {
  const { server } = GetOnboardingSchema.parse(args);
  const guild = await r.findGuild(server);
  return json(serializeOnboarding(await guild.fetchOnboarding()));
}

/**
 * Replaces the prompt list when `prompts` is given (Discord has no per-prompt patch);
 * omitted properties keep their current value. Names resolve to roles and channels.
 */
export async function setOnboarding(args: unknown, r: Resolvers) {
  const p = SetOnboardingSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const data: GuildOnboardingEditOptions = {};
  if (p.prompts) {
    data.prompts = await Promise.all(p.prompts.map(async prompt => ({
      title: prompt.title,
      type: promptTypes[prompt.type],
      singleSelect: prompt.singleSelect,
      required: prompt.required,
      inOnboarding: prompt.inOnboarding,
      options: await Promise.all(prompt.options.map(async option => ({
        title: option.title,
        ...(option.description && { description: option.description }),
        ...(option.emoji && { emoji: option.emoji }),
        roles: option.roles.map(name => findRole(guild, name).id),
        channels: await Promise.all(option.channels.map(async name => (await r.findGuildChannel(name, p.server)).id)),
      }))),
    })));
  }
  if (p.defaultChannels) {
    data.defaultChannels = await Promise.all(p.defaultChannels.map(async name => (await r.findGuildChannel(name, p.server)).id));
  }
  if (p.enabled !== undefined) data.enabled = p.enabled;
  if (p.mode !== undefined) data.mode = modes[p.mode];
  if (p.reason !== undefined) data.reason = p.reason;
  const result = await guild.editOnboarding(data);
  return json(serializeOnboarding(result));
}

export async function getWelcomeScreen(args: unknown, r: Resolvers) {
  const { server } = GetWelcomeScreenSchema.parse(args);
  const guild = await r.findGuild(server);
  return json(serializeWelcomeScreen(await guild.fetchWelcomeScreen()));
}

export async function setWelcomeScreen(args: unknown, r: Resolvers) {
  const p = SetWelcomeScreenSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const welcomeChannels = p.channels
    ? await Promise.all(p.channels.map(async entry => ({
      channel: (await r.findGuildChannel(entry.channel, p.server)).id,
      description: entry.description,
      ...(entry.emoji && { emoji: entry.emoji }),
    })))
    : undefined;
  const result = await guild.editWelcomeScreen({
    ...(p.enabled !== undefined && { enabled: p.enabled }),
    ...(p.description !== undefined && { description: p.description }),
    ...(welcomeChannels && { welcomeChannels }),
  });
  return json(serializeWelcomeScreen(result));
}

/** Rename, retopic, move under a category (null for none), slowmode or NSFW on any guild channel. */
export async function editChannel(args: unknown, r: Resolvers) {
  const p = EditChannelSchema.parse(args);
  const channel = await r.findGuildChannel(p.channel, p.server);
  if (!('edit' in channel) || channel.type === ChannelType.GuildCategory && p.category !== undefined) {
    throw new Error(`#${channel.name} cannot be edited this way`);
  }
  const guild: Guild = channel.guild;
  const data: Record<string, unknown> = {};
  if (p.name !== undefined) data.name = p.name;
  if (p.topic !== undefined) data.topic = p.topic;
  if (p.slowmodeSeconds !== undefined) data.rateLimitPerUser = p.slowmodeSeconds;
  if (p.nsfw !== undefined) data.nsfw = p.nsfw;
  let categoryName: string | null | undefined;
  if (p.category === null) { data.parent = null; categoryName = null; }
  else if (p.category !== undefined) {
    const wanted = p.category.toLowerCase();
    const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.id === p.category || c.name.toLowerCase() === wanted));
    if (!category) throw new Error(`Category "${p.category}" not found in ${guild.name}`);
    data.parent = category.id;
    categoryName = category.name;
  }
  if (p.reason !== undefined) data.reason = p.reason;
  const before = channel.name;
  await (channel as unknown as { edit: (options: Record<string, unknown>) => Promise<unknown> }).edit(data);
  const changes = [
    p.name !== undefined ? `renamed to #${p.name}` : '',
    p.topic !== undefined ? (p.topic === null ? 'topic cleared' : 'topic set') : '',
    categoryName !== undefined ? (categoryName === null ? 'moved out of its category' : `moved under ${categoryName}`) : '',
    p.slowmodeSeconds !== undefined ? `slowmode ${p.slowmodeSeconds}s` : '',
    p.nsfw !== undefined ? `nsfw ${p.nsfw}` : '',
  ].filter(Boolean).join(', ');
  return text(`#${before} in ${guild.name}: ${changes}.`);
}
