import { SlashCommandBuilder } from 'discord.js';
import type { Settings, Store } from '../db.js';
import type { Ctx } from '../core/ctx.js';
import type { Command, Module } from '../core/module.js';
import { armouryReport } from '../features/armoury.js';
import { armouryPage, filters, type Filter } from '../features/armoury-pages.js';
import { dayStatus } from '../features/daily.js';
import { durability, planGems } from '../features/gems.js';
import { advise, maxLevel } from '../features/huntbot.js';
import { damageOn, teamCheck } from '../features/weapons.js';
import { planZoo, values } from '../features/zoo.js';
import { refresh, traits, weaponType, type Huntbot, type ListedWeapon, type Pet, type Weapon, type ZooRank } from '../owo/parse.js';
import { scheduleDailies } from '../reminders.js';
import { RED, bar, card, say, type CardOptions } from '../theme.js';
import { fmtLeft, nextReset, owoDay, unix } from '../time.js';

const toggles = ['huntbot', 'pray', 'daily', 'vote', 'minigames', 'huntbattle', 'lastcall'] as const;

// a gif an admin picked for this moment, if any
const gifFor = (store: Store, ctx: Ctx, kind: string) => (ctx.guildId ? store.guild(ctx.guildId).gifs[kind] : undefined) ?? null;

const show = (ctx: Ctx, store: Store, o: CardOptions) => ctx.reply(card({ ...o, gif: o.gif ?? gifFor(store, ctx, o.kind) }));

const missing = (ctx: Ctx, store: Store, cmd: string, title: string) => show(ctx, store, {
  kind: 'missing', title, emoji: '🔍', color: RED,
  body: `Run \`${cmd}\` somewhere I can read it, then ask me again.`,
});

const weaponsOf = (store: Store, userId: string) =>
  new Map((store.snapshot<[string, Weapon][]>(userId, 'weapons')?.data ?? []).map(([id, w]) => [id, refresh(w)]));

// splits "**Heading**\nlines" blocks into embed fields
function sections(lines: string[]) {
  const blocks = lines.join('\n').split(/\n\s*\n/);
  const body = blocks.shift() ?? '';
  const fields = blocks.map((b) => {
    const [first, ...rest] = b.split('\n');
    const head = first.match(/^\*\*(.+?)\*\*(.*)$/);
    return head ? { name: head[1] + head[2], value: rest.join('\n') || '​' } : { name: '​', value: b };
  });
  return { body, fields };
}


// ---------- commands ----------

const status: Command = {
  name: 'status',
  data: new SlashCommandBuilder().setName('status').setDescription('Your case file: timers, today\'s list, wallet and huntbot').toJSON(),
  text: { aliases: ['s', 'st'] },
  run: (ctx, store) => {
    const cds = store.cooldowns(ctx.userId);
    const now = Date.now();
    const timer = (what: string, label: string) => {
      const at = cds.get(what);
      if (!at) return `${label} · *unknown*`;
      return at <= now ? `${label} · **ready** ✨` : `${label} · <t:${Math.floor(at / 1000)}:R>`;
    };
    const items = dayStatus(store, ctx.userId);
    const done = items.filter((i) => i.done).length;
    const money = [['cash', '💰', 'cowoncy'], ['shards', '🔷', 'shards'], ['cookies', '🍪', 'cookies']]
      .map(([k, icon, label]) => {
        const v = store.snapshot<number>(ctx.userId, k)?.data;
        return v === undefined ? null : `${icon} **${v.toLocaleString()}** ${label}`;
      }).filter(Boolean);
    const hb = store.snapshot<Huntbot>(ctx.userId, 'huntbot')?.data;
    const fields = [
      { name: '⏱️ Timers', value: [timer('huntbot', '🤖 Huntbot'), timer('pray', '🙏 Pray'), timer('vote', '🗳️ Vote'), `🌙 Reset · <t:${unix(nextReset())}:R>`].join('\n'), inline: true },
      { name: `📋 Today · ${done}/${items.length}`, value: `${bar(done, items.length, 10)}\n` + items.map((i) => `${i.done ? '✅' : '▫️'} ${i.label}`).join('\n'), inline: true },
    ];
    if (money.length) fields.push({ name: '👛 Wallet', value: money.join('\n'), inline: false });
    if (hb) {
      const a = advise(hb);
      const g = hb.traits.gain;
      const e = hb.traits.efficiency;
      fields.push({ name: '🤖 Huntbot', value: [g ? `Gain **${g.level}**` : null, e ? `Efficiency **${e.level}**` : null, a.pick ? `next up: **${a.pick}**` : null].filter(Boolean).join(' · '), inline: false });
    }
    return show(ctx, store, { kind: 'status', title: 'Case file', emoji: '🗂️', fields });
  },
};

