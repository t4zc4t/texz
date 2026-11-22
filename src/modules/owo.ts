import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import type { Ctx } from '../core/ctx.js';
import type { Command, Module } from '../core/module.js';
import type { Store } from '../db.js';
import { card } from '../theme.js';
import { passiveOf, weaponOf } from '../owo/catalog.js';
import { OwoState } from '../owo/state.js';
import { dismantleList, rangesFrom, report, SHARDS } from '../owo/advice.js';
import { baseOf, planFor, type Arm, type Candidate } from '../owo/team.js';
import { WALL_IDS, wallPrice, wallUrl } from '../owo/catalog.js';
import { battleStats, catchStats, collectibles, forecast, paceOf, teamNow } from '../owo/stats.js';
import { statsAt } from '../owo/team.js';
import { wallCard } from '../owo/wallcard.js';
import { fetchAvatar } from '../features/rankcard.js';
import { PINGS, nextOwoDay, pingsOf, setPing, type PingKind } from '../owo/pings.js';
import { advise, sellPlan, statOf, upgradeWord, type HbLevels, type HbTrait, type Hold } from '../owo/huntbot.js';

// The Stray Dogs Den: everything Texz has learnt about your OwO account by watching your normal
// OwO commands. It only reads and advises, it never plays for you.

const at = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;
const pct = (a: number, b: number) => (b ? Math.floor((a / b) * 100) : 0);
const stateOf = (store: Store) => new OwoState(store.db);
const row = (...c: ButtonBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

// one line per thing Texz can know, and the OwO command that teaches it
export function syncLines(store: Store, userId: string) {
  const st = stateOf(store);
  const teams = st.teams(userId);
  const weapons = st.weapons(userId);
  const zoo = st.zoo(userId);
  const hb = st.huntbot(userId);
  const bits = st.bits(userId);
  const detailed = weapons.filter((w) => w.detailed).length;
  return [
    { name: '🐾 Team', value: teams.length ? `${teams.length} team${teams.length === 1 ? '' : 's'} · seen ${at(Math.max(...teams.map((t) => t.at)))}` : 'not yet, run `w team`' },
    { name: '🗡️ Weapons', value: weapons.length ? `${weapons.length} known · ${detailed} with full numbers · seen ${at(Math.max(...weapons.map((w) => w.seenAt)))}` : 'not yet, run `w weapon`' },
    { name: '🦁 Zoo', value: zoo ? `${zoo.animals.length} animals · ${zoo.points?.toLocaleString() ?? '?'} points · seen ${at(zoo.at)}` : 'not yet, run `w zoo`' },
    { name: '🤖 HuntBot', value: hb ? `${hb.backAt && hb.backAt > Date.now() ? `back ${at(hb.backAt)}` : 'home'} · seen ${at(hb.at)}` : 'not yet, run `w hb`' },
    { name: '💎 Shards', value: bits.has('shards') ? `${(bits.get('shards')!.value as number).toLocaleString()} · seen ${at(bits.get('shards')!.at)}` : 'not yet, run `w ws`' },
  ];
}

export function owoGlance(store: Store, userId: string) {
  const st = stateOf(store);
  const known = [st.teams(userId).length ? 'team' : '', st.weapons(userId).length ? `${st.weapons(userId).length} weapons` : '', st.zoo(userId) ? 'zoo' : '', st.huntbot(userId) ? 'HuntBot' : ''].filter(Boolean);
  const hb = st.huntbot(userId);
  if (!known.length) return 'Nothing synced yet. Run `w team`, `w zoo`, `w hb`, `w weapon`.';
  const left = collectibles(st, userId).filter((x) => !x.done).length;
  return `📡 Synced: ${known.join(', ')}${hb?.backAt && hb.backAt > Date.now() ? ` · 🤖 HuntBot back ${at(hb.backAt)}` : ''}${left ? ` · 🎀 ${left} collectible${left > 1 ? 's' : ''} left today` : ''}`;
}

const synced: Command = {
  name: 'owosync',
  as: 'synced',
  group: 'owo',
  data: new SlashCommandBuilder().setName('synced').setDescription('What Texz knows about your OwO account and when it last saw it').toJSON(),
  text: { aliases: ['sync', 'synced'], noName: true },
  run: async (ctx, store) => ctx.reply({
    embeds: [card({
      kind: 'help', title: 'What I know', emoji: '📡', gif: 'off', line: '',
      body: '',
      fields: syncLines(store, ctx.userId).map((f) => ({ ...f, inline: false })),
    })],
  }),
};

const team: Command = {
  name: 'owoteam',
  as: 'team',
  group: 'owo',
  data: new SlashCommandBuilder().setName('team').setDescription('Your OwO teams and advice on which pet should hold which weapon, judged at equal level').toJSON(),
  text: { aliases: ['oteam'], noName: true },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const teams = st.teams(ctx.userId);
    if (!teams.length) return ctx.reply('No team yet. Run `w team`.');
    const pets = new Map(st.pets(ctx.userId).map((p) => [p.animal, p]));
    const weapons = new Map(st.weapons(ctx.userId).map((w) => [w.id, w]));
    const fields = teams.flatMap((t) => [
      { name: !t.name || t.name.toLowerCase() === 'team' ? `Team ${t.team}` : t.name, value: `🔥 streak **${t.streak ?? 0}** · best ${t.best ?? 0} · seen ${at(t.at)}`, inline: false },
      ...t.animals.map((a) => {
        const p = pets.get(a);
        if (!p) return { name: a, value: '?', inline: true };
        const w = p.weapon_id ? weapons.get(p.weapon_id) : null;
        const wname = w ? (w.name ?? (w.type ? weaponOf(w.type).name : 'weapon')) : null;
        return {
          name: `${p.name} · Lvl ${p.level}`,
          value: [
            `${pct(p.xp, p.xp_need)}% to Lvl ${p.level + 1}`,
            `❤️ ${p.hp} · 💧 ${p.wp}`,
            `⚔️ ${p.str} · ✨ ${p.mag}`,
            `🛡️ ${p.pr}% · 🔮 ${p.mr}%`,
            wname ? `🗡️ ${wname} ${w!.quality ?? '?'}%` : '🗡️ no weapon',
          ].join('\n'),
          inline: true,
        };
      }),
    ]);
    const adv = teamAdvice(store, ctx.userId);
    let body = '';
    if (adv) {
      const { plan } = adv;
      const lines = plan.changes.length
        ? plan.changes.map((c) => `• ${c.text}${c.cmds.length ? `\n\`\`\`${c.cmds.join('\n')}\`\`\`` : ''}`)
        : ['✅ Best setup for your weapons.'];
      const later = plan.later.map((l) => `-# Later: **${l.c.name}** (Lvl ${l.c.level}, ~${l.days}d of battles)`);
      body = [...lines, ...later].join('\n');
    }
    return ctx.reply({ embeds: [card({ kind: 'help', title: 'Your OwO teams', emoji: '🐾', gif: 'off', line: '', body: body.slice(0, 4000), fields })] });
  },
};

