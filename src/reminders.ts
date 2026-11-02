import type { Client } from 'discord.js';
import type { Reminder, Store } from './db.js';
import { todoLines } from './features/daily.js';
import { advise } from './features/huntbot.js';
import type { Huntbot } from './owo/parse.js';
import { HOUR, afterQuiet, nextReset } from './time.js';

const VOTE_URL = 'https://top.gg/bot/408785106942164992/vote';

// keeps the two daily check-ins queued for a user, safe to call often
export function scheduleDailies(store: Store, userId: string, now = new Date()) {
  const s = store.settings(userId);
  const reset = nextReset(now);
  if (s.daily && !store.reminderOf(userId, 'reset')) {
    store.setReminder(userId, 'reset', new Date(reset.getTime() + 5 * 60_000));
  }
  if (s.lastcall && !store.reminderOf(userId, 'lastcall')) {
    const at = new Date(reset.getTime() - 2 * HOUR);
    store.setReminder(userId, 'lastcall', at > now ? at : new Date(reset.getTime() + 22 * HOUR));
  }
}

function text(store: Store, r: Reminder): string | null {
  switch (r.kind) {
    case 'huntbot': {
      const hb = store.snapshot<Huntbot>(r.user_id, 'huntbot')?.data;
      const lines = ['Your huntbot is back. Collect it with `owo hb`, then sacrifice the spare animals and send it out again.'];
      if (hb) {
        const a = advise(hb);
        if (a.pick) lines.push(`Next upgrade: **${a.pick}**.`);
        if (hb.maxRunCost) lines.push(`Restart: \`owo autohunt ${hb.maxRunCost}\``);
      }
      return lines.join('\n');
    }
    case 'pray':
      return 'Pray and curse are ready again: `owo pray` / `owo curse @user`';
    case 'hunt':
      return 'Hunt and battle are off cooldown.';
    case 'vote':
      return `You can vote again: ${VOTE_URL} then \`owo vote\` to claim.`;
    case 'reset': {
      const todo = todoLines(store, r.user_id);
      return ['New OwO day just started. Today\'s list:', ...todo].join('\n');
    }
    case 'lastcall': {
      const todo = todoLines(store, r.user_id);
      if (!todo.length) return null;
      return ['OwO resets in 2 hours and these are still open:', ...todo].join('\n');
    }
    case 'custom':
      return `Reminder: ${r.note}`;
    default:
      return r.note || null;
  }
}

async function deliver(client: Client, store: Store, r: Reminder, body: string) {
  const s = store.settings(r.user_id);
  if (s.delivery === 'dm') {
    try {
      const user = await client.users.fetch(r.user_id);
      await user.send(body);
      return;
    } catch {
      // DMs closed, fall back to the channel
    }
  }
  const channelId = r.channel_id ?? store.lastChannel(r.user_id);
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (ch?.isSendable()) await ch.send({ content: `<@${r.user_id}> ${body}`, allowedMentions: { users: [r.user_id] } });
}

export function startScheduler(client: Client, store: Store) {
  const tick = async () => {
    const now = new Date();
    for (const r of store.dueReminders(now.getTime())) {
      const s = store.settings(r.user_id);
      const later = afterQuiet(now, s.timezone, s.quiet);
      if (later > now) {
        store.db.prepare('UPDATE reminders SET due_at = ? WHERE id = ?').run(later.getTime(), r.id);
        continue;
      }
      store.deleteReminder(r.id);
      const body = text(store, r);
      if (body) await deliver(client, store, r, body).catch((e) => console.error('send failed', e));
      if (r.kind === 'reset' || r.kind === 'lastcall') scheduleDailies(store, r.user_id, new Date(now.getTime() + 60_000));
    }
  };
  setInterval(() => void tick(), 20_000);
  void tick();
}

export async function urgent(client: Client, store: Store, userId: string, channelId: string, body: string) {
  await deliver(client, store, { id: 0, user_id: userId, kind: 'urgent', note: '', due_at: 0, channel_id: channelId }, body);
}
