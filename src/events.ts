import {
  ChannelType, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus,
  type GuildScheduledEvent,
} from 'discord.js';
import { z } from 'zod';
import { json, reason, selectUnique, text, type Resolvers } from './shared.js';

const isoDate = z.string().datetime({ offset: true });

export const CreateEventSchema = z.object({
  server: z.string().optional(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000).optional(),
  startTime: isoDate,
  endTime: isoDate.optional(),
  location: z.string().min(1).max(100).optional(),
  channel: z.string().min(1).optional(),
  image: z.string().url().optional(),
  reason,
})
  .refine(value => (value.location ? 1 : 0) + (value.channel ? 1 : 0) === 1,
    'Provide exactly one of location (an external event) or channel (a voice or stage channel event)')
  .refine(value => !value.location || value.endTime, 'External events need an endTime')
  .refine(value => !value.endTime || Date.parse(value.endTime) > Date.parse(value.startTime), 'endTime must be after startTime')
  .refine(value => Date.parse(value.startTime) > Date.now(), 'startTime must be in the future');

export const ListEventsSchema = z.object({ server: z.string().optional() });
export const DeleteEventSchema = z.object({ server: z.string().optional(), event: z.string().min(1) });

export function serializeEvent(event: GuildScheduledEvent) {
  return {
    id: event.id,
    name: event.name,
    description: event.description ?? null,
    status: GuildScheduledEventStatus[event.status],
    start: event.scheduledStartAt?.toISOString() ?? null,
    end: event.scheduledEndAt?.toISOString() ?? null,
    location: event.entityMetadata?.location ?? null,
    channel: event.channel?.name ?? null,
    interested: event.userCount ?? null,
    creator: event.creator?.tag ?? null,
    url: event.url,
  };
}

export async function createEvent(args: unknown, r: Resolvers) {
  const p = CreateEventSchema.parse(args);
  const guild = await r.findGuild(p.server);
  let entityType = GuildScheduledEventEntityType.External;
  let channel: string | undefined;
  if (p.channel) {
    const found = await r.findGuildChannel(p.channel, p.server);
    if (found.type !== ChannelType.GuildVoice && found.type !== ChannelType.GuildStageVoice) {
      throw new Error(`#${found.name} is not a voice or stage channel; use location for an event held elsewhere`);
    }
    entityType = found.type === ChannelType.GuildStageVoice ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice;
    channel = found.id;
  }
  const event = await guild.scheduledEvents.create({
    name: p.name,
    scheduledStartTime: new Date(p.startTime),
    ...(p.endTime && { scheduledEndTime: new Date(p.endTime) }),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType,
    ...(p.description && { description: p.description }),
    ...(channel && { channel }),
    ...(p.location && { entityMetadata: { location: p.location } }),
    ...(p.image && { image: p.image }),
    ...(p.reason !== undefined && { reason: p.reason }),
  });
  return text(`Event "${event.name}" created in ${guild.name} for ${event.scheduledStartAt?.toISOString()}. ID: ${event.id}. Link: ${event.url}`);
}

/** Upcoming and active events with interested counts. */
export async function listEvents(args: unknown, r: Resolvers) {
  const { server } = ListEventsSchema.parse(args);
  const guild = await r.findGuild(server);
  const events = await guild.scheduledEvents.fetch({ withUserCount: true });
  return json(Array.from(events.values())
    .sort((a, b) => (a.scheduledStartTimestamp ?? 0) - (b.scheduledStartTimestamp ?? 0))
    .map(serializeEvent));
}

export async function deleteEvent(args: unknown, r: Resolvers) {
  const { server, event: identifier } = DeleteEventSchema.parse(args);
  const guild = await r.findGuild(server);
  const events = await guild.scheduledEvents.fetch();
  const event = selectUnique(events.values(), identifier, "event");
  if (!event) throw new Error(`Event "${identifier}" not found in ${guild.name}. Events: ${events.map(x => `"${x.name}"`).join(', ') || 'none'}`);
  const name = event.name;
  await event.delete();
  return text(`Event "${name}" deleted from ${guild.name}.`);
}
