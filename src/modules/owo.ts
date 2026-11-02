import { SlashCommandBuilder } from 'discord.js';
import type { Settings, Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { dayStatus } from '../features/daily.js';
import { planGems } from '../features/gems.js';
import { advise } from '../features/huntbot.js';
import { teamCheck, weaponReport } from '../features/weapons.js';
import type { Huntbot, Pet, Weapon } from '../owo/parse.js';
import { scheduleDailies } from '../reminders.js';
import { embed } from '../theme.js';
import { fmtLeft, nextReset, owoDay, unix } from '../time.js';

const toggles = ['huntbot', 'pray', 'daily', 'vote', 'minigames', 'huntbattle', 'lastcall'] as const;

const missing = (cmd: string) => `I haven't seen your \`${cmd}\` yet. Run it somewhere I can read, then ask again.`;

function statusEmbed(store: Store, userId: string) {
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
    const bits = [g ? `Gain ${g.level}` : null, ef ? `Efficiency ${ef.level}` : null, a.pick ? `next: **${a.pick}**` : null].filter(Boolean);
    e.addFields({ name: 'Huntbot', value: bits.join(' · ') || 'seen' });
  }
  return e;
}

function settingsText(s: Settings) {
  return [
    `Delivery: **${s.delivery}**`,
    `Timezone: **${s.timezone}**`,
    `Quiet hours: **${s.quiet ?? 'off'}**`,
    ...toggles.map((t) => `${s[t] ? '✅' : '⬜'} ${t}`),
  ].join('\n');
}

