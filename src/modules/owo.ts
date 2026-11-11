import { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle, SlashCommandBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import type { Store } from '../db.js';
import type { Ctx } from '../core/ctx.js';
import type { Command, Module } from '../core/module.js';
import { armouryPage, filters, type Filter } from '../features/armoury-pages.js';
import { shopDeals } from '../features/armoury.js';
import { dayStatus } from '../features/daily.js';
import { durability, gemTotals, planGems } from '../features/gems.js';
import { advise, maxLevel } from '../features/huntbot.js';
import { damageOn, teamCheck } from '../features/weapons.js';
import { planZoo, values } from '../features/zoo.js';
import { refresh, traits, weaponType, type Huntbot, type ListedWeapon, type Pet, type ShopWeapon, type Weapon, type ZooRank } from '../owo/parse.js';
import { momentOf } from '../gifs.js';
import { panel } from '../features/panel.js';
import { parseLength } from './moderation.js';
import { RED, bar, card, say, type CardOptions } from '../theme.js';
import { fmtLeft, nextReset, owoDay, unix } from '../time.js';

const toggles = ['huntbot', 'pray', 'daily', 'vote', 'minigames', 'huntbattle', 'lastcall'] as const;

// a gif an admin picked for this moment, if any
const gifFor = (store: Store, ctx: Ctx, kind: string) => (ctx.guildId ? store.guild(ctx.guildId).gifs[momentOf[kind] ?? kind] : undefined) ?? null;

const show = (ctx: Ctx, store: Store, o: CardOptions) => ctx.reply(card({ ...o, gif: o.gif ?? gifFor(store, ctx, o.kind) }));

// nothing seen yet is a one-liner, not a whole card
const missing = (ctx: Ctx, _store: Store, cmd: string, title: string) =>
  ctx.reply({ content: `🔍 **${title}**: I haven't seen it yet. Run \`${cmd}\` somewhere I can read it, then ask me again.`, temp: true });

const weaponsOf = (store: Store, userId: string) =>
  new Map((store.snapshot<[string, Weapon][]>(userId, 'weapons')?.data ?? []).map(([id, w]) => [id, refresh(w)]));

// ---------- commands ----------

const status: Command = {
  name: 'status',
  group: 'owo',
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
    // nothing seen yet, so say how this works instead of a wall of unknowns
    if (!cds.size && !money.length && !hb) fields.unshift({ name: '👋 New here?', value: 'Just play OwO in a channel I can read. I pick up your huntbot, pray, vote, gems and weapons from its replies, then remind you and plan things here. Try `owo hb`, `owo inv` or `owo weapon` once.', inline: false });
    const streak = store.snapshot<{ now: number; best: number }>(ctx.userId, 'streak')?.data;
    if (streak) money.push(`⚔️ battle streak **${streak.now}** (best ${streak.best})`);
    const inv = store.snapshot<[number, number][]>(ctx.userId, 'inv')?.data;
    if (inv) {
      const gt = gemTotals(new Map(inv));
      money.push(`💎 gems · ${gt.hunting} hunting · ${gt.empowering} empowering · ${gt.lucky} lucky`);
    }
    if (money.length) fields.push({ name: '👛 Wallet', value: money.join('\n'), inline: false });
    if (hb) {
      const a = advise(hb);
      const g = hb.traits.gain;
      const e = hb.traits.efficiency;
      fields.push({ name: '🤖 Huntbot', value: [g ? `Gain **${g.level}**` : null, e ? `Efficiency **${e.level}**` : null, a.pick ? `next up: **${a.pick}**` : null].filter(Boolean).join(' · '), inline: false });
    }
    // the rest of the dashboard: quests, armoury, reminders and today's shop at a glance
    const glance: string[] = [];
    const q = store.snapshot<{ allDone: boolean; lines: string[] }>(ctx.userId, 'quests')?.data;
    if (q) glance.push(q.allDone ? '📜 quests all done' : `📜 ${q.lines.length} quest line${q.lines.length === 1 ? '' : 's'} open`);
    const arm = store.snapshot<[string, unknown][]>(ctx.userId, 'armoury')?.data;
    if (arm) glance.push(`⚔️ ${arm.length} weapons on file`);
    const queued = store.userReminders(ctx.userId).filter((r) => !['reset', 'lastcall'].includes(r.kind));
    if (queued.length) glance.push(`⏰ ${queued.length} reminder${queued.length === 1 ? '' : 's'} queued, next <t:${Math.floor(Math.min(...queued.map((r) => r.due_at)) / 1000)}:R>`);
    const shopSnap = store.snapshot<{ until: number | null }>('*', 'shop');
    if (shopSnap && (!shopSnap.data.until || shopSnap.data.until > Date.now())) glance.push('🛒 today\'s weapon shop is on file, `tz shop`');
    if (glance.length) fields.push({ name: '🧭 At a glance', value: glance.join('\n'), inline: false });
    const nav = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...[['huntbot', '🤖', 'Huntbot'], ['armoury', '⚔️', 'Armoury'], ['zoo', '🦁', 'Zoo'], ['quests', '📜', 'Quests'], ['pings', '🔔', 'Pings and reminders']]
        .map(([cmd, emoji, label]) => new ButtonBuilder().setCustomId(`nav|${cmd}|owner=${ctx.userId},back=status`).setEmoji(emoji).setLabel(label).setStyle(ButtonStyle.Secondary)),
    );
    const more = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`nav|pick|owner=${ctx.userId},back=status`).setPlaceholder('📂 Open anything else').addOptions(
        { label: 'Gems', value: 'gems', emoji: '💎' }, { label: 'Team', value: 'team', emoji: '🐾' }, { label: 'Weapon shop', value: 'shop', emoji: '🛒' },
        { label: 'Weekly stats', value: 'stats', emoji: '📈' }, { label: 'Leaderboard', value: 'leaderboard', emoji: '🏆' },
        { label: 'OwO reminder settings', value: 'reminders', emoji: '🎛️' }, { label: 'Buddies', value: 'buddy', emoji: '🤝' },
        { label: 'Join the buddy network', value: 'buddy.join', emoji: '🕵️' }, { label: 'Ask buddies for a cookie, pray...', value: 'ask', emoji: '📣' },
        { label: 'Check one weapon', value: 'weapon', emoji: '🗡️' },
      ));
    return ctx.reply({ embeds: [card({ kind: 'status', title: 'Stray Dogs Den', emoji: '🐾', fields, gif: gifFor(store, ctx, 'status') })], components: [nav, more] });
  },
};