// everyone who could be on the team: pets you've levelled, plus zoo animals the shared dex knows, at level 1
export function teamAdvice(store: Store, userId: string) {
  const st = stateOf(store);
  const teams = st.teams(userId);
  if (!teams.length) return null;
  const pets = st.pets(userId);
  const cands: Candidate[] = pets.map((p) => {
    const d = st.dex(p.animal);
    return { animal: p.animal, name: p.name, level: p.level, xp: p.xp, base: d ? { hp: d.hp, wp: d.wp, str: d.str, mag: d.mag, pr: d.pr, mr: d.mr } : baseOf(p), exact: !!d };
  });
  for (const a of st.zoo(userId)?.animals ?? []) {
    if (cands.some((c) => c.animal === a.animal)) continue;
    const d = st.dex(a.animal);
    if (d) cands.push({ animal: a.animal, name: a.animal, level: 1, xp: 0, base: { hp: d.hp, wp: d.wp, str: d.str, mag: d.mag, pr: d.pr, mr: d.mr }, exact: true });
  }
  const weapons = st.weapons(userId);
  const arms: Arm[] = weapons.map((w) => ({ id: w.id, type: w.name ?? (w.type ? weaponOf(w.type).name : '?'), quality: w.quality ?? 0, wpCost: w.wpCost }));
  const active = [...teams].sort((a, b) => b.at - a.at)[0];
  const held = new Map(pets.filter((p) => p.weapon_id).map((p) => [p.animal, arms.find((a) => a.id === p.weapon_id) ?? null]));
  // battles a day from the log, or a fair guess until there's a week of it
  const week = st.battles(userId, Date.now() - 7 * 86_400_000);
  const span = week.length ? Math.max(1, (Date.now() - Math.min(...week.map((b) => b.at))) / 86_400_000) : 0;
  const pace = week.length >= 20 ? Math.round(week.length / span) : 60;
  const plan = planFor(active.animals.map((a) => ({ animal: a, arm: held.get(a) ?? null })), cands, arms, pace);
  return plan ? { plan, pets: cands.length, exact: cands.filter((c) => c.exact).length } : null;
}

