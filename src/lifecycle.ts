import { AutoModerationRuleTriggerType, GuildScheduledEventEntityType, GuildScheduledEventStatus,
  type AutoModerationRuleEditOptions, type GuildScheduledEventEditOptions } from 'discord.js';
import { z } from 'zod';
import { reason, selectUnique, text, type Resolvers } from './shared.js';

const changed = (value: Record<string, unknown>, ignored: string[]) =>
  Object.entries(value).some(([key, value]) => !ignored.includes(key) && value !== undefined);

export const EditAutomodRuleSchema = z.object({
  server: z.string().optional(), rule: z.string().min(1),
  name: z.string().min(1).max(100).optional(), enabled: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(1000).optional(),
  regexPatterns: z.array(z.string().min(1).max(260)).max(10).optional(),
  allowList: z.array(z.string().min(1).max(60)).max(1000).optional(),
  mentionLimit: z.number().int().min(1).max(50).optional(),
  exemptRoles: z.array(z.string().regex(/^\d{17,20}$/)).max(20).optional(),
  exemptChannels: z.array(z.string().regex(/^\d{17,20}$/)).max(50).optional(), reason,
}).strict().refine(v => changed(v, ['server', 'rule', 'reason']), 'Provide at least one rule property');

/** Patch only supplied properties. Actions and trigger type remain untouched. */
export async function editAutomodRule(args: unknown, r: Resolvers) {
  const p = EditAutomodRuleSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const rules = await guild.autoModerationRules.fetch();
  const rule = selectUnique(rules.values(), p.rule, 'rule');
  if (!rule) throw new Error(`AutoMod rule "${p.rule}" not found`);
  const keyword = rule.triggerType === AutoModerationRuleTriggerType.Keyword;
  const preset = rule.triggerType === AutoModerationRuleTriggerType.KeywordPreset;
  if ((p.keywords !== undefined || p.regexPatterns !== undefined) && !keyword) throw new Error('keywords and regexPatterns require a keyword rule');
  if (p.allowList !== undefined && !keyword && !preset) throw new Error('allowList requires a keyword or keyword_preset rule');
  if (keyword && (p.allowList?.length ?? 0) > 100) throw new Error('Keyword allowList supports at most 100 entries');
  if (p.mentionLimit !== undefined && rule.triggerType !== AutoModerationRuleTriggerType.MentionSpam) throw new Error('mentionLimit requires a mention_spam rule');
  const data: AutoModerationRuleEditOptions = {};
  if (p.name !== undefined) data.name = p.name;
  if (p.enabled !== undefined) data.enabled = p.enabled;
  if (p.reason !== undefined) data.reason = p.reason;
  if (p.exemptRoles !== undefined) data.exemptRoles = p.exemptRoles;
  if (p.exemptChannels !== undefined) data.exemptChannels = p.exemptChannels;
  if ([p.keywords, p.regexPatterns, p.allowList, p.mentionLimit].some(v => v !== undefined)) {
    const meta = rule.triggerMetadata;
    if (keyword) {
      const keywordFilter = p.keywords ?? meta.keywordFilter;
      const regexPatterns = p.regexPatterns ?? meta.regexPatterns;
      if (!keywordFilter.length && !regexPatterns.length) throw new Error('Keyword rules need keywords or regexPatterns');
      data.triggerMetadata = { keywordFilter, regexPatterns, allowList: p.allowList ?? meta.allowList };
    } else if (preset) {
      data.triggerMetadata = { presets: meta.presets, allowList: p.allowList ?? meta.allowList };
    } else {
      data.triggerMetadata = { mentionTotalLimit: p.mentionLimit, mentionRaidProtectionEnabled: meta.mentionRaidProtectionEnabled };
    }
  }
  await rule.edit(data);
  return text(`AutoMod rule ${rule.id} updated in ${guild.name}. Omitted properties preserved.`);
}

const isoDate = z.string().datetime({ offset: true });
export const EditEventSchema = z.object({
  server: z.string().optional(), event: z.string().min(1),
  name: z.string().min(1).max(100).optional(), description: z.string().max(1000).optional(),
  startTime: isoDate.optional(), endTime: isoDate.optional(),
  location: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'completed', 'canceled']).optional(), reason,
}).strict().refine(v => changed(v, ['server', 'event', 'reason']), 'Provide at least one event property');