const huntbot: Command = {
  name: 'huntbot',
  group: 'owo',
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
    // how far each trait moved in the last week
    const hist = store.snapshot<{ at: number; levels: Record<string, number> }[]>(ctx.userId, 'hbhist')?.data ?? [];
    const weekAgo = [...hist].reverse().find((h) => h.at <= Date.now() - 7 * 86_400_000) ?? hist[0];
    const last = hist.at(-1);
    if (weekAgo && last && weekAgo !== last) {
      const moved = Object.entries(last.levels).map(([k, v]) => [k, v - (weekAgo.levels[k] ?? v)] as const).filter(([, d]) => d > 0);
      fields.push({ name: `📈 Since <t:${Math.floor(weekAgo.at / 1000)}:d>`, value: moved.length ? moved.map(([k, d]) => `${icons[k]} ${k} +${d}`).join(' · ') : 'no levels gained yet', inline: true });
    }
    return show(ctx, store, { kind: 'huntbot', title: 'Huntbot', emoji: '🤖', fields, at: snap.at });
  },
};

const gems: Command = {
  name: 'gems',
  group: 'owo',
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
  group: 'owo',
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
  group: 'owo',
  data: new SlashCommandBuilder().setName('armoury').setDescription('Your whole weapon collection with best picks, clean-up, filters and pages')
    .addStringOption((o) => o.setName('filter').setDescription('Start on a filter')
      .addChoices(...Object.entries(filters).map(([value, f]) => ({ name: f.label, value })))).toJSON(),
  text: { aliases: ['armory', 'arm', 'a'], args: ['filter'] },
  run: (ctx, store) => {
    if (!store.snapshot(ctx.userId, 'armoury')) return missing(ctx, store, 'owo weapon', 'Armoury');
    // "tz a", "tz a mythic", "tz a held", "tz a junk" all open the same screen
    const nick: Record<string, string> = {
      all: 'all', mythic: 'top', mythical: 'top', legendary: 'top', fabled: 'top', equipped: 'held', unequipped: 'free',
      emp: 'empowered', physical: 'str', magic: 'mag', tank: 'support', dismantle: 'junk', trash: 'junk', scrap: 'junk',
    };
    const raw = (ctx.str('filter') ?? 'all').toLowerCase();
    const f = (nick[raw] ?? raw) in filters ? (nick[raw] ?? raw) as Filter : 'all';
    return ctx.reply(armouryPage(store, ctx.userId, 0, f, 'rarity'));
  },
};