const PAGE = 10;
const weaponsCmd: Command = {
  name: 'owoweapons',
  as: 'weapons',
  group: 'owo',
  data: new SlashCommandBuilder().setName('weapons').setDescription('Every OwO weapon Texz knows about, best first, with passives and who holds it').toJSON(),
  text: { aliases: ['oweapons', 'owep'], noName: true },
  run: async (ctx, store) => {
    const all = stateOf(store).weapons(ctx.userId);
    if (!all.length) return ctx.reply('No weapons yet. Run `w weapon`.');
    const pages = Math.ceil(all.length / PAGE);
    const n = Math.min(Math.max(0, ctx.int('page') ?? 0), pages - 1);
    const lines = all.slice(n * PAGE, n * PAGE + PAGE).map((w) => {
      const name = w.name ?? (w.type ? weaponOf(w.type).name : '?');
      const passives = (w.passives?.map((p) => p.name) ?? w.passiveIcons.map((p) => passiveOf(p).name)).join(', ');
      const bits = [w.rarity ? cap(w.rarity) : null, w.wear && w.wear !== 'worn' ? cap(w.wear) : null, w.empowered ? 'Empowered' : null].filter(Boolean).join(' · ');
      return `\`${w.id}\` **${name}** ${w.quality ?? '?'}%${w.favourite ? ' ⭐' : ''}\n-# ${bits}${passives ? ` · ${passives}` : ''}${w.on ? ` · held by ${w.on}` : ''}`;
    });
    const rows = pages > 1 ? [row(
      new ButtonBuilder().setCustomId(`nav|owoweapons|owner=${ctx.userId},page=${n - 1}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(n === 0),
      new ButtonBuilder().setCustomId(`nav|owoweapons|owner=${ctx.userId},page=${n + 1}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(n >= pages - 1),
    )] : [];
    const e = card({ kind: 'help', title: 'Your OwO weapons', emoji: '🗡️', gif: 'off', line: '', body: lines.join('\n') });
    e.setFooter({ text: `${pages > 1 ? `Page ${n + 1}/${pages} · ` : ''}${all.length} weapons` });
    return ctx.reply({ embeds: [e], components: rows });
  },
};

const zooCmd: Command = {
  name: 'owozoo',
  as: 'zoo',
  group: 'owo',
  data: new SlashCommandBuilder().setName('zoo').setDescription('Your OwO zoo: animals by rank, zoo points and everything you have ever caught').toJSON(),
  text: { aliases: ['ozoo'], noName: true },
  run: async (ctx, store) => {
    const z = stateOf(store).zoo(ctx.userId);
    if (!z) return ctx.reply('No zoo yet. Run `w zoo`.');
    const ranks = [...new Set(z.animals.map((a) => a.rank))];
    const fields = ranks.map((r) => {
      const list = z.animals.filter((a) => a.rank === r);
      const have = list.reduce((n, a) => n + a.count, 0);
      return { name: cap(r), value: `${have.toLocaleString()} in stock · ${list.length} kind${list.length === 1 ? '' : 's'} unlocked`, inline: true };
    });
    const word: Record<string, string> = { C: 'common', U: 'uncommon', R: 'rare', E: 'epic', M: 'mythic', S: 'special', G: 'gem', L: 'legendary', F: 'fabled', B: 'bot', D: 'distorted', P: 'patreon', CP: 'custom patreon', H: 'hidden' };
    const caught = Object.entries(z.caught).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v.toLocaleString()} ${word[k] ?? k}`).join(' · ');
    return ctx.reply({ embeds: [card({ kind: 'help', title: 'Your OwO zoo', emoji: '🦁', gif: 'off', line: '', body: `**${z.points?.toLocaleString() ?? '?'}** zoo points · seen ${at(z.at)}${caught ? `\n-# Ever caught: ${caught}` : ''}`, fields })] });
  },
};

const fmt = (n: number) => Math.round(n).toLocaleString();
const days = (d: number) => (d < 1 ? '<1 day' : d < 1.5 ? '~1 day' : `~${Math.round(d)} days`);

// HuntBot xp a day for the team, from its exp trait and how long it actually hunts
function hbXpPerDay(store: Store, userId: string) {
  const a = huntbotAdvice(store, userId);
  const lvl = a?.h.traits.experience?.level;
  return a?.plan && lvl ? statOf('experience', lvl) * a.plan.hoursPerDay : 0;
}

// the HuntBot desk: where the essence should go, what to leave alone, and what to sell or sacrifice
export function huntbotAdvice(store: Store, userId: string) {
  const st = stateOf(store);
  const h = st.huntbot(userId);
  if (!h) return null;
  const T = h.traits;
  if (!T.efficiency || !T.duration || !T.cost || !T.gain) return { h, plan: null, lines: ['Run `w hb` for advice.'] };
  const levels: HbLevels = { efficiency: T.efficiency.level, duration: T.duration.level, cost: T.cost.level, gain: T.gain.level, experience: T.experience?.level ?? 0, radar: T.radar?.level ?? 0 };
  const progress = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, { progress: v!.progress, need: v!.need }])) as Partial<Record<HbTrait, { progress: number; need: number }>>;
  const bits = st.bits(userId);
  const cashBit = bits.get('cash');
  // cowoncy goes up and down all day, a reading older than a day says little
  const cash = cashBit && Date.now() - cashBit.at < 86_400_000 ? Number(cashBit.value) : null;
  const plan = advise({ levels, progress, essence: h.essence ?? 0, cash, checks: st.seenTimes(userId) });
  return { h, plan, cash, lines: [] as string[] };
}

function sellLines(store: Store, userId: string, cash: number | null, runCost: number) {
  const st = stateOf(store);
  const z = st.zoo(userId);
  if (!z) return ['Run `w zoo` first.'];
  const byRank = new Map<string, Hold>();
  for (const a of z.animals) {
    const r = byRank.get(a.rank) ?? { rank: a.rank, count: 0, animals: [] };
    r.count += a.count;
    r.animals.push({ animal: a.animal, count: a.count });
    byRank.set(a.rank, r);
  }
  const keep = new Set(st.teams(userId).flatMap((t) => t.animals));
  const p = sellPlan([...byRank.values()], cash, runCost, keep);
  const cmd = (verb: string, list: { rank: string; only?: { animal: string; count: number }[] }[]) => {
    const whole = list.filter((x) => !x.only).map((x) => x.rank);
    const one = list.flatMap((x) => x.only ?? []).slice(0, 6).map((a) => `\`w ${verb} ${a.animal} all\``);
    return [whole.length ? `\`w ${verb} ${whole.join(' ')}\`` : '', ...one].filter(Boolean).join(' · ');
  };
  const out: string[] = [];
  if (p.sell.length) out.push(`💰 Sell (**${fmt(p.sell.reduce((s, x) => s + x.cowoncy, 0))}** cowoncy): ${cmd('sell', p.sell)}`);
  if (p.sacrifice.length) out.push(`🔥 Sacrifice (**${fmt(p.sacrifice.reduce((s, x) => s + x.essence, 0))}** essence): ${cmd('sacrifice', p.sacrifice)}`);
  if (p.keep.length) out.push(`-# Keeping team pets: ${p.keep.slice(0, 8).join(', ')}`);
  if (!p.sell.length && !p.sacrifice.length) out.push('Nothing to sell or sacrifice.');
  return out;
}