const huntbot: Command = {
  name: 'huntbot',
  data: new SlashCommandBuilder().setName('huntbot').setDescription('Your huntbot traits and what to upgrade next').toJSON(),
  text: { aliases: ['hb'] },
  run: (ctx, store) => {
    const snap = store.snapshot<Huntbot>(ctx.userId, 'huntbot');
    if (!snap) return missing(ctx, store, 'owo hb', 'Huntbot');
    const hb = snap.data;
    const a = advise(hb);
    const icons: Record<string, string> = { efficiency: '⚡', duration: '⏳', cost: '💸', gain: '🔧', experience: '⚔️', radar: '📡' };
    const fields = traits.filter((t) => hb.traits[t]).map((t) => {
      const st = hb.traits[t]!;
      const maxed = st.level >= maxLevel[t];
      return {
        name: `${icons[t]} ${t[0].toUpperCase()}${t.slice(1)}${a.pick === t ? '  ⭐' : ''}`,
        value: `\`${st.value}\` · lvl **${st.level}**\n${maxed ? '**maxed**' : `${bar(st.progress, st.needed, 8)} ${st.progress.toLocaleString()}/${st.needed.toLocaleString()}`}`,
        inline: true,
      };
    });
    fields.push({ name: '🧠 The plan', value: a.lines.join('\n'), inline: false });
    if (hb.essence !== null) fields.push({ name: '✨ Essence on hand', value: `**${hb.essence.toLocaleString()}**`, inline: true });
    return show(ctx, store, { kind: 'huntbot', title: 'Huntbot', emoji: '🤖', fields, at: snap.at });
  },
};

const gems: Command = {
  name: 'gems',
  data: new SlashCommandBuilder().setName('gems').setDescription('Which gems to use together, from your last owo inv').toJSON(),
  text: { aliases: ['g'] },
  run: (ctx, store) => {
    const inv = store.snapshot<[number, number][]>(ctx.userId, 'inv');
    if (!inv) return missing(ctx, store, 'owo inv', 'Gem plan');
    const plan = planGems(new Map(inv.data));
    const tiers = ['common', 'uncommon', 'rare', 'epic', 'mythical', 'legendary', 'fabled'];
    const owned = tiers.map((t, i) => {
      const h = plan.owned.hunting[i]; const e = plan.owned.empowering[i]; const l = plan.owned.lucky[i];
      return h + e + l ? `**${t}** · 🏹 ${h} · 💪 ${e} · 🍀 ${l} · lasts ${durability[i]}` : null;
    }).filter(Boolean);
    return show(ctx, store, {
      kind: 'gems', title: 'Gem plan', emoji: '💎', at: inv.at,
      fields: [
        { name: '🧰 In your bag', value: owned.join('\n') || 'nothing', inline: false },
        { name: '🧩 Use them like this', value: plan.lines.join('\n'), inline: false },
      ],
    });
  },
};