const team: Command = {
  name: 'team',
  group: 'owo',
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
  group: 'owo',
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
  group: 'owo',
  data: new SlashCommandBuilder().setName('quests').setDescription('Your OwO quests from the last owo quest').toJSON(),
  text: { aliases: ['q'] },
  run: (ctx, store) => {
    const q = store.snapshot<{ allDone: boolean; lines: string[] }>(ctx.userId, 'quests');
    if (!q) return missing(ctx, store, 'owo quest', 'Quests');
    if (q.data.allDone) return ctx.reply({ content: `📜 Every quest done for today. ${say('questsDone')}`, temp: true });
    const body = q.data.lines.map((l) => `▫️ ${l}`).join('\n') || 'Nothing readable in it.';
    const social = /cookie|pray|curse|battle/i.test(body);
    return show(ctx, store, {
      kind: 'quests', title: 'Quests', emoji: '📜', body, at: q.at,
      fields: social ? [{ name: '🤝 Need a hand?', value: '`tz ask pray` (or cookie, curse, battle) calls the quest buddies here.', inline: false }] : [],
    });
  },
};

const shop: Command = {
  name: 'shop',
  group: 'owo',
  data: new SlashCommandBuilder().setName('shop').setDescription('Today\'s OwO weapon shop, checked against your armoury').toJSON(),
  text: { aliases: ['deals'] },
  run: (ctx, store) => {
    const snap = store.snapshot<{ items: ShopWeapon[]; until: number | null }>('*', 'shop');
    // the shop rerolls every day, yesterday's page is no use
    const stale = !snap || (snap.data.until ? Date.now() > snap.data.until : Date.now() - snap.at > 24 * 3_600_000);
    if (!snap || stale) return missing(ctx, store, 'owo shop weapon', 'Weapon shop');
    const list = [...new Map(store.snapshot<[string, ListedWeapon][]>(ctx.userId, 'armoury')?.data ?? []).values()];
    const deals = shopDeals(snap.data.items, list, store.snapshot<Pet[]>(ctx.userId, 'team')?.data ?? null);
    const icon = { upgrade: '⬆️', new: '🆕', have: '▫️' };
    const body = deals.map((d) => `${icon[d.verdict]} \`${d.item.id}\` **${d.item.name}** · ${d.item.price.toLocaleString()} shards\n-# ${d.note}`).join('\n');
    const shards = store.snapshot<number>(ctx.userId, 'shards')?.data;
    const fields = [
      { name: '💎 Your shards', value: shards !== undefined ? shards.toLocaleString() : '*run `owo ws` and I\'ll know*', inline: true },
      ...(snap.data.until ? [{ name: '🔄 New stock', value: `<t:${Math.floor(snap.data.until / 1000)}:R>`, inline: true }] : []),
    ];
    if (!list.length) fields.push({ name: '📦 Armoury', value: 'I haven\'t seen your weapons, so everything looks new. `owo weapon` fixes that.', inline: false });
    return show(ctx, store, { kind: 'shop', title: 'Weapon shop', emoji: '🛒', body, fields, at: snap.at, gif: 'off' });
  },
};