const commands: Command[] = [
  {
    name: 'status',
    data: new SlashCommandBuilder().setName('status').setDescription('Timers, today\'s list and your huntbot at a glance').toJSON(),
    text: { aliases: ['s', 'st'] },
    run: (ctx, store) => ctx.reply(statusEmbed(store, ctx.userId)),
  },
  {
    name: 'huntbot',
    data: new SlashCommandBuilder().setName('huntbot').setDescription('What to upgrade next, from your last owo hb').toJSON(),
    text: { aliases: ['hb'] },
    run: (ctx, store) => {
      const hb = store.snapshot<Huntbot>(ctx.userId, 'huntbot');
      if (!hb) return ctx.reply(missing('owo hb'));
      return ctx.reply(embed('Huntbot advice').setDescription(advise(hb.data).lines.join('\n')).setFooter({ text: 'From your owo hb' }).setTimestamp(hb.at));
    },
  },
  {
    name: 'gems',
    data: new SlashCommandBuilder().setName('gems').setDescription('Which gems to use together, from your last owo inv').toJSON(),
    text: { aliases: ['g'] },
    run: (ctx, store) => {
      const inv = store.snapshot<[number, number][]>(ctx.userId, 'inv');
      if (!inv) return ctx.reply(missing('owo inv'));
      return ctx.reply(embed('Gem plan').setDescription(planGems(new Map(inv.data)).lines.join('\n')).setFooter({ text: 'From your owo inv' }).setTimestamp(inv.at));
    },
  },
  {
    name: 'weapon',
    data: new SlashCommandBuilder().setName('weapon').setDescription('Damage of a weapon on each pet in your team')
      .addStringOption((o) => o.setName('id').setDescription('Weapon ID, leave empty for the last one you looked at')).toJSON(),
    text: { aliases: ['w', 'wep'], args: ['id'] },
    run: (ctx, store) => {
      const team = store.snapshot<Pet[]>(ctx.userId, 'team');
      if (!team) return ctx.reply(missing('owo team'));
      const all = new Map(store.snapshot<[string, Weapon][]>(ctx.userId, 'weapons')?.data ?? []);
      const id = ctx.str('id')?.toUpperCase() ?? store.snapshot<string>(ctx.userId, 'lastweapon')?.data;
      const w = id ? all.get(id) : undefined;
      if (!w) return ctx.reply(`I haven't seen that weapon yet. Run \`owo weapon ${id ?? '<id>'}\` first so I can read it.`);
      return ctx.reply(embed(`${w.name} ${w.quality ?? ''}%`).setDescription(weaponReport(w, team.data).join('\n'))
        .setFooter({ text: 'Before enemy resistance, total counts every enemy hit' }));
    },
  },
  {
    name: 'team',
    data: new SlashCommandBuilder().setName('team').setDescription('Your team stats and weapon fit, from your last owo team').toJSON(),
    text: { aliases: ['t'] },
    run: (ctx, store) => {
      const team = store.snapshot<Pet[]>(ctx.userId, 'team');
      if (!team) return ctx.reply(missing('owo team'));
      const weapons = new Map(store.snapshot<[string, Weapon][]>(ctx.userId, 'weapons')?.data ?? []);
      const lines = team.data.map((p) => {
        const w = p.weaponId ? weapons.get(p.weaponId) : undefined;
        return `**[${p.slot}] ${p.name}** lvl ${p.level ?? '?'}: HP ${p.hp} · WP ${p.wp} · STR ${p.str} · MAG ${p.mag} · PR ${p.pr}% · MR ${p.mr}%` +
          (p.weaponId ? `\nholds \`${p.weaponId}\`${w ? ` ${w.name}` : ''}` : '');
      });
      const warn = teamCheck(team.data, weapons);
      if (warn.length) lines.push('', ...warn.map((w) => `⚠️ ${w}`));
      const unseen = team.data.filter((p) => p.weaponId && !weapons.has(p.weaponId));
      if (unseen.length) lines.push('', `Run \`owo weapon <id>\` on ${unseen.map((p) => p.weaponId).join(', ')} so I can check those too.`);
      return ctx.reply(embed('Team').setDescription(lines.join('\n')).setTimestamp(team.at));
    },
  },
  {
    name: 'stats',
    data: new SlashCommandBuilder().setName('stats').setDescription('Hunts and battles over the last 7 days').toJSON(),
    run: (ctx, store) => {
      const from = owoDay(new Date(Date.now() - 6 * 86_400_000));
      const byDay = new Map<string, Record<string, number>>();
      for (const r of store.countsSince(ctx.userId, from)) byDay.set(r.day, { ...(byDay.get(r.day) ?? {}), [r.what]: r.n });
      const e = embed('Last 7 days');
      if (!byDay.size) return ctx.reply(e.setDescription('Nothing counted yet, I count hunts and battles as you do them.'));
      let th = 0; let tb = 0;
      const lines = [...byDay].map(([day, c]) => {
        th += c.hunt ?? 0; tb += c.battle ?? 0;
        return `\`${day}\` hunts ${c.hunt ?? 0}, battles ${c.battle ?? 0}`;
      });
      lines.push(`**Total** hunts ${th}, battles ${tb}`);
      return ctx.reply(e.setDescription(lines.join('\n')));
    },
  },
  {
    name: 'remind',
    data: new SlashCommandBuilder().setName('remind').setDescription('Your own reminders')
      .addSubcommand((s) => s.setName('add').setDescription('Remind me later')
        .addIntegerOption((o) => o.setName('minutes').setDescription('In how many minutes').setRequired(true).setMinValue(1).setMaxValue(10080))
        .addStringOption((o) => o.setName('note').setDescription('What to remind you about').setRequired(true).setMaxLength(200)))
      .addSubcommand((s) => s.setName('list').setDescription('Everything queued for you'))
      .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a reminder')
        .addIntegerOption((o) => o.setName('id').setDescription('ID from /remind list').setRequired(true))).toJSON(),
    text: { aliases: ['r'], sub: true, subArgs: { add: ['minutes', 'note'], cancel: ['id'] } },
    run: (ctx, store) => {
      const sub = ctx.sub() ?? 'list';
      if (sub === 'add') {
        const mins = ctx.int('minutes');
        const note = ctx.str('note');
        if (!mins || mins < 1 || !note) return ctx.reply('Like this: `tz remind add 30 restart huntbot`');
        const at = new Date(Date.now() + Math.min(mins, 10080) * 60_000);
        const id = store.addReminder(ctx.userId, 'custom', at, note.slice(0, 200), ctx.channelId);
        return ctx.reply(`Noted, reminder #${id} <t:${unix(at)}:R>. I'll remember so you don't have to.`);
      }
      if (sub === 'cancel') {
        const id = ctx.int('id');
        return ctx.reply(id && store.deleteReminder(id, ctx.userId) ? 'Cancelled, consider it forgotten.' : 'No reminder with that ID.');
      }
      const list = store.userReminders(ctx.userId);
      if (!list.length) return ctx.reply('Nothing queued.');
      return ctx.reply(embed('Queued').setDescription(list.map((r) =>
        `#${r.id} **${r.kind}**${r.note ? ` ${r.note}` : ''} <t:${Math.floor(r.due_at / 1000)}:R>`).join('\n')));
    },
  },
  {
    name: 'settings',
    data: new SlashCommandBuilder().setName('settings').setDescription('How and when your OwO reminders reach you')
      .addSubcommand((s) => s.setName('view').setDescription('Show your settings'))
      .addSubcommand((s) => s.setName('delivery').setDescription('DM or ping in the channel')
        .addStringOption((o) => o.setName('to').setDescription('Where').setRequired(true)
          .addChoices({ name: 'DM', value: 'dm' }, { name: 'Channel', value: 'channel' })))
      .addSubcommand((s) => s.setName('timezone').setDescription('Your timezone, used for quiet hours')
        .addStringOption((o) => o.setName('zone').setDescription('Like Asia/Kolkata').setRequired(true)))
      .addSubcommand((s) => s.setName('quiet').setDescription('No reminders during these hours, they wait until it ends')
        .addStringOption((o) => o.setName('hours').setDescription('Like 00:30-07:30, or "off"').setRequired(true)))
      .addSubcommand((s) => s.setName('toggle').setDescription('Turn a reminder type on or off')
        .addStringOption((o) => o.setName('reminder').setDescription('Which one').setRequired(true)
          .addChoices(...toggles.map((t) => ({ name: t, value: t }))))
        .addBooleanOption((o) => o.setName('on').setDescription('On or off').setRequired(true))).toJSON(),
    text: { aliases: ['set'], sub: true, subArgs: { delivery: ['to'], timezone: ['zone'], quiet: ['hours'], toggle: ['reminder', 'on'] } },
    run: (ctx, store) => {
      const s = store.settings(ctx.userId);
      const sub = ctx.sub() ?? 'view';
      if (sub === 'delivery') {
        const to = ctx.str('to');
        if (to !== 'dm' && to !== 'channel') return ctx.reply('Pick `dm` or `channel`.');
        s.delivery = to;
      }
      if (sub === 'timezone') {
        const zone = ctx.str('zone') ?? '';
        try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { return ctx.reply('That timezone isn\'t real, use one like Asia/Kolkata.'); }
        s.timezone = zone;
      }
      if (sub === 'quiet') {
        const h = (ctx.str('hours') ?? '').trim();
        if (h === 'off') s.quiet = null;
        else if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(h)) s.quiet = h;
        else return ctx.reply('Use the format 00:30-07:30, or "off".');
      }
      if (sub === 'toggle') {
        const t = ctx.str('reminder') as (typeof toggles)[number];
        const on = ctx.bool('on');
        if (!toggles.includes(t) || on === null) return ctx.reply(`Like this: \`tz settings toggle pray off\`. Options: ${toggles.join(', ')}`);
        s[t] = on;
        if (!on) for (const r of store.userReminders(ctx.userId)) {
          if (r.kind === t || (t === 'daily' && r.kind === 'reset') || (t === 'huntbattle' && r.kind === 'hunt')) store.deleteReminder(r.id);
        }
      }
      store.saveSettings(ctx.userId, s);
      scheduleDailies(store, ctx.userId);
      return ctx.reply(embed('Your settings').setDescription(settingsText(s)));
    },
  },
];

export const owo: Module = {
  name: 'owo',
  label: 'OwO helper',
  about: 'Reminders, huntbot advice, gems, weapons and team checks for OwO',
  commands,
};
