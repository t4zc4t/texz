import { isOffline, report } from './ops.js';
import type { Client, EmbedBuilder } from 'discord.js';
import type { Reminder, Store } from './db.js';
import { card, say } from './theme.js';
import { HOUR, afterQuiet } from './time.js';

const episode = (r: Reminder) => {
  const [title, ep, url] = r.note.split('|');
  return { title, ep, url };
};

function text(store: Store, r: Reminder): EmbedBuilder | null {
  if (r.kind.startsWith('ep:')) {
    const e = episode(r);
    return card({ kind: 'episode', title: `${e.title} · episode ${e.ep}`, emoji: '📺', gif: 'off', body: `[Open on AniList](${e.url})` });
  }
  switch (r.kind) {
    case 'custom':
      return card({ kind: 'custom', title: 'A promise kept', emoji: '📝', body: `**${r.note}**` });
    default:
      return r.note ? card({ kind: 'custom', title: 'Reminder', emoji: '📝', body: r.note }) : null;
  }
}

// reminder kind -> the setting that decides where it goes
export const routeOf: Record<string, string> = { custom: 'custom' };

// channel reminders are a short line with a ping, not a whole card
function line(store: Store, r: Reminder): string | null {
  if (r.kind.startsWith('ep:')) {
    const e = episode(r);
    return `📺 ${say('episode')} **${e.title}** episode ${e.ep}`;
  }
  switch (r.kind) {
    case 'custom': return `📝 ${say('customShort')} **${r.note}**`;
    default: return r.note ? `📝 ${r.note}` : null;
  }
}

async function deliver(client: Client, store: Store, r: Reminder, body: EmbedBuilder) {
  const s = store.settings(r.user_id);
  const key = r.kind.startsWith('ep:') ? 'anime' : routeOf[r.kind] ?? '';
  // episode alerts go by DM unless someone asks for a channel, so they never land in a random chat
  const where = key === 'anime' ? s.routes.anime ?? 'dm' : s.routes[key] ?? s.delivery;
  if (where === 'dm' || r.kind === 'urgent') {
    try {
      const user = await client.users.fetch(r.user_id);
      await user.send({ embeds: [body] });
      return;
    } catch {
      // DMs closed, fall back to the channel
    }
  }
  const channelId = r.channel_id ?? store.lastChannel(r.user_id);
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isSendable()) return;
  // new episodes go to the server's screenings channel, where followers get mentioned, never to general
  if (r.kind.startsWith('ep:') && 'guildId' in ch && ch.guildId) {
    const b = store.guild(ch.guildId).bulletins.anime;
    if (b.on && b.channel && store.rules(ch.guildId, 'bulletins').enabled) return;
  }
  const text = r.kind === 'urgent' ? null : line(store, r);
  const sent = text
    ? await ch.send({ content: `<@${r.user_id}> ${text}`.slice(0, 2000), allowedMentions: { users: [r.user_id] } })
    : await ch.send({ content: `<@${r.user_id}>`, embeds: [body], allowedMentions: { users: [r.user_id] } });
  // some people don't want reminders sitting in the channel
  if (s.autodelete > 0) store.deleteLater(sent.channelId, sent.id, Date.now() + s.autodelete * 1000);
}

export function startScheduler(client: Client, store: Store) {
  // the OwO reminders are gone, anything of theirs still queued goes with them
  store.db.prepare("DELETE FROM reminders WHERE kind != 'custom' AND kind NOT LIKE 'ep:%'").run();
  const tick = async () => {
    // no internet, nothing would arrive, the reminders wait for the connection to come back
    if (isOffline() || !client.isReady()) return;
    const now = new Date();
    for (const r of store.dueReminders(now.getTime())) {
      const s = store.settings(r.user_id);
      const later = afterQuiet(now, s.timezone, s.quiet);
      if (later > now) {
        store.db.prepare('UPDATE reminders SET due_at = ? WHERE id = ?').run(later.getTime(), r.id);
        continue;
      }
      if (now.getTime() - r.due_at > 24 * HOUR) { store.deleteReminder(r.id); continue; }
      const body = text(store, r);
      // missed while the PC or the internet was down: still sent, with a note on when it was due
      if (body && now.getTime() - r.due_at > 2 * 60_000) body.setDescription(`${body.data.description ?? ''}\n-# ⏰ late, this was due <t:${Math.floor(r.due_at / 1000)}:R> while I was offline`.slice(0, 4096));
      // only gone from the queue once it's really out, a failed send gets another go next round
      const sent = body ? await deliver(client, store, r, body).then(() => true).catch((e) => { report('send failed', e); return false; }) : true;
      if (!sent && now.getTime() - r.due_at < 24 * HOUR) continue;
      store.deleteReminder(r.id);
    }
  };
  const sweep = async () => {
    for (const d of store.dueDeletes(Date.now())) {
      const ch = await client.channels.fetch(d.channel_id).catch(() => null);
      if (ch?.isTextBased()) await ch.messages.delete(d.message_id).catch(() => {});
    }
  };
  setInterval(() => void tick(), 20_000);
  // deletes run more often so a 10 second auto-clean really is about 10 seconds
  setInterval(() => void sweep(), 5_000);
  void tick();
  void sweep();
}

export async function urgent(client: Client, store: Store, userId: string, channelId: string, body: EmbedBuilder) {
  await deliver(client, store, { id: 0, user_id: userId, kind: 'urgent', note: '', due_at: 0, channel_id: channelId }, body);
}