const stats: Command = {
  name: 'stats',
  hidden: true,
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
  group: 'owo',
  as: 'top',
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
  group: 'you',
  data: new SlashCommandBuilder().setName('remind').setDescription('Your reminders, or add one straight away')
    .addIntegerOption((o) => o.setName('minutes').setDescription('Remind me in this many minutes').setMinValue(1).setMaxValue(10080))
    .addStringOption((o) => o.setName('note').setDescription('What about').setMaxLength(200)).toJSON(),
  text: { aliases: ['r'], args: ['minutes', 'note'] },
  run: (ctx, store) => {
    // "tz r 30 restart huntbot" adds one, plain "tz r" opens the list
    // "tz r 30 ...", "tz r 2h ..." and "tz r 1h30m ..." all work
    const raw = ctx.str('minutes') ?? '';
    const mins = /^\d+$/.test(raw) ? Number(raw) : ctx.viaText ? Math.round((parseLength(raw) ?? 0) / 60_000) || null : ctx.int('minutes');
    const note = ctx.str('note');
    if (mins && note) {
      const at = new Date(Date.now() + Math.min(Math.max(mins, 1), 10080) * 60_000);
      const id = store.addReminder(ctx.userId, 'custom', at, note.slice(0, 200), ctx.channelId);
      return ctx.reply({ content: `📝 Promise #${id}: **${note}**, <t:${unix(at)}:R>. ${say('remindAdd')}`, temp: false });
    }
    return ctx.reply(panel(store, ctx.userId, 'list'));
  },
};

const settings: Command = {
  name: 'reminders',
  group: 'you',
  data: new SlashCommandBuilder().setName('reminders').setDescription('Your reminder control room: what, where and when').toJSON(),
  text: { aliases: ['settings', 'set'] },
  run: (ctx, store) => ctx.reply(panel(store, ctx.userId, 'settings')),
};

const buddy: Command = {
  name: 'buddy',
  group: 'owo',
  data: new SlashCommandBuilder().setName('buddy').setDescription('Quest buddies trade cookies, prays and curses')
    .addSubcommand((s) => s.setName('join').setDescription('Get pinged when someone needs a cookie, pray or curse'))
    .addSubcommand((s) => s.setName('leave').setDescription('Stop getting pinged'))
    .addSubcommand((s) => s.setName('list').setDescription('Who is in')).toJSON(),
  text: { aliases: ['buddies'], sub: true },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Buddies live in servers.');
    const sub = ctx.sub() ?? 'list';
    if (sub === 'join') { store.setBuddy(ctx.guildId, ctx.userId, true); return ctx.reply({ content: `🕵️ You're on the network, I'll ping you when someone needs a cookie, pray, curse or battle. ${say('buddyJoin')}`, temp: true }); }
    if (sub === 'leave') { store.setBuddy(ctx.guildId, ctx.userId, false); return ctx.reply({ content: `🚪 Off the network. ${say('buddyLeave')}`, temp: true }); }
    const list = store.buddies(ctx.guildId);
    return show(ctx, store, { kind: 'buddyJoin', title: `The network · ${list.length}`, emoji: '🕵️', body: list.length ? list.map((u) => `<@${u}>`).join(' ') : 'Nobody yet, `tz buddy join` to start.' });
  },
};

const ask: Command = {
  name: 'ask',
  group: 'owo',
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
    // buddies have to see this one, so it's public even from slash
    return ctx.reply({
      content: `${icon[what]} ${others.map((u) => `<@${u}>`).join(' ')}\n<@${ctx.userId}> needs a **${what}** for a quest: \`${cmd[what]} @them\`\n-# ${say('ask')}`,
      ping: others,
      public: true,
    });
  },
};

export const owo: Module = {
  name: 'owo',
  label: 'OwO helper',
  about: 'Reminders, huntbot, gems, zoo, weapons, quests and the weekly board',
  commands: [status, huntbot, gems, zoo, armoury, shop, team, weapon, quests, stats, leaderboard, remind, settings, buddy, ask],
};

