import {
  AutoModerationActionType, AutoModerationRuleEventType, AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType, type AutoModerationActionOptions, type AutoModerationRule, type Guild,
} from 'discord.js';
import { z } from 'zod';
import { findRole, json, reason, text, type Resolvers } from './shared.js';

const triggerTypes = {
  keyword: AutoModerationRuleTriggerType.Keyword,
  keyword_preset: AutoModerationRuleTriggerType.KeywordPreset,
  spam: AutoModerationRuleTriggerType.Spam,
  mention_spam: AutoModerationRuleTriggerType.MentionSpam,
} as const;
const presetTypes = {
  profanity: AutoModerationRuleKeywordPresetType.Profanity,
  sexual_content: AutoModerationRuleKeywordPresetType.SexualContent,
  slurs: AutoModerationRuleKeywordPresetType.Slurs,
} as const;
const nameOf = (table: Record<string, number>, value: number) =>
  Object.entries(table).find(([, v]) => v === value)?.[0] ?? String(value);

export const CreateAutomodRuleSchema = z.object({
  server: z.string().optional(),
  name: z.string().min(1).max(100),
  trigger: z.enum(['keyword', 'keyword_preset', 'spam', 'mention_spam']),
  keywords: z.array(z.string().min(1).max(60)).max(1000).optional(),
  regexPatterns: z.array(z.string().min(1).max(260)).max(10).optional(),
  allowList: z.array(z.string().min(1).max(60)).max(100).optional(),
  presets: z.array(z.enum(['profanity', 'sexual_content', 'slurs'])).min(1).optional(),
  mentionLimit: z.number().int().min(1).max(50).optional(),
  blockMessage: z.boolean().default(true),
  customMessage: z.string().min(1).max(150).optional(),
  alertChannel: z.string().min(1).optional(),
  timeoutMinutes: z.number().int().min(1).max(40320).optional(),
  exemptRoles: z.array(z.string().min(1)).max(20).optional(),
  exemptChannels: z.array(z.string().min(1)).max(50).optional(),
  enabled: z.boolean().default(true),
  reason,
}).superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.trigger === 'keyword' && !(value.keywords?.length || value.regexPatterns?.length)) issue('keyword rules need keywords or regexPatterns');
  if (value.trigger === 'keyword_preset' && !value.presets?.length) issue('keyword_preset rules need presets');
  if (value.trigger === 'mention_spam' && value.mentionLimit === undefined) issue('mention_spam rules need mentionLimit');
  if (value.timeoutMinutes !== undefined && value.trigger !== 'keyword' && value.trigger !== 'mention_spam') issue('timeouts are only allowed on keyword and mention_spam rules');
  if (!value.blockMessage && !value.alertChannel && value.timeoutMinutes === undefined) issue('the rule needs at least one action: blockMessage, alertChannel or timeoutMinutes');
});

export const ListAutomodRulesSchema = z.object({ server: z.string().optional() });
export const DeleteAutomodRuleSchema = z.object({ server: z.string().optional(), rule: z.string().min(1), reason });

export function serializeRule(rule: AutoModerationRule, guild: Guild) {
  const meta = rule.triggerMetadata;
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    trigger: nameOf(triggerTypes, rule.triggerType),
    keywords: meta.keywordFilter,
    regexPatterns: meta.regexPatterns,
    allowList: meta.allowList,
    presets: meta.presets.map(p => nameOf(presetTypes, p)),
    mentionLimit: meta.mentionTotalLimit ?? null,
    actions: rule.actions.map(action => ({
      type: nameOf({ block_message: AutoModerationActionType.BlockMessage, send_alert: AutoModerationActionType.SendAlertMessage, timeout: AutoModerationActionType.Timeout }, action.type),
      channel: action.metadata.channelId ? guild.channels.cache.get(action.metadata.channelId)?.name ?? action.metadata.channelId : null,
      durationSeconds: action.metadata.durationSeconds ?? null,
      customMessage: action.metadata.customMessage ?? null,
    })),
    exemptRoles: rule.exemptRoles.map(role => role.name),
    exemptChannels: rule.exemptChannels.map(channel => channel.name),
  };
}

export async function createAutomodRule(args: unknown, r: Resolvers) {
  const p = CreateAutomodRuleSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const actions: AutoModerationActionOptions[] = [];
  if (p.blockMessage) {
    actions.push({ type: AutoModerationActionType.BlockMessage, ...(p.customMessage && { metadata: { customMessage: p.customMessage } }) });
  }
  if (p.alertChannel) {
    const channel = await r.findChannel(p.alertChannel, p.server);
    actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel } });
  }
  if (p.timeoutMinutes !== undefined) {
    actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: p.timeoutMinutes * 60 } });
  }
  const triggerMetadata = p.trigger === 'keyword' ? { keywordFilter: p.keywords ?? [], regexPatterns: p.regexPatterns ?? [], allowList: p.allowList ?? [] }
    : p.trigger === 'keyword_preset' ? { presets: p.presets!.map(name => presetTypes[name]), allowList: p.allowList ?? [] }
    : p.trigger === 'mention_spam' ? { mentionTotalLimit: p.mentionLimit! }
    : {};
  const exemptRoles = p.exemptRoles?.map(name => findRole(guild, name));
  const exemptChannels = p.exemptChannels ? await Promise.all(p.exemptChannels.map(name => r.findGuildChannel(name, p.server))) : undefined;
  const rule = await guild.autoModerationRules.create({
    name: p.name,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: triggerTypes[p.trigger],
    triggerMetadata,
    actions,
    enabled: p.enabled,
    ...(exemptRoles && { exemptRoles }),
    ...(exemptChannels && { exemptChannels }),
    ...(p.reason !== undefined && { reason: p.reason }),
  });
  return text(`AutoMod rule "${rule.name}" (${p.trigger}) created in ${guild.name}${p.enabled ? '' : ', disabled'}. ID: ${rule.id}`);
}

export async function listAutomodRules(args: unknown, r: Resolvers) {
  const { server } = ListAutomodRulesSchema.parse(args);
  const guild = await r.findGuild(server);
  const rules = await guild.autoModerationRules.fetch();
  return json(Array.from(rules.values(), rule => serializeRule(rule, guild)));
}

export async function deleteAutomodRule(args: unknown, r: Resolvers) {
  const { server, rule: identifier, reason: why } = DeleteAutomodRuleSchema.parse(args);
  const guild = await r.findGuild(server);
  const rules = await guild.autoModerationRules.fetch();
  const wanted = identifier.toLowerCase();
  const rule = rules.find(candidate => candidate.id === identifier || candidate.name.toLowerCase() === wanted);
  if (!rule) throw new Error(`AutoMod rule "${identifier}" not found in ${guild.name}. Rules: ${rules.map(x => `"${x.name}"`).join(', ') || 'none'}`);
  const name = rule.name;
  await rule.delete(why);
  return text(`AutoMod rule "${name}" deleted from ${guild.name}.`);
}