/** Updates preserve the event ID and RSVPs. Status transitions follow Discord's lifecycle. */
export async function editEvent(args: unknown, r: Resolvers) {
  const p = EditEventSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const events = await guild.scheduledEvents.fetch();
  const event = selectUnique(events.values(), p.event, 'event');
  if (!event) throw new Error(`Event "${p.event}" not found`);
  if (event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) throw new Error('Completed or canceled events cannot be edited');
  const statuses = { active: GuildScheduledEventStatus.Active, completed: GuildScheduledEventStatus.Completed, canceled: GuildScheduledEventStatus.Canceled } as const;
  if (p.status && !((event.status === GuildScheduledEventStatus.Scheduled && ['active', 'canceled'].includes(p.status)) || (event.status === GuildScheduledEventStatus.Active && p.status === 'completed'))) throw new Error('Invalid event status transition');
  if (p.startTime && (event.status !== GuildScheduledEventStatus.Scheduled || Date.parse(p.startTime) <= Date.now())) throw new Error('Only scheduled events can be rescheduled, to a future time');
  if (p.startTime || p.endTime) {
    const start = p.startTime ? Date.parse(p.startTime) : event.scheduledStartTimestamp;
    const end = p.endTime ? Date.parse(p.endTime) : event.scheduledEndTimestamp;
    if (end != null && start != null && end <= start) throw new Error('endTime must be after startTime, including the existing time');
    if (p.endTime && Date.parse(p.endTime) <= Date.now()) throw new Error('endTime must be in the future');
  }
  if (p.location && event.entityType !== GuildScheduledEventEntityType.External) throw new Error('location can only be edited on external events');
  const data: GuildScheduledEventEditOptions<GuildScheduledEventStatus, GuildScheduledEventStatus.Active | GuildScheduledEventStatus.Completed | GuildScheduledEventStatus.Canceled> = {};
  if (p.name !== undefined) data.name = p.name;
  if (p.description !== undefined) data.description = p.description;
  if (p.startTime) data.scheduledStartTime = new Date(p.startTime);
  if (p.endTime) data.scheduledEndTime = new Date(p.endTime);
  if (p.location) data.entityMetadata = { location: p.location };
  if (p.status) data.status = statuses[p.status];
  if (p.reason) data.reason = p.reason;
  await event.edit(data);
  return text(`Event ${event.id} updated in ${guild.name}. Link: ${event.url}`);
}

export const lifecycleTools = [
  { name: 'edit-automod-rule', description: 'Edit or enable/disable an existing AutoMod rule without recreating it. Omitted fields and actions are preserved; exemption arrays replace the list (IDs only, [] clears). Trigger type cannot change.', inputSchema: {
    type: 'object', additionalProperties: false, properties: {
      server: { type: 'string' }, rule: { type: 'string' }, name: { type: 'string' }, enabled: { type: 'boolean' },
      keywords: { type: 'array', items: { type: 'string' } }, regexPatterns: { type: 'array', items: { type: 'string' } },
      allowList: { type: 'array', items: { type: 'string' } }, mentionLimit: { type: 'integer', minimum: 1, maximum: 50 },
      exemptRoles: { type: 'array', items: { type: 'string' } }, exemptChannels: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' },
    }, required: ['rule'],
  } },
  { name: 'edit-event', description: 'Rename or reschedule an event, edit description/location, or start, complete, or cancel it without losing its ID or RSVPs. Dates require Z or an explicit UTC offset. Omitted fields are preserved.', inputSchema: {
    type: 'object', additionalProperties: false, properties: {
      server: { type: 'string' }, event: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
      startTime: { type: 'string', format: 'date-time' }, endTime: { type: 'string', format: 'date-time' }, location: { type: 'string' },
      status: { type: 'string', enum: ['active', 'completed', 'canceled'] }, reason: { type: 'string' },
    }, required: ['event'],
  } },
];
