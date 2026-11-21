import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus, PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import type { Store } from '../db.js';
import { schedule, siteLink, type Round, type Session } from '../feeds/f1.js';
import { report } from '../ops.js';

// every session of the coming race weekend as a server event, practice included, so people know when the stream is on.
// They sit in the Watch Party voice room, start themselves when the session does and close when it's over.

const AHEAD = 7 * 86_400_000;
const keyOf = (g: string, season: number, round: number, type: string) => `f1ev:${g}:${season}:${round}:${type}`;
const short = (r: Round) => r.name.replace(/Grand Prix/i, 'GP').trim();

async function syncGuild(guild: Guild, store: Store, season: number, rounds: Round[]) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageEvents)) return;
  const room = store.getKv(`voice:${guild.id}:watch`);
  const now = Date.now();
  for (const r of rounds) {
    for (const s of r.sessions) {
      const start = Date.parse(s.start), end = Date.parse(s.end || s.start) || start + 2 * 3_600_000;
      if (!start || end < now || start - now > AHEAD) continue;
      await syncSession(guild, store, room, season, r, s, start, end).catch((e) => report('f1 events', e));
    }
  }
}

async function syncSession(guild: Guild, store: Store, room: string | null, season: number, r: Round, s: Session, start: number, end: number) {
  const key = keyOf(guild.id, season, r.round, s.type);
  const id = store.getKv(key);
  const ev = id ? await guild.scheduledEvents.fetch(id).catch(() => null) : null;
  const now = Date.now();
  if (ev) {
    // a session that moved gets its time fixed, one that's on gets started, one that's over gets closed
    if (ev.status === GuildScheduledEventStatus.Scheduled && start > now + 60_000 && ev.scheduledStartTimestamp !== start) await ev.edit({ scheduledStartTime: start, ...(room ? {} : { scheduledEndTime: end }) }).catch(() => {});
    if (ev.status === GuildScheduledEventStatus.Scheduled && start <= now) await ev.setStatus(GuildScheduledEventStatus.Active).catch(() => {});
    if (ev.status === GuildScheduledEventStatus.Active && end + 15 * 60_000 <= now) await ev.setStatus(GuildScheduledEventStatus.Completed).catch(() => {});
    return;
  }
  // an event someone deleted by hand stays deleted
  if (id) return;
  if (start <= now + 60_000) return;
  const big = ['R', 'Q', 'S', 'SQ'].includes(s.type);
  const base = {
    name: `${big ? '🏁' : '🏎️'} ${short(r)} · ${s.label}`.slice(0, 100),
    scheduledStartTime: start,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    description: [`Round ${r.round}, ${r.circuit.name}, ${r.circuit.locality}.`, room ? 'Streaming live in the Watch Party room, come watch.' : 'Watch along with the server.', siteLink()].join('\n').slice(0, 1000),
  };
  const made = room
    ? await guild.scheduledEvents.create({ ...base, entityType: GuildScheduledEventEntityType.Voice, channel: room }).catch(() => null)
    : await guild.scheduledEvents.create({ ...base, entityType: GuildScheduledEventEntityType.External, scheduledEndTime: end, entityMetadata: { location: r.circuit.name } }).catch(() => null);
  if (made) store.setKv(key, made.id);
}

// switched off: the upcoming sessions come down, ones already live are left to finish
export async function clearF1Events(guild: Guild, store: Store) {
  for (const { key, value } of store.kvByPrefix(`f1ev:${guild.id}:`)) {
    const ev = value ? await guild.scheduledEvents.fetch(value).catch(() => null) : null;
    if (ev && ev.status !== GuildScheduledEventStatus.Scheduled) continue;
    if (ev) await ev.delete().catch(() => {});
    store.setKv(key, null);
  }
}

export function startF1Events(client: Client, store: Store) {
  const tick = async () => {
    const guilds = [...client.guilds.cache.values()].filter((g) => store.rules(g.id, 'bulletins').enabled && store.guild(g.id).bulletins.f1.on && store.getKv(`f1events:${g.id}`) !== 'off');
    if (!guilds.length) return;
    const s = await schedule().catch(() => null);
    if (!s) return;
    for (const g of guilds) await syncGuild(g, store, s.season, s.rounds);
  };
  setTimeout(() => void tick().catch((e) => report('f1 events', e)), 2 * 60_000);
  setInterval(() => void tick().catch((e) => report('f1 events', e)), 15 * 60_000);
}