const zoo: Command = {
  name: 'zoo',
  data: new SlashCommandBuilder().setName('zoo').setDescription('What to sacrifice or sell from your zoo').toJSON(),
  text: { aliases: ['z'] },
  run: (ctx, store) => {
    const snap = store.snapshot<Partial<Record<ZooRank, number>>>(ctx.userId, 'zoo');
    if (!snap) return missing(ctx, store, 'owo zoo', 'Zoo planner');
    const hb = store.snapshot<Huntbot>(ctx.userId, 'huntbot')?.data ?? null;
    const counts = (Object.entries(snap.data) as [ZooRank, number][]).filter(([, n]) => n > 0)
      .map(([r, n]) => ({ name: values[r].label, value: `**${n}** spare`, inline: true }));
    const plan = planZoo(snap.data, hb).filter((l) => l.startsWith('Sacrifice') || l.startsWith('Sell') || l.startsWith('That') || l.startsWith('Your pets') || l.startsWith('Nothing'));
    return show(ctx, store, { kind: 'zoo', title: 'Zoo planner', emoji: '🦁', at: snap.at, fields: [...counts, { name: '🧾 Verdict', value: plan.join('\n'), inline: false }] });
  },
};

const armoury: Command = {
  name: 'armoury',
  data: new SlashCommandBuilder().setName('armoury').setDescription('Your whole weapon collection, best picks and what to dismantle')
    .addStringOption((o) => o.setName('view').setDescription('Picks and clean-up, or every weapon')
      .addChoices({ name: 'picks', value: 'picks' }, { name: 'all', value: 'all' }))
    .addStringOption((o) => o.setName('filter').setDescription('Start the full list on a filter')
      .addChoices(...Object.entries(filters).map(([value, f]) => ({ name: f.label, value })))).toJSON(),
  text: { aliases: ['armory', 'arm', 'a'], args: ['view', 'filter'] },
  run: (ctx, store) => {
    const snap = store.snapshot<[string, ListedWeapon][]>(ctx.userId, 'armoury');
    if (!snap) return missing(ctx, store, 'owo weapon', 'Armoury');
    const list = snap.data.map(([, w]) => w);
    // "tz a all", "tz a all mythic" or straight "tz a held" open the paged list
    const view = (ctx.str('view') ?? '').toLowerCase();
    const nick: Record<string, string> = { mythic: 'top', mythical: 'top', legendary: 'top', fabled: 'top', equipped: 'held', unequipped: 'free', emp: 'empowered', physical: 'str', magic: 'mag', tank: 'support' };
    const raw = (view === 'all' ? ctx.str('filter') ?? 'all' : view).toLowerCase();
    const filterArg = nick[raw] ?? raw;
    if (view === 'all' || filterArg in filters) {
      const f = (filterArg in filters ? filterArg : 'all') as Filter;
      return ctx.reply({ ...armouryPage(store, ctx.userId, 0, f, 'rarity') });
    }
    const team = store.snapshot<Pet[]>(ctx.userId, 'team')?.data ?? null;
    const shards = store.snapshot<number>(ctx.userId, 'shards')?.data ?? null;
    const { body, fields } = sections(armouryReport(list, team, weaponsOf(store, ctx.userId), shards));
    return show(ctx, store, {
      kind: 'armoury', title: 'Armoury', emoji: '⚔️', at: snap.at, body,
      fields: [...fields, { name: '📜 Full list', value: `\`${ctx.viaText ? 'tz a all' : '/armoury view:all'}\` pages through every weapon, with filters like \`tz a held\` or \`tz a mythic\``, inline: false }],
    });
  },
};

