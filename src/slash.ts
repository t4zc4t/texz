import {
  EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction,
} from 'discord.js';
import type { Settings, Store } from './db.js';
import { dayStatus } from './features/daily.js';
import { planGems } from './features/gems.js';
import { advise } from './features/huntbot.js';
import { teamCheck, weaponReport } from './features/weapons.js';
import type { Huntbot, Pet, Weapon } from './owo/parse.js';
import { scheduleDailies } from './reminders.js';
import { fmtLeft, nextReset, owoDay, unix } from './time.js';

const COLOR = 0xe8a23a;

const toggles = ['huntbot', 'pray', 'daily', 'vote', 'minigames', 'huntbattle', 'lastcall'] as const;

export const definitions = [
  new SlashCommandBuilder().setName('status').setDescription('Timers, today\'s list and your huntbot at a glance'),
  new SlashCommandBuilder().setName('huntbot').setDescription('What to upgrade next, from your last owo hb'),
  new SlashCommandBuilder().setName('gems').setDescription('Which gems to use together, from your last owo inv'),
  new SlashCommandBuilder()
    .setName('weapon')
    .setDescription('Damage of a weapon on each pet in your team')
    .addStringOption((o) => o.setName('id').setDescription('Weapon ID, leave empty for the last one you looked at')),
  new SlashCommandBuilder().setName('team').setDescription('Your team stats and weapon fit, from your last owo team'),
  new SlashCommandBuilder().setName('stats').setDescription('Hunts and battles over the last 7 days'),
  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Your own reminders')
    .addSubcommand((s) =>
      s.setName('add').setDescription('Remind me later')
        .addIntegerOption((o) => o.setName('minutes').setDescription('In how many minutes').setRequired(true).setMinValue(1).setMaxValue(10080))
        .addStringOption((o) => o.setName('note').setDescription('What to remind you about').setRequired(true).setMaxLength(200)))
    .addSubcommand((s) => s.setName('list').setDescription('Everything queued for you'))
    .addSubcommand((s) =>
      s.setName('cancel').setDescription('Cancel a reminder')
        .addIntegerOption((o) => o.setName('id').setDescription('ID from /remind list').setRequired(true))),
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('How and when reminders reach you')
    .addSubcommand((s) => s.setName('view').setDescription('Show your settings'))
    .addSubcommand((s) =>
      s.setName('delivery').setDescription('DM or ping in the channel')
        .addStringOption((o) => o.setName('to').setDescription('Where').setRequired(true)
          .addChoices({ name: 'DM', value: 'dm' }, { name: 'Channel', value: 'channel' })))
    .addSubcommand((s) =>
      s.setName('timezone').setDescription('Your timezone, used for quiet hours')
        .addStringOption((o) => o.setName('zone').setDescription('Like Asia/Kolkata').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('quiet').setDescription('No reminders during these hours, they wait until it ends')
        .addStringOption((o) => o.setName('hours').setDescription('Like 00:30-07:30, or "off"').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('toggle').setDescription('Turn a reminder type on or off')
        .addStringOption((o) => o.setName('reminder').setDescription('Which one').setRequired(true)
          .addChoices(...toggles.map((t) => ({ name: t, value: t }))))
        .addBooleanOption((o) => o.setName('on').setDescription('On or off').setRequired(true))),
  new SlashCommandBuilder().setName('help').setDescription('What texz does and how to use it'),
].map((c) => c.toJSON());

const embed = (title: string) => new EmbedBuilder().setColor(COLOR).setTitle(title);
const ago = (at: number) => `<t:${Math.floor(at / 1000)}:R>`;
const missing = (cmd: string) => `I haven't seen your \`${cmd}\` yet. Run it in a channel I can read, then try again.`;

function status(store: Store, userId: string) {
  const e = embed('Status');
  const cds = store.cooldowns(userId);
  const now = Date.now();
  const timer = (what: string, label: string) => {
    const at = cds.get(what);
    if (!at) return `${label}: unknown`;
    return at <= now ? `${label}: **ready**` : `${label}: ${fmtLeft(at - now)} (<t:${Math.floor(at / 1000)}:t>)`;
  };
  e.addFields({
    name: 'Timers',
    value: [timer('huntbot', 'Huntbot'), timer('pray', 'Pray/curse'), timer('vote', 'Vote'),
      `OwO reset: <t:${unix(nextReset())}:R>`].join('\n'),
  });
  const items = dayStatus(store, userId);
  e.addFields({ name: 'Today', value: items.map((i) => `${i.done ? '✅' : '⬜'} ${i.label}`).join('\n') });
  const hb = store.snapshot<Huntbot>(userId, 'huntbot');
  if (hb) {
    const a = advise(hb.data);
    const g = hb.data.traits.gain;
    const ef = hb.data.traits.efficiency;
    const bits = [
      g ? `Gain ${g.level}` : null,
      ef ? `Efficiency ${ef.level}` : null,
      a.pick ? `next: **${a.pick}**` : null,
    ].filter(Boolean);
    e.addFields({ name: 'Huntbot', value: bits.join(' · ') || 'seen' });
  }
  return e;
}

function stats(store: Store, userId: string) {
  const from = owoDay(new Date(Date.now() - 6 * 86_400_000));
  const rows = store.countsSince(userId, from);
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) byDay.set(r.day, { ...(byDay.get(r.day) ?? {}), [r.what]: r.n });
  const e = embed('Last 7 days');
  if (!byDay.size) return e.setDescription('Nothing counted yet, I count hunts and battles as you do them.');
  let th = 0; let tb = 0;
  const lines = [...byDay].map(([day, c]) => {
    th += c.hunt ?? 0; tb += c.battle ?? 0;
    return `\`${day}\` hunts ${c.hunt ?? 0}, battles ${c.battle ?? 0}`;
  });
  lines.push(`**Total** hunts ${th}, battles ${tb}`);
  return e.setDescription(lines.join('\n'));
}

function settingsText(s: Settings) {
  return [
    `Delivery: **${s.delivery}**`,
    `Timezone: **${s.timezone}**`,
    `Quiet hours: **${s.quiet ?? 'off'}**`,
    ...toggles.map((t) => `${s[t] ? '✅' : '⬜'} ${t}`),
  ].join('\n');
}

export async function handle(store: Store, i: ChatInputCommandInteraction) {
  const userId = i.user.id;
  const reply = (content: string | EmbedBuilder) =>
    i.reply(typeof content === 'string'
      ? { content, flags: MessageFlags.Ephemeral }
      : { embeds: [content], flags: MessageFlags.Ephemeral });

  switch (i.commandName) {
    case 'status':
      return reply(status(store, userId));

    case 'huntbot': {
      const hb = store.snapshot<Huntbot>(userId, 'huntbot');
      if (!hb) return reply(missing('owo hb'));
      return reply(embed('Huntbot advice').setDescription(advise(hb.data).lines.join('\n')).setFooter({ text: 'From your owo hb' }).setTimestamp(hb.at));
    }

    case 'gems': {
      const inv = store.snapshot<[number, number][]>(userId, 'inv');
      if (!inv) return reply(missing('owo inv'));
      return reply(embed('Gem plan').setDescription(planGems(new Map(inv.data)).lines.join('\n')).setFooter({ text: 'From your owo inv' }).setTimestamp(inv.at));
    }

    case 'weapon': {
      const team = store.snapshot<Pet[]>(userId, 'team');
      if (!team) return reply(missing('owo team'));
      const all = new Map(store.snapshot<[string, Weapon][]>(userId, 'weapons')?.data ?? []);
      const id = i.options.getString('id')?.toUpperCase() ?? store.snapshot<string>(userId, 'lastweapon')?.data;
      const w = id ? all.get(id) : undefined;
      if (!w) return reply(`I haven't seen that weapon yet. Run \`owo weapon ${id ?? '<id>'}\` first so I can read it.`);
      return reply(embed(`${w.name} ${w.quality ?? ''}%`).setDescription(weaponReport(w, team.data).join('\n'))
        .setFooter({ text: 'Before enemy resistance, total counts every enemy hit' }));
    }

    case 'team': {
      const team = store.snapshot<Pet[]>(userId, 'team');
      if (!team) return reply(missing('owo team'));
      const weapons = new Map(store.snapshot<[string, Weapon][]>(userId, 'weapons')?.data ?? []);
      const lines = team.data.map((p) =>
        `**[${p.slot}] ${p.name}** lvl ${p.level ?? '?'}: HP ${p.hp} · WP ${p.wp} · STR ${p.str} · MAG ${p.mag} · PR ${p.pr}% · MR ${p.mr}%` +
        (p.weaponId ? `\n  holds \`${p.weaponId}\`${weapons.get(p.weaponId) ? ` ${weapons.get(p.weaponId)!.name}` : ''}` : ''));
      const warn = teamCheck(team.data, weapons);
      if (warn.length) lines.push('', ...warn.map((w) => `⚠️ ${w}`));
      const unseen = team.data.filter((p) => p.weaponId && !weapons.has(p.weaponId));
      if (unseen.length) lines.push('', `Run \`owo weapon <id>\` on ${unseen.map((p) => p.weaponId).join(', ')} so I can check those too.`);
      return reply(embed('Team').setDescription(lines.join('\n')).setTimestamp(team.at));
    }

    case 'stats':
      return reply(stats(store, userId));

    case 'remind': {
      const sub = i.options.getSubcommand();
      if (sub === 'add') {
        const mins = i.options.getInteger('minutes', true);
        const note = i.options.getString('note', true);
        const at = new Date(Date.now() + mins * 60_000);
        const id = store.addReminder(userId, 'custom', at, note, i.channelId);
        return reply(`Got it, reminder #${id} <t:${unix(at)}:R>.`);
      }
      if (sub === 'cancel') {
        const ok = store.deleteReminder(i.options.getInteger('id', true), userId);
        return reply(ok ? 'Cancelled.' : 'No reminder with that ID.');
      }
      const list = store.userReminders(userId);
      if (!list.length) return reply('Nothing queued.');
      return reply(embed('Queued').setDescription(list.map((r) =>
        `#${r.id} **${r.kind}**${r.note ? ` ${r.note}` : ''} <t:${Math.floor(r.due_at / 1000)}:R>`).join('\n')));
    }

    case 'settings': {
      const s = store.settings(userId);
      const sub = i.options.getSubcommand();
      if (sub === 'delivery') s.delivery = i.options.getString('to', true) as Settings['delivery'];
      if (sub === 'timezone') {
        const zone = i.options.getString('zone', true);
        try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { return reply('That timezone isn\'t valid, use one like Asia/Kolkata.'); }
        s.timezone = zone;
      }
      if (sub === 'quiet') {
        const h = i.options.getString('hours', true).trim();
        if (h === 'off') s.quiet = null;
        else if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(h)) s.quiet = h;
        else return reply('Use the format 00:30-07:30, or "off".');
      }
      if (sub === 'toggle') {
        const t = i.options.getString('reminder', true) as (typeof toggles)[number];
        s[t] = i.options.getBoolean('on', true);
        // drop anything queued for a type that was just switched off
        if (!s[t]) for (const r of store.userReminders(userId)) {
          if (r.kind === t || (t === 'daily' && r.kind === 'reset') || (t === 'huntbattle' && r.kind === 'hunt')) store.deleteReminder(r.id);
        }
      }
      store.saveSettings(userId, s);
      scheduleDailies(store, userId);
      return reply(embed('Settings').setDescription(settingsText(s)));
    }

    case 'help':
      return reply(embed('texz').setDescription([
        'I watch your OwO commands and remind you when things are ready. I never run anything for you.',
        '',
        '**Reminders**: huntbot back, pray/curse, vote every 12h, the daily reset (1:30 PM IST in winter), and a last call 2h before reset for anything left. Captcha alerts right away.',
        '**Reads as you play**: `owo hb`, `owo inv`, `owo team`, `owo weapon <id>`. Run them once so I have something to work with.',
        '',
        '`/status` timers and today\'s list',
        '`/huntbot` what to upgrade next',
        '`/gems` which gems to use together',
        '`/weapon` damage on each of your pets',
        '`/team` stats and weapon fit',
        '`/stats` hunts and battles this week',
        '`/remind` your own reminders',
        '`/settings` DM or channel, quiet hours, which reminders',
      ].join('\n')));
  }
}