const hbCmd: Command = {
  name: 'owohb',
  as: 'huntbot',
  group: 'owo',
  data: new SlashCommandBuilder().setName('huntbot').setDescription('Your HuntBot: what to upgrade next, what to skip, what to sell or sacrifice').toJSON(),
  text: { aliases: ['ohb'], noName: true },
  run: async (ctx, store) => {
    const a = huntbotAdvice(store, ctx.userId);
    if (!a) return ctx.reply('No HuntBot yet. Run `w hb`.');
    const { h, plan } = a;
    const status = `${h.backAt && h.backAt > Date.now() ? `🏃 Out hunting, back ${at(h.backAt)}` : '🏠 Home'} · essence **${fmt(h.essence ?? 0)}**`;
    if (!plan) return ctx.reply({ embeds: [card({ kind: 'help', title: 'Your HuntBot', emoji: '🤖', gif: 'off', line: '', body: `${status}\n${a.lines.join('\n')}` })] });
    const levels = Object.entries(h.traits).map(([k, t]) => `${cap(k)} **${t!.level}**`).join(' · ');
    const pace = `~${plan.hoursPerDay.toFixed(1)}h hunting a day${plan.measured ? '' : ' (estimate)'}`;

    const spend = plan.spend.length
      ? plan.spend.map((s) => `\`w upgrade ${upgradeWord(s.trait)} ${s.essence}\`${s.levels ? ` → **+${s.levels}** level${s.levels > 1 ? 's' : ''}` : ''}`).join('\n')
      : plan.ranked[0]
        ? `Save for **${cap(plan.ranked[0].trait)}** (${fmt(plan.ranked[0].cost)} essence).`
        : 'Keep the essence for now.';
    const best = plan.ranked.slice(0, 3).map((p, i) => `${i + 1}. **${cap(p.trait)}** · ${fmt(p.cost)} essence · pays back in ${days(p.payback)}`).join('\n') || 'Nothing yet.';
    const skip = plan.skip.map((s) => `**${cap(s.trait)}**: ${s.why}`).join('\n');
    const xp = plan.xp ? `\n-# Exp: ${fmt(plan.xp.cost)} essence → +${fmt(plan.xp.perDay)} pet xp/day` : '';
    const cashLine = plan.cashShort ? `\n⚠️ ${fmt(a.cash ?? 0)} cowoncy is short of a full run (${fmt(plan.runCost)}). Sell first.` : '';

    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'Your HuntBot', emoji: '🤖', gif: 'off', line: '',
      body: `${status}\n${levels}\n-# ${pace}${cashLine}`,
      fields: [
        { name: '🔧 Spend', value: spend.slice(0, 1024) },
        { name: '📈 Next best', value: (best + xp).slice(0, 1024) },
        { name: '🚫 Skip', value: skip.slice(0, 1024) || 'Nothing.' },
        { name: '💱 Sell or sacrifice', value: sellLines(store, ctx.userId, a.cash ?? null, plan.runCost).join('\n').slice(0, 1024) },
      ],
    })] });
  },
};

const forget: Command = {
  name: 'owoforget',
  as: 'forget',
  group: 'owo',
  data: new SlashCommandBuilder().setName('forget').setDescription('Wipe everything Texz has learnt about your OwO account')
    .addBooleanOption((o) => o.setName('sure').setDescription('Yes, wipe it')).toJSON(),
  text: { aliases: ['oforget'], noName: true, args: ['sure'] },
  run: async (ctx: Ctx, store: Store) => {
    if (ctx.bool('sure') || ctx.str('sure') === 'true' || ctx.str('sure') === 'yes') {
      stateOf(store).forget(ctx.userId);
      return ctx.reply({ content: '🧹 Your OwO data is wiped.', private: true });
    }
    return ctx.reply({
      embeds: [card({ kind: 'help', title: 'Forget your OwO account?', emoji: '🧹', gif: 'off', line: '', body: 'Wipes your saved OwO data from Texz. Your OwO account isn\'t touched.' })],
      components: [row(new ButtonBuilder().setCustomId(`nav|owoforget|owner=${ctx.userId},sure=yes`).setLabel('Forget it all').setEmoji('🧹').setStyle(ButtonStyle.Danger))],
      private: true,
    });
  },
};

const pick: Record<string, string> = { keep: '✅ Keep', stat: '🔁 Stat reroll', passive: '🔁 Passive reroll', locked: '🔒 Locked', unknown: '❔ Unsure' };

// one weapon in full: every number against its range, and whether it's worth shards
function weaponCard(store: Store, userId: string, id: string) {
  const st = stateOf(store);
  const w = st.weapons(userId).find((x) => x.id === id.toUpperCase());
  if (!w) return `Unknown weapon. Run \`w w ${id}\` first.`;
  const name = w.name ?? (w.type ? weaponOf(w.type).name : '?');
  if (!w.detailed) return `Run \`w w ${w.id}\` first.`;
  const ranges = rangesFrom(st);
  const r = report(ranges, { ...w, name });
  const tidy = (n: number) => (Math.abs(n) >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000);
  const lines = r.rolls.map((x) => {
    const cost = x.key.endsWith(':cost');
    const range = x.min !== null && x.max !== null ? ` · ${tidy(Math.min(x.min, x.max))}–${tidy(Math.max(x.min, x.max))}${cost ? ' (lower is better)' : ''}` : '';
    return `**${x.label}** ${x.value}${range}${x.roll !== null ? ` · **${Math.round(x.roll)}%**` : ''}`;
  });
  const fit = ranges.fit.get(name);
  const sure = r.sure && (fit?.samples ?? 0) >= 4 ? null : `Rough estimate, ${fit?.samples ?? 0} sample${(fit?.samples ?? 0) === 1 ? '' : 's'}`;
  const odds = r.advice.chance !== null && r.advice.kind === 'stat' && r.advice.shards ? ` (~${r.advice.shards.toLocaleString()} shards)` : '';
  return {
    embeds: [card({
      kind: 'help', title: `${name} · ${w.quality}%`, emoji: '🗡️', gif: 'off', line: '',
      body: `\`${w.id}\` · ${cap(w.rarity ?? '?')}${w.wear && w.wear !== 'worn' ? ` · ${cap(w.wear)}` : ''}${w.empowered ? ' · Empowered' : ''}${w.on ? ` · on ${w.on}` : ''}\n\n**${pick[r.advice.kind]}** · ${r.advice.why}${odds}`,
      fields: [{ name: 'Rolls', value: lines.join('\n') || '?', inline: false }],
    }).setFooter(sure ? { text: sure } : null)],
  };
}