const team: Command = {
  name: 'team',
  data: new SlashCommandBuilder().setName('team').setDescription('Your team stats and weapon fit').toJSON(),
  text: { aliases: ['t'] },
  run: (ctx, store) => {
    const snap = store.snapshot<Pet[]>(ctx.userId, 'team');
    if (!snap) return missing(ctx, store, 'owo team', 'Team');
    const weapons = weaponsOf(store, ctx.userId);
    const fields = snap.data.map((p) => {
      const w = p.weaponId ? weapons.get(p.weaponId) : undefined;
      const role = p.str > p.mag * 1.3 ? '🗡️ physical' : p.mag > p.str * 1.3 ? '🔮 magic' : '🛡️ support';
      return {
        name: `[${p.slot}] ${p.name} · lvl ${p.level ?? '?'}`,
        value: [
          `${role}`,
          `❤️ ${p.hp} · 💧 ${p.wp}`,
          `⚔️ ${p.str} · ✨ ${p.mag}`,
          `🛡️ ${p.pr}% · 🌀 ${p.mr}%`,
          p.weaponId ? `🗡️ ${w ? w.name : `\`${p.weaponId}\``}` : '🗡️ none',
        ].join('\n'),
        inline: true,
      };
    });
    const warn = teamCheck(snap.data, weapons);
    if (warn.length) fields.push({ name: '⚠️ Something\'s off', value: warn.join('\n'), inline: false });
    const unseen = snap.data.filter((p) => p.weaponId && !weapons.has(p.weaponId));
    if (unseen.length) fields.push({ name: '🔍 Missing evidence', value: `Run \`owo weapon <id>\` on ${unseen.map((p) => p.weaponId).join(', ')}`, inline: false });
    return show(ctx, store, { kind: 'team', title: 'Team', emoji: '🐾', fields, at: snap.at });
  },
};

const weapon: Command = {
  name: 'weapon',
  data: new SlashCommandBuilder().setName('weapon').setDescription('Damage of a weapon on each pet in your team')
    .addStringOption((o) => o.setName('id').setDescription('Weapon ID, leave empty for the last one you looked at')).toJSON(),
  text: { aliases: ['w', 'wep'], args: ['id'] },
  run: (ctx, store) => {
    const teamSnap = store.snapshot<Pet[]>(ctx.userId, 'team');
    if (!teamSnap) return missing(ctx, store, 'owo team', 'Weapon check');
    const all = weaponsOf(store, ctx.userId);
    const id = ctx.str('id')?.toUpperCase() ?? store.snapshot<string>(ctx.userId, 'lastweapon')?.data;
    const w = id ? all.get(id) : undefined;
    if (!w) return missing(ctx, store, `owo weapon ${id ?? '<id>'}`, 'Weapon check');
    const kind = weaponType(w.name);
    if (!w.hits.length) {
      return show(ctx, store, { kind: 'weapon', title: `${w.name} · ${w.quality ?? '?'}%`, emoji: '🗡️', body: `${kind} doesn't hit for a flat %, so it's judged by what it does in the fight, not a number. Read its passives with \`owo weapon ${w.id}\`.` });
    }
    const rows = teamSnap.data.map((p) => ({ p, d: damageOn(w, p) })).sort((a, b) => b.d.total - a.d.total);
    const fields = rows.map(({ p, d }) => ({
      name: `${d.mismatch ? '❌' : '✅'} ${p.name}`,
      value: `**${d.perCast}** per hit\n**${d.total}** total${d.perWp !== null ? `\n${d.perWp} per WP` : ''}${d.mismatch ? '\n*wrong stat*' : ''}`,
      inline: true,
    }));
    const best = rows.find((r) => !r.d.mismatch) ?? rows[0];
    fields.push({ name: '🎯 Verdict', value: `Give it to **${best.p.name}**: \`owo weapon ${w.id} ${best.p.name}\`\n-# Before enemy resistance, total counts every enemy hit`, inline: false });
    return show(ctx, store, { kind: 'weapon', title: `${w.name} · ${w.quality ?? '?'}%`, emoji: '🗡️', fields, body: w.wpCost ? `💧 costs **${w.wpCost} WP** per use` : undefined });
  },
};

const quests: Command = {
  name: 'quests',
  data: new SlashCommandBuilder().setName('quests').setDescription('Your OwO quests from the last owo quest').toJSON(),
  text: { aliases: ['q'] },
  run: (ctx, store) => {
    const q = store.snapshot<{ allDone: boolean; lines: string[] }>(ctx.userId, 'quests');
    if (!q) return missing(ctx, store, 'owo quest', 'Quests');
    if (q.data.allDone) return show(ctx, store, { kind: 'questsDone', title: 'Quests', emoji: '📜', body: '🏁 Nothing left for today.', at: q.at });
    const body = q.data.lines.map((l) => `▫️ ${l}`).join('\n') || 'Nothing readable in it.';
    const social = /cookie|pray|curse|battle/i.test(body);
    return show(ctx, store, {
      kind: 'quests', title: 'Quests', emoji: '📜', body, at: q.at,
      fields: social ? [{ name: '🤝 Need a hand?', value: '`tz ask pray` (or cookie, curse, battle) calls the quest buddies here.', inline: false }] : [],
    });
  },
};

const stats: Command = {
  name: 'stats',
  data: new SlashCommandBuilder().setName('stats').setDescription('Your hunts and battles over the last 7 days').toJSON(),
  run: (ctx, store) => {
    const from = owoDay(new Date(Date.now() - 6 * 86_400_000));
    const byDay = new Map<string, Record<string, number>>();
    for (const r of store.countsSince(ctx.userId, from)) byDay.set(r.day, { ...(byDay.get(r.day) ?? {}), [r.what]: r.n });
    if (!byDay.size) return show(ctx, store, { kind: 'stats', title: 'Your week', emoji: '📈', body: 'Nothing counted yet. I count hunts and battles as you do them, quietly.' });
    let th = 0; let tb = 0;
    const top = Math.max(...[...byDay.values()].map((c) => (c.hunt ?? 0) + (c.battle ?? 0)), 1);
    const rows = [...byDay].map(([day, c]) => {
      th += c.hunt ?? 0; tb += c.battle ?? 0;
      return `\`${day.slice(5)}\` ${bar((c.hunt ?? 0) + (c.battle ?? 0), top, 10)} 🏹 ${c.hunt ?? 0} · ⚔️ ${c.battle ?? 0}`;
    });
    return show(ctx, store, {
      kind: 'stats', title: 'Your week', emoji: '📈', body: rows.join('\n'),
      fields: [{ name: '🏹 Hunts', value: `**${th}**`, inline: true }, { name: '⚔️ Battles', value: `**${tb}**`, inline: true }],
    });
  },
};

const leaderboard: Command = {
  name: 'leaderboard',
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Top hunters and battlers in this server this week').toJSON(),
  text: { aliases: ['lb', 'top'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Leaderboards live in servers.');
    const rows = store.board(ctx.guildId, owoDay(new Date(Date.now() - 6 * 86_400_000)));
    const medal = ['🥇', '🥈', '🥉'];
    const body = rows.length
      ? rows.map((r, i) => `${medal[i] ?? `\`#${i + 1}\``} <@${r.user_id}> · 🏹 **${r.hunts}** · ⚔️ **${r.battles}**`).join('\n')
      : 'Nobody hunted where I could see it this week. Peaceful. I loved it.';
    return ctx.reply({ embeds: [card({ kind: 'leaderboard', title: 'This week\'s hunters', emoji: '🏆', body, gif: gifFor(store, ctx, 'leaderboard') })], private: false });
  },
};

const remind: Command = {
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
      return show(ctx, store, { kind: 'remindAdd', title: `Promise #${id}`, emoji: '📝', body: `**${note}**\n⏰ <t:${unix(at)}:R>` });
    }
    if (sub === 'cancel') {
      const id = ctx.int('id');
      return id && store.deleteReminder(id, ctx.userId)
        ? show(ctx, store, { kind: 'remindCancel', title: 'Promise broken, as requested', emoji: '🗑️' })
        : ctx.reply('No reminder with that ID.');
    }
    const list = store.userReminders(ctx.userId);
    const label: Record<string, string> = { huntbot: '🤖 huntbot back', pray: '🙏 pray ready', vote: '🗳️ vote ready', hunt: '🏹 hunt ready', reset: '🌅 new OwO day', lastcall: '⏳ last call', custom: '📝' };
    const body = list.length
      ? list.map((r) => `\`#${r.id}\` ${label[r.kind] ?? r.kind}${r.note ? ` ${r.note}` : ''} · <t:${Math.floor(r.due_at / 1000)}:R>`).join('\n')
      : 'Nothing queued.';
    return show(ctx, store, { kind: 'remindAdd', title: 'Promises I made', emoji: '📝', body });
  },
};

function settingsFields(s: Settings) {
  const names: Record<string, string> = { huntbot: '🤖 huntbot back', pray: '🙏 pray/curse', daily: '🌅 new day list', vote: '🗳️ vote', minigames: '🦀 patreon minigames', huntbattle: '🏹 hunt/battle every 15s', lastcall: '⏳ last call' };
  return [
    { name: '📬 Delivery', value: s.delivery === 'dm' ? 'DM' : 'ping in channel', inline: true },
    { name: '🌏 Timezone', value: s.timezone, inline: true },
    { name: '🌙 Quiet hours', value: s.quiet ?? 'off', inline: true },
    { name: '🔔 Reminders', value: toggles.map((t) => `${s[t] ? '✅' : '▫️'} ${names[t]}`).join('\n'), inline: false },
  ];
}

const settings: Command = {
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
    return show(ctx, store, { kind: 'settings', title: 'Your settings', emoji: '⚙️', fields: settingsFields(s) });
  },
};

