import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/module.js';
import { panel } from '../features/panel.js';
import { parseLength } from './moderation.js';
import { say } from '../theme.js';
import { unix } from '../time.js';

// personal reminders in plain words, and where they and episode alerts land

export const remind: Command = {
  name: 'remind',
  group: 'you',
  data: new SlashCommandBuilder().setName('remind').setDescription('Your reminders, or add one in plain words: in 2h, at 9pm, tomorrow 8am')
    .addStringOption((o) => o.setName('when').setDescription('When: 30, 2h, 1h30m, at 9pm, tomorrow 8am'))
    .addStringOption((o) => o.setName('note').setDescription('What about').setMaxLength(200)).toJSON(),
  text: { aliases: ['r', 'remindme'], args: ['when', 'note'] },
  example: 'me in 2h to drink water',
  run: (ctx, store) => {
    // plain words work: "tz remind me in 2h to drink water", "tz r 30 tea", "tz r at 9pm call mum", "tz r tomorrow 8am gym"
    const words = `${ctx.str('when') ?? ''} ${ctx.str('note') ?? ''}`.trim();
    const when = whenOf(words, store.settings(ctx.userId).timezone);
    if (when && when.note) {
      const at = new Date(Math.min(when.at, Date.now() + 30 * 86_400_000));
      const id = store.addReminder(ctx.userId, 'custom', at, when.note.slice(0, 200), ctx.channelId);
      return ctx.reply({ content: `📝 Promise #${id}: **${when.note.slice(0, 200)}**, <t:${unix(at)}:F> (<t:${unix(at)}:R>). ${say('remindAdd')}`, temp: false });
    }
    if (words && !when) return ctx.reply({ content: 'When? Like `tz remind me in 2h to stretch`, `tz r 30 tea`, `tz r at 9pm call mum` or `tz r tomorrow 8am gym`.', temp: true });
    if (when && !when.note) return ctx.reply({ content: 'Remind you about what? Add a note after the time.', temp: true });
    return ctx.reply(panel(store, ctx.userId, 'list'));
  },
};

// reads a time out of plain words, in the person's own timezone: "in 2h", "30", "1h30m", "at 9pm", "at 21:30", "tomorrow 8am"
export function whenOf(text: string, tz: string): { at: number; note: string } | null {
  let t = text.trim().replace(/^me\s+/i, '');
  const tidy = (rest: string) => rest.trim().replace(/^(to|about|that|for)\s+/i, '').trim();
  // a plain number is minutes
  let m = /^(?:in\s+)?(\d+)(?:\s|$)(.*)$/is.exec(t);
  if (m && !/^\d+\s*(s|sec|m|min|h|hr|d|day|w|week)/i.test(t.replace(/^in\s+/i, ''))) return { at: Date.now() + Number(m[1]) * 60_000, note: tidy(m[2]) };
  m = /^(?:in\s+)?((?:\d+\s*(?:s|secs?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)\s*)+)(.*)$/is.exec(t);
  if (m) { const ms = parseLength(m[1]); if (ms) return { at: Date.now() + ms, note: tidy(m[2]) }; }
  // a clock time, today if it's still ahead, otherwise tomorrow
  const tomorrow = /^tomorrow\s+/i.test(t);
  t = t.replace(/^tomorrow\s+/i, '');
  m = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s|$)(.*)$/is.exec(t);
  if (m && (m[2] || m[3] || tomorrow || /^at\s/i.test(t))) {
    let h = Number(m[1]) % 24;
    const min = Number(m[2] ?? 0);
    if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    if (min > 59) return null;
    // the offset of their timezone right now, to turn their wall clock into a moment
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz || 'UTC' }));
    const offset = local.getTime() - now.getTime();
    const target = new Date(local);
    target.setHours(h, min, 0, 0);
    if (tomorrow || target.getTime() <= local.getTime()) target.setDate(target.getDate() + 1);
    return { at: target.getTime() - offset, note: tidy(m[4]) };
  }
  return null;
}

export const reminderSettings: Command = {
  name: 'reminders',
  group: 'you',
  data: new SlashCommandBuilder().setName('reminders').setDescription('Your reminder control room: what, where and when').toJSON(),
  text: { aliases: ['timers'] },
  run: (ctx, store) => ctx.reply(panel(store, ctx.userId, 'settings')),
};