const weaponCmd: Command = {
  name: 'owoweapon',
  as: 'weapon',
  group: 'owo',
  data: new SlashCommandBuilder().setName('weapon').setDescription('One OwO weapon in full: each number against its range and whether it is worth shards')
    .addStringOption((o) => o.setName('id').setDescription('The weapon ID, like G3JG6F').setRequired(true).setMinLength(6).setMaxLength(6)).toJSON(),
  text: { aliases: ['owep1', 'oweapon'], noName: true, args: ['id'] },
  run: async (ctx, store) => {
    const id = ctx.str('id');
    if (!id) return ctx.reply('Which one? `tz o weapon G3JG6F`');
    return ctx.reply(weaponCard(store, ctx.userId, id));
  },
};

const dismantle: Command = {
  name: 'owodismantle',
  as: 'dismantle',
  group: 'owo',
  data: new SlashCommandBuilder().setName('dismantle').setDescription('OwO weapons that are safe to dismantle for shards, and which to keep').toJSON(),
  text: { aliases: ['oscrap', 'odm'], noName: true },
  run: async (ctx, store) => {
    const all = stateOf(store).weapons(ctx.userId);
    if (!all.length) return ctx.reply('No weapons yet. Run `w weapon`.');
    const { safe, think, whole } = dismantleList(all);
    const shards = safe.reduce((n, x) => n + x.shards, 0);
    const ids = safe.slice(0, 15).map((x) => x.id);
    const fields = [];
    if (whole.length) fields.push({ name: 'By rarity', value: whole.map((r) => `\`w dismantle ${r[0]}w\``).join(' · '), inline: false });
    if (ids.length) fields.push({ name: `Safe · ${safe.length}`, value: safe.slice(0, 15).map((x) => `\`${x.id}\` ${x.name} ${x.quality}% · ${cap(x.rarity)} · ${x.shards} shards`).join('\n') + (safe.length > 15 ? `\n-# and ${safe.length - 15} more` : ''), inline: false });
    if (think.length) fields.push({ name: `Mythic spares · ${think.length}`, value: think.slice(0, 6).map((x) => `\`${x.id}\` ${x.name} ${x.quality}% · ${x.why}`).join('\n'), inline: false });
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'What can go', emoji: '♻️', gif: 'off', line: '',
      body: safe.length ? `~**${shards.toLocaleString()}** shards from ${safe.length} weapon${safe.length === 1 ? '' : 's'}.` : 'Nothing to scrap.',
      fields,
    })] });
  },
};

const rerollHelp: Command = {
  name: 'ororeroll',
  as: 'reroll',
  group: 'owo',
  data: new SlashCommandBuilder().setName('reroll').setDescription('Switch the live reroll check on or off for you')
    .addStringOption((o) => o.setName('state').setDescription('On or off').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })).toJSON(),
  text: { aliases: ['orr'], noName: true, args: ['state'] },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const now = st.bits(ctx.userId).get('rrhelp')?.value === 'off' ? 'off' : 'on';
    const want = (ctx.str('state') ?? (now === 'on' ? 'off' : 'on')).toLowerCase() === 'off' ? 'off' : 'on';
    st.setBit(ctx.userId, 'rrhelp', want);
    return ctx.reply(`🎲 Reroll check **${want}**.`);
  },
};

const pingsCmd: Command = {
  name: 'owopings',
  as: 'pings',
  group: 'owo',
  data: new SlashCommandBuilder().setName('pings').setDescription('Pick your OwO nudges: HuntBot back, new OwO day, captcha alarm')
    .addStringOption((o) => o.setName('what').setDescription('Which one').addChoices(...Object.entries(PINGS).map(([k, v]) => ({ name: v.label, value: k }))))
    .addStringOption((o) => o.setName('state').setDescription('On or off').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })).toJSON(),
  text: { aliases: ['opings', 'oping'], noName: true, args: ['what', 'state'] },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const what = ctx.str('what')?.toLowerCase() as PingKind | undefined;
    if (what && what in PINGS) {
      const now = pingsOf(st, ctx.userId)[what];
      const to = ctx.str('state') ? ctx.str('state')!.toLowerCase() !== 'off' : !now;
      setPing(store, ctx.userId, what, to);
    }
    const on = pingsOf(st, ctx.userId);
    const s = store.settings(ctx.userId);
    const where = (s.routes.owo ?? s.delivery) === 'dm' ? 'by DM' : 'in channel';
    const lines = (Object.keys(PINGS) as PingKind[]).map((k) => `${PINGS[k].emoji} **${PINGS[k].label}** · ${on[k] ? 'on' : 'off'}`);
    const buttons = (Object.keys(PINGS) as PingKind[]).map((k) => new ButtonBuilder()
      .setCustomId(`nav|owopings|owner=${ctx.userId},what=${k},state=${on[k] ? 'off' : 'on'}`)
      .setLabel(PINGS[k].label).setEmoji(PINGS[k].emoji).setStyle(on[k] ? ButtonStyle.Success : ButtonStyle.Secondary));
    return ctx.reply({
      embeds: [card({ kind: 'help', title: 'Your OwO pings', emoji: '🔔', gif: 'off', line: '', body: `${lines.join('\n')}\n-# Sent ${where}` })],
      components: [row(...buttons)],
    });
  },
};