const buddy: Command = {
  name: 'buddy',
  data: new SlashCommandBuilder().setName('buddy').setDescription('Quest buddies trade cookies, prays and curses')
    .addSubcommand((s) => s.setName('join').setDescription('Get pinged when someone needs a cookie, pray or curse'))
    .addSubcommand((s) => s.setName('leave').setDescription('Stop getting pinged'))
    .addSubcommand((s) => s.setName('list').setDescription('Who is in')).toJSON(),
  text: { aliases: ['buddies'], sub: true },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Buddies live in servers.');
    const sub = ctx.sub() ?? 'list';
    if (sub === 'join') { store.setBuddy(ctx.guildId, ctx.userId, true); return show(ctx, store, { kind: 'buddyJoin', title: 'Welcome to the network', emoji: '🕵️', body: 'You\'ll get pinged when someone needs a cookie, pray, curse or battle.' }); }
    if (sub === 'leave') { store.setBuddy(ctx.guildId, ctx.userId, false); return show(ctx, store, { kind: 'buddyLeave', title: 'Off the network', emoji: '🚪' }); }
    const list = store.buddies(ctx.guildId);
    return show(ctx, store, { kind: 'buddyJoin', title: `The network · ${list.length}`, emoji: '🕵️', body: list.length ? list.map((u) => `<@${u}>`).join(' ') : 'Nobody yet, `tz buddy join` to start.' });
  },
};

