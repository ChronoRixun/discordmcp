import { Routes } from 'discord.js';
import { z } from 'zod';
import { json, reason, type Resolvers } from './shared.js';

// Rules Screening ("membership screening"): the rules a new member must accept
// before they can talk. Discord exposes it at /guilds/{id}/member-verification;
// discord.js has no wrapper, so this calls the REST route directly.

export const GetRulesScreeningSchema = z.object({ server: z.string().optional() });
export const SetRulesScreeningSchema = z.object({
  server: z.string().optional(),
  rules: z.array(z.string().min(1).max(300)).min(1).max(16).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(300).nullable().optional(),
  reason,
}).refine(value => value.rules !== undefined || value.enabled !== undefined || value.description !== undefined,
  'Provide rules, enabled or description');

interface ScreeningField { field_type: string; label: string; values?: string[]; required: boolean }
interface ScreeningForm { version?: string; form_fields?: ScreeningField[]; description?: string | null }

export function serializeScreening(form: ScreeningForm, enabled: boolean | null) {
  const terms = form.form_fields?.find(field => field.field_type === 'TERMS');
  return {
    enabled,
    description: form.description ?? null,
    label: terms?.label ?? null,
    rules: terms?.values ?? [],
    updated: form.version ?? null,
  };
}

/** Rules Screening is only readable once it has been set up; before that Discord answers 404. */
export async function getRulesScreening(args: unknown, r: Resolvers) {
  const { server } = GetRulesScreeningSchema.parse(args);
  const guild = await r.findGuild(server);
  try {
    const form = await guild.client.rest.get(Routes.guildMemberVerification(guild.id)) as ScreeningForm;
    return json(serializeScreening(form, null));
  } catch (error) {
    if ((error as { status?: number }).status === 404) return json({ enabled: false, description: null, label: null, rules: [], updated: null, note: 'Rules Screening has never been set up on this server' });
    throw error;
  }
}

/** `rules` replaces the whole list; omitted properties keep their current value where Discord allows it. */
export async function setRulesScreening(args: unknown, r: Resolvers) {
  const p = SetRulesScreeningSchema.parse(args);
  const guild = await r.findGuild(p.server);
  const body: Record<string, unknown> = {};
  if (p.enabled !== undefined) body.enabled = p.enabled;
  if (p.description !== undefined) body.description = p.description;
  if (p.rules !== undefined) {
    // Discord rejects the JSON-string form the API types describe; it wants a real array.
    body.form_fields = [{ field_type: 'TERMS', label: 'Read and agree to the following rules', values: p.rules, required: true }];
  }
  const form = await guild.client.rest.patch(Routes.guildMemberVerification(guild.id), {
    body, ...(p.reason !== undefined && { reason: p.reason }),
  }) as ScreeningForm;
  return json(serializeScreening(form, p.enabled ?? null));
}