const when = (ms: number) => `<t:${Math.floor(ms / 1000)}:d>`;
const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const rankWord: Record<string, string> = { unknown: 'other' };

const battlesCmd: Command = {
  name: 'owobattles',
  as: 'battles',
  group: 'owo',
  data: new SlashCommandBuilder().setName('battles').setDescription('Your battle log: win rate, xp, streaks and how long until each pet levels').toJSON(),
  text: { aliases: ['obattles', 'obt'], noName: true },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const b = battleStats(st, ctx.userId);
    if (!b.since) return ctx.reply('No battles logged yet.');
    const fields = b.windows.filter((w, i) => w.n && (i === 0 || w.n !== b.windows[i - 1].n)).map((w) => ({
      name: w.label,
      value: `**${w.n.toLocaleString()}** · won **${pctOf(w.won, w.n)}**\n${Math.round(w.xp / w.n).toLocaleString()} xp/battle\n${Math.round(w.n / w.days).toLocaleString()}/day`,
      inline: true,
    }));
    const pace = paceOf(st, ctx.userId, hbXpPerDay(store, ctx.userId));
    const tn = teamNow(st, ctx.userId);
    if (pace && tn.length) fields.push({
      name: '📈 Next level',
      value: tn.map((p) => { const f = forecast(tn, pace, p.animal, p.level + 1); return `**${p.name}** → ${p.level + 1}: ${f ? `${f.battles.toLocaleString()} battles (${days(f.days)})` : '?'}`; }).join('\n'),
      inline: false,
    });
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'Your battle log', emoji: '⚔️', gif: 'off', line: '',
      body: `🔥 Streak **${b.current ?? 0}** · best **${b.best ?? 0}**\n-# Since ${when(b.since)}`,
      fields,
    })] });
  },
};

const catchesCmd: Command = {
  name: 'owocatches',
  as: 'catches',
  group: 'owo',
  data: new SlashCommandBuilder().setName('catches').setDescription('Your catch log: rare catches, totals by rank and how lucky you have been').toJSON(),
  text: { aliases: ['ocatches', 'oc'], noName: true },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const c = catchStats(st, ctx.userId);
    const log = st.catches(ctx.userId, 12);
    if (!c.since) return ctx.reply('No catches logged yet.');
    const line = (list: [string, number][]) => list.map(([r, n]) => `${rankWord[r] ?? r} **${n.toLocaleString()}**`).join(' · ') || 'nothing yet';
    const luck = (list: { rank: string; got: number; expected: number }[]) => list.map((x) => `${cap(x.rank)} **${x.got}** / ${x.expected < 10 ? x.expected.toFixed(1) : Math.round(x.expected)} expected${x.expected >= 1 ? ` · ${Math.round((x.got / x.expected) * 100)}%` : ''}`).join('\n');
    const fields = [
      { name: `🏹 Hunts · ${c.hunts.toLocaleString()}`, value: line(c.hunt), inline: false },
      { name: '🤖 HuntBot', value: line(c.bot), inline: false },
    ];
    const lk = [luck(c.luckHunt) && `**Hunts**\n${luck(c.luckHunt)}`, luck(c.luckBot) && `**HuntBot**\n${luck(c.luckBot)}`].filter(Boolean).join('\n');
    if (lk) fields.push({ name: '🍀 Luck', value: lk.slice(0, 1024), inline: false });
    fields.push({ name: '✨ Rare catches', value: log.map((x) => `${x.rank ? `**${x.rank}**` : '**?**'} ${x.animal} · ${x.source === 'huntbot' ? 'HuntBot' : 'hunt'} ${at(x.at)}`).join('\n').slice(0, 1024) || 'None yet.', inline: false });
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'Your catch log', emoji: '🏹', gif: 'off', line: '',
      body: `-# Since ${when(c.since)}`,
      fields,
    })] });
  },
};

const xpCmd: Command = {
  name: 'owoxp',
  as: 'xp',
  group: 'owo',
  data: new SlashCommandBuilder().setName('xp').setDescription('Battles and days until a team pet reaches a level, at your pace')
    .addStringOption((o) => o.setName('pet').setDescription('Pet name or animal, like gowl'))
    .addIntegerOption((o) => o.setName('level').setDescription('Target level').setMinValue(2).setMaxValue(999)).toJSON(),
  text: { aliases: ['oxp'], noName: true, args: ['pet', 'level'] },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const tn = teamNow(st, ctx.userId);
    if (!tn.length) return ctx.reply('No team yet. Run `w team`.');
    const hb = hbXpPerDay(store, ctx.userId);
    const pace = paceOf(st, ctx.userId, hb);
    if (!pace) return ctx.reply('Need a few more logged battles first.');
    const q = ctx.str('pet')?.toLowerCase();
    const pick = q ? tn.filter((p) => p.animal.toLowerCase() === q || p.name.toLowerCase() === q) : tn;
    if (q && !pick.length) return ctx.reply(`\`${q}\` isn't on your team.`);
    const want = ctx.int('level');
    const top = Math.max(...tn.map((p) => p.level));
    const lines = pick.map((p) => {
      const targets = want ? [want] : [...new Set([p.level + 1, p.level < top ? top : p.level + 5, Math.ceil((p.level + 1) / 10) * 10 + (p.level % 10 === 9 ? 10 : 0)])].filter((t) => t > p.level).sort((a, b) => a - b);
      return `**${p.name}** · Lvl ${p.level}\n${targets.map((t) => { const f = forecast(tn, pace, p.animal, t); return `→ ${t}: ${f ? `${f.battles.toLocaleString()} battles · ${days(f.days)}` : 'too far'}`; }).join('\n')}`;
    });
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'Level forecast', emoji: '📈', gif: 'off', line: '',
      body: `${lines.join('\n\n')}\n\n-# ${Math.round(pace.xpPer)} xp/battle · ${Math.round(pace.perDay)} battles/day${hb ? ` · +${fmt(hb)} HuntBot xp/day` : ''}`,
    })] });
  },
};