const ask: Command = {
  name: 'ask',
  data: new SlashCommandBuilder().setName('ask').setDescription('Ask the quest buddies for a cookie, pray, curse or battle')
    .addStringOption((o) => o.setName('what').setDescription('What you need').setRequired(true)
      .addChoices({ name: 'cookie', value: 'cookie' }, { name: 'pray', value: 'pray' }, { name: 'curse', value: 'curse' }, { name: 'battle', value: 'battle' })).toJSON(),
  text: { args: ['what'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Ask inside a server.');
    const what = ctx.str('what')?.toLowerCase();
    const cmd: Record<string, string> = { cookie: 'owo cookie', pray: 'owo pray', curse: 'owo curse', battle: 'owo battle' };
    if (!what || !cmd[what]) return ctx.reply('Ask for `cookie`, `pray`, `curse` or `battle`.');
    const last = store.cooldowns(ctx.userId).get('ask') ?? 0;
    if (Date.now() - last < 30 * 60_000) return ctx.reply(say('askCooldown'));
    const others = store.buddies(ctx.guildId).filter((u) => u !== ctx.userId);
    if (!others.length) return ctx.reply('No other quest buddies here yet. Get a friend to run `tz buddy join`.');
    store.setCooldown(ctx.userId, 'ask', new Date());
    const icon: Record<string, string> = { cookie: '🍪', pray: '🙏', curse: '🧿', battle: '⚔️' };
    return ctx.reply({
      content: others.map((u) => `<@${u}>`).join(' '),
      embeds: [card({ kind: 'ask', title: `${what} wanted`, emoji: icon[what], body: `<@${ctx.userId}> needs a **${what}** for a quest.\n\`${cmd[what]} @them\``, gif: gifFor(store, ctx, 'ask') })],
      private: false,
      ping: others,
    });
  },
};

export const owo: Module = {
  name: 'owo',
  label: 'OwO helper',
  about: 'Reminders, huntbot, gems, zoo, weapons, quests and the weekly board',
  commands: [status, huntbot, gems, zoo, armoury, team, weapon, quests, stats, leaderboard, remind, settings, buddy, ask],
};

