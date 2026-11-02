import type { Client, EmbedBuilder } from 'discord.js';
import type { Reminder, Store } from './db.js';
import { todoLines } from './features/daily.js';
import { advise } from './features/huntbot.js';
import type { Huntbot } from './owo/parse.js';
import { RED, card } from './theme.js';
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

function text(store: Store, r: Reminder): EmbedBuilder | null {
  switch (r.kind) {
    case 'huntbot': {
      const hb = store.snapshot<Huntbot>(r.user_id, 'huntbot')?.data;
      const a = hb ? advise(hb) : null;
      return card({
        kind: 'huntbotBack', title: 'Huntbot is home', emoji: '🤖',
        body: '1. `owo hb` to collect\n2. `owo sacrifice common uncommon` for essence\n' +
          (a?.pick ? `3. put it into **${a.pick}**\n` : '') +
          `${a?.pick ? '4' : '3'}. send it out: \`owo autohunt ${hb?.maxRunCost ?? '<cowoncy>'}\``,
      });
    }
    case 'pray':
      return card({ kind: 'prayReady', title: 'Pray and curse are ready', emoji: '🙏', body: '`owo pray` · `owo curse @someone`' });
    case 'hunt':
      return card({ kind: 'huntReady', title: 'Hunt and battle ready', emoji: '🏹' });
    case 'vote':
      return card({ kind: 'voteReady', title: 'Vote is open', emoji: '🗳️', body: `[Vote on top.gg](${VOTE_URL}), then \`owo vote\` to claim.` });
    case 'reset': {
      const todo = todoLines(store, r.user_id);
      return card({ kind: 'newDay', title: 'A new OwO day', emoji: '🌅', body: todo.join('\n') || 'Nothing on the list. Suspicious, but fine.' });
    }
    case 'lastcall': {
      const todo = todoLines(store, r.user_id);
      if (!todo.length) return null;
      return card({ kind: 'lastCall', title: 'Two hours to reset', emoji: '⏳', color: RED, body: todo.join('\n') });
    }
    case 'custom':
      return card({ kind: 'custom', title: 'A promise kept', emoji: '📝', body: `**${r.note}**` });
    default:
      return r.note ? card({ kind: 'custom', title: 'Reminder', emoji: '📝', body: r.note }) : null;
  }
}

async function deliver(client: Client, store: Store, r: Reminder, body: EmbedBuilder) {
  const s = store.settings(r.user_id);
  if (s.delivery === 'dm') {
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
  if (ch?.isSendable()) await ch.send({ content: `<@${r.user_id}>`, embeds: [body], allowedMentions: { users: [r.user_id] } });
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

export async function urgent(client: Client, store: Store, userId: string, channelId: string, body: EmbedBuilder) {
  await deliver(client, store, { id: 0, user_id: userId, kind: 'urgent', note: '', due_at: 0, channel_id: channelId }, body);
}