const dexCmd: Command = {
  name: 'owodex',
  as: 'dex',
  group: 'owo',
  data: new SlashCommandBuilder().setName('dex').setDescription('An animal\'s base stats, or two side by side')
    .addStringOption((o) => o.setName('animal').setDescription('Animal name, like gowl').setRequired(true))
    .addStringOption((o) => o.setName('vs').setDescription('Second animal to compare'))
    .addIntegerOption((o) => o.setName('level').setDescription('Level to compare at, default 30').setMinValue(1).setMaxValue(999)).toJSON(),
  text: { aliases: ['odex', 'odx'], noName: true, args: ['animal', 'vs', 'level'] },
  run: async (ctx, store) => {
    const st = stateOf(store);
    let vs = ctx.str('vs');
    let level = ctx.int('level') ?? 30;
    // typed: tz o dex gowl gdeer 40, or tz o dex gowl 40
    if (vs && /^\d+$/.test(vs)) { level = Number(vs); vs = null; }
    const names = [ctx.str('animal'), vs].filter((x): x is string => !!x).map((x) => x.toLowerCase().replace(/^vs$/, ''));
    if (!names.length) return ctx.reply('Which animal? `tz o dex gowl`');
    const found = names.map((n) => st.dexFind(n));
    const missing = names.filter((_, i) => !found[i]);
    if (missing.length) return ctx.reply(`Not in the dex yet: ${missing.map((m) => `\`w dex ${m}\``).join(' · ')}`);
    const rows: [string, (s: ReturnType<typeof statsAt>) => number, boolean][] = [['❤️ HP', (s) => s.hp, false], ['💧 WP', (s) => s.wp, false], ['⚔️ STR', (s) => s.str, false], ['✨ MAG', (s) => s.mag, false], ['🛡️ PR', (s) => s.pr, true], ['🔮 MR', (s) => s.mr, true]];
    const at = found.map((d) => statsAt(d!, level));
    const fields = found.map((d, i) => ({
      name: `${d!.animal}${d!.rank ? ` · ${cap(d!.rank)}` : ''}`,
      value: rows.map(([label, get, pc], r) => {
        const v = get(at[i]);
        const other = found.length > 1 ? get(at[1 - i]) : null;
        const mark = other !== null && Math.round(v * 10) !== Math.round(other * 10) ? (v > other ? ' ▲' : ' ▼') : '';
        const base = [d!.hp, d!.wp, d!.str, d!.mag, d!.pr, d!.mr][r];
        return `${label} **${pc ? `${(v * 100).toFixed(1)}%` : Math.round(v).toLocaleString()}**${mark} · ${base}`;
      }).join('\n'),
      inline: true,
    }));
    return ctx.reply({ embeds: [card({ kind: 'help', title: found.length > 1 ? `${found[0]!.animal} vs ${found[1]!.animal}` : found[0]!.animal, emoji: '📖', gif: 'off', line: '', body: `-# At Lvl ${level} · base stat after the ·`, fields })] });
  },
};

const collectCmd: Command = {
  name: 'owocollect',
  as: 'collectibles',
  group: 'owo',
  data: new SlashCommandBuilder().setName('collectibles').setDescription('All your daily collectibles at once: what is done today and your streaks').toJSON(),
  text: { aliases: ['ocollect', 'ocl', 'collect'], noName: true },
  run: async (ctx, store) => {
    const list = collectibles(stateOf(store), ctx.userId);
    if (!list.length) return ctx.reply('No collectibles seen yet.');
    const left = list.filter((x) => !x.done);
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'Your collectibles', emoji: '🎀', gif: 'off', line: '',
      body: `${left.length ? `To do: ${left.map((x) => `\`${x.cmd}\``).join(' · ')}` : 'All done today.'}\n-# Resets <t:${Math.floor(nextOwoDay() / 1000)}:R>`,
      fields: list.map((x) => ({ name: `${x.done ? '✅' : '⬜'} ${x.label}`, value: x.line, inline: true })),
    })] });
  },
};

// wallpaper and pet pictures, kept a while so flipping back and forth doesn't fetch again
const picCache = new Map<string, Buffer>();
async function picture(url: string) {
  if (picCache.has(url)) return picCache.get(url)!;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!res?.ok) return null;
  const b = Buffer.from(await res.arrayBuffer());
  picCache.set(url, b);
  if (picCache.size > 80) picCache.delete(picCache.keys().next().value!);
  return b;
}

interface WallPrefs { title?: string; accent?: string; about?: string; level?: number }
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
const hexOf = (x: string) => {
  const m = x.trim().match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
};

const wallCmd: Command = {
  name: 'owowall',
  as: 'wallpaper',
  group: 'owo',
  data: new SlashCommandBuilder().setName('wallpaper').setDescription('See any OwO wallpaper behind your own profile before you buy it')
    .addIntegerOption((o) => o.setName('id').setDescription('Wallpaper number, like 248').setMinValue(201).setMaxValue(999))
    .addStringOption((o) => o.setName('title').setDescription('Your title under the name, - to clear').setMaxLength(60))
    .addStringOption((o) => o.setName('accent').setDescription('Name and title colour as a hex code, like #c8283c').setMaxLength(7))
    .addStringOption((o) => o.setName('about').setDescription('Your about me, - to clear').setMaxLength(150))
    .addIntegerOption((o) => o.setName('level').setDescription('Your OwO level').setMinValue(1).setMaxValue(9999)).toJSON(),
  text: { aliases: ['owp', 'owall'], noName: true, args: ['id', 'accent', 'title'] },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const bits = st.bits(ctx.userId);
    const prefs = { ...((bits.get('wallprefs')?.value ?? {}) as WallPrefs) };
    // typed: tz o wp 248 #c8283c No Longer Human
    let rawId = ctx.str('id');
    let accent = ctx.str('accent');
    let title = ctx.str('title');
    if (ctx.viaText) {
      // the number can be left out: tz o wp #c8283c No Longer Human
      if (rawId && !/^\d+$/.test(rawId)) { title = [accent, title].filter(Boolean).join(' ') || null; accent = rawId; rawId = null; }
      if (accent && !hexOf(accent)) { title = [accent, title].filter(Boolean).join(' '); accent = null; }
    }
    if (accent) {
      const h = hexOf(accent);
      if (!h) return ctx.reply('Use a hex colour, like `#c8283c`.');
      prefs.accent = h;
    }
    if (title) prefs.title = title.trim() === '-' ? '' : title.trim();
    const about = ctx.str('about');
    if (about) prefs.about = about.trim() === '-' ? '' : about.trim();
    const level = ctx.int('level');
    if (level) prefs.level = level;
    if (accent || title || about || level) st.setBit(ctx.userId, 'wallprefs', prefs);

    // every wallpaper OwO has, plus any newer ones seen in the shop
    const seen = new Map(st.wallpapers(ctx.userId).map((w) => [w.id, w]));
    const ids = [...new Set([...WALL_IDS, ...seen.keys()])].sort((x, y) => x - y);
    const want = ctx.int('id') ?? (Number(rawId) || null);
    const last = bits.get('wall:last')?.value as number | undefined;
    const equipped = [...seen.values()].find((w) => w.equipped)?.id;
    const id = want ?? last ?? equipped ?? ids[0];
    st.setBit(ctx.userId, 'wall:last', id);
    const known = seen.get(id);
    const img = await picture(known?.url ?? wallUrl(id));
    if (!img) return ctx.reply(`No wallpaper \`${id}\`.`);

    // the profile bits Texz knows: name, avatar, cookies, the newest team and its pets' pictures
    const team = st.teams(ctx.userId).sort((x, y) => y.at - x.at)[0];
    const pets = new Map(st.pets(ctx.userId).map((p) => [p.animal, p]));
    const m = ctx.member ?? (ctx.guild ? await ctx.guild.members.fetch(ctx.userId).catch(() => null) : null);
    const avatar = m ? await fetchAvatar(m.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 })) : null;
    const petPics = await Promise.all((team?.animals ?? []).map(async (a) => {
      const e = st.emojiOf(a);
      return { image: e ? await picture(`https://cdn.discordapp.com/emojis/${e.id}.png?size=64`) : null, label: a, level: pets.get(a)?.level ?? null };
    }));
    const cookies = bits.get('cookies')?.value;
    const png = await wallCard({
      wallpaper: img, avatar,
      name: (bits.get('owoName')?.value as string | undefined) ?? ctx.displayName,
      title: prefs.title ?? '', accent: prefs.accent ?? '#ffffff',
      level: prefs.level ?? null, rank: null, xp: null,
      cookies: typeof cookies === 'number' ? cookies : null,
      teamName: team?.name ?? 'Team', pets: petPics,
      about: prefs.about ?? "I'm just a plain human.", partner: null,
    });

    const n = ids.indexOf(id);
    const nav = (to: number, label: string, emoji: string) => new ButtonBuilder().setCustomId(`nav|owowall|owner=${ctx.userId},id=${ids[(to + ids.length) % ids.length]}`).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
    const edit = new ButtonBuilder().setCustomId(`nav|pick|owner=${ctx.userId},key=owowall,form=1,back=none`).setLabel('Title and colour').setEmoji('🎨').setStyle(ButtonStyle.Secondary);
    const p = known?.price ?? wallPrice(id);
    const price = known?.owned ? (known.equipped ? 'yours, on your profile' : 'yours') : typeof p === 'number' ? `${fmt(p)} cowoncy` : p === 'gone' ? 'not sold any more' : p === 'event' ? 'event only' : 'price not seen yet';
    const how = known?.owned ? `\`w wallpaper\` to put it on` : typeof p === 'number' ? `\`w buy ${id}\` to buy it` : '';
    return ctx.reply({
      content: `🖼️ **Wallpaper ${id}** · ${price}${how ? ` · ${how}` : ''}`,
      files: [new AttachmentBuilder(png, { name: `wallpaper-${id}.png` })],
      components: [row(nav(n - 10, '−10', '⏪'), nav(n - 1, 'Previous', '◀️'), nav(n + 1, 'Next', '▶️'), nav(n + 10, '+10', '⏩'), edit)],
      embeds: [],
    });
  },
};

export const owo: Module = {
  name: 'owo',
  label: 'OwO helper',
  about: 'Learns your OwO account from your normal commands and helps with teams, weapons and HuntBot',
  commands: [synced, team, weaponsCmd, weaponCmd, dismantle, rerollHelp, zooCmd, hbCmd, battlesCmd, xpCmd, dexCmd, catchesCmd, collectCmd, wallCmd, pingsCmd, forget],
};
