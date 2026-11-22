import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import type { Ctx } from '../core/ctx.js';
import type { Command, Module } from '../core/module.js';
import type { Store } from '../db.js';
import { card } from '../theme.js';
import { passiveOf, weaponOf } from '../owo/catalog.js';
import { OwoState } from '../owo/state.js';
import { dismantleList, rangesFrom, report, SHARDS } from '../owo/advice.js';

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
    { name: '🗡️ Weapons', value: weapons.length ? `${weapons.length} known · ${detailed} with full numbers · seen ${at(Math.max(...weapons.map((w) => w.seenAt)))}` : 'not yet, run `w weapon` and flip through the pages' },
    { name: '🦁 Zoo', value: zoo ? `${zoo.animals.length} animals · ${zoo.points?.toLocaleString() ?? '?'} points · seen ${at(zoo.at)}` : 'not yet, run `w zoo`' },
    { name: '🤖 HuntBot', value: hb ? `${hb.backAt && hb.backAt > Date.now() ? `back ${at(hb.backAt)}` : 'home'} · seen ${at(hb.at)}` : 'not yet, run `w hb`' },
    { name: '💎 Shards', value: bits.has('shards') ? `${(bits.get('shards')!.value as number).toLocaleString()} · seen ${at(bits.get('shards')!.at)}` : 'not yet, run `w ws`' },
  ];
}

export function owoGlance(store: Store, userId: string) {
  const st = stateOf(store);
  const known = [st.teams(userId).length ? 'team' : '', st.weapons(userId).length ? `${st.weapons(userId).length} weapons` : '', st.zoo(userId) ? 'zoo' : '', st.huntbot(userId) ? 'HuntBot' : ''].filter(Boolean);
  const hb = st.huntbot(userId);
  if (!known.length) return 'Nothing synced yet. Just play: `w team`, `w zoo`, `w hb` and `w weapon` teach me your account.';
  return `📡 Synced: ${known.join(', ')}${hb?.backAt && hb.backAt > Date.now() ? ` · 🤖 HuntBot back ${at(hb.backAt)}` : ''}`;
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
      body: 'I learn your account by watching your normal OwO commands, nothing to type in. Anything missing below, run the command once and it fills in.\n-# I only read, I never send OwO commands or press anything for you.',
      fields: syncLines(store, ctx.userId).map((f) => ({ ...f, inline: false })),
    })],
  }),
};

const team: Command = {
  name: 'owoteam',
  as: 'team',
  group: 'owo',
  data: new SlashCommandBuilder().setName('team').setDescription('Your OwO teams with levels, stats, xp to the next level and weapons').toJSON(),
  text: { aliases: ['oteam'], noName: true },
  run: async (ctx, store) => {
    const st = stateOf(store);
    const teams = st.teams(ctx.userId);
    if (!teams.length) return ctx.reply('No team yet. Run `w team` once and I\'ll have it.');
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
    return ctx.reply({ embeds: [card({ kind: 'help', title: 'Your OwO teams', emoji: '🐾', gif: 'off', line: '', body: '-# From your last `w team`. Team building advice comes here soon.', fields })] });
  },
};

const PAGE = 10;
const weaponsCmd: Command = {
  name: 'owoweapons',
  as: 'weapons',
  group: 'owo',
  data: new SlashCommandBuilder().setName('weapons').setDescription('Every OwO weapon Texz knows about, best first, with passives and who holds it').toJSON(),
  text: { aliases: ['oweapons', 'owep'], noName: true },
  run: async (ctx, store) => {
    const all = stateOf(store).weapons(ctx.userId);
    if (!all.length) return ctx.reply('No weapons yet. Run `w weapon` and flip through the pages, I\'ll remember them.');
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
    e.setFooter({ text: `${pages > 1 ? `Page ${n + 1} of ${pages} · ` : ''}${all.length} weapons · tz o weapon {id} for one in full` });
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
    if (!z) return ctx.reply('No zoo yet. Run `w zoo` once and I\'ll have it.');
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

const hbCmd: Command = {
  name: 'owohb',
  as: 'huntbot',
  group: 'owo',
  data: new SlashCommandBuilder().setName('huntbot').setDescription('Your HuntBot: trait levels, essence, the biggest run and when it is back').toJSON(),
  text: { aliases: ['ohb'], noName: true },
  run: async (ctx, store) => {
    const h = stateOf(store).huntbot(ctx.userId);
    if (!h) return ctx.reply('No HuntBot yet. Run `w hb` once and I\'ll have it.');
    const fields = Object.entries(h.traits).map(([k, t]) => ({ name: cap(k), value: `Lvl **${t!.level}**${t!.value ? ` · ${t!.value}` : ''}\n-# ${pct(t!.progress, t!.need)}% to the next level`, inline: true }));
    const run = h.maxRun ? `\nBiggest run: **${h.maxRun.animals.toLocaleString()}** animals, ${h.maxRun.essence.toLocaleString()} essence and ${h.maxRun.xp.toLocaleString()} xp for ${h.maxRun.cost.toLocaleString()} cowoncy` : '';
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'Your HuntBot', emoji: '🤖', gif: 'off', line: '',
      body: `${h.backAt && h.backAt > Date.now() ? `🏃 Out hunting, back ${at(h.backAt)}` : '🏠 Home'} · essence **${(h.essence ?? 0).toLocaleString()}**${run}\n-# Seen ${at(h.at)}. Upgrade advice comes here soon.`,
      fields,
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
      return ctx.reply({ content: '🧹 Done. Everything I knew about your OwO account is gone. Playing again teaches me again.', private: true });
    }
    return ctx.reply({
      embeds: [card({ kind: 'help', title: 'Forget your OwO account?', emoji: '🧹', gif: 'off', line: '', body: 'This wipes your saved teams, pets, weapons, zoo, HuntBot and battle history from Texz. Your actual OwO account is not touched.' })],
      components: [row(new ButtonBuilder().setCustomId(`nav|owoforget|owner=${ctx.userId},sure=yes`).setLabel('Forget it all').setEmoji('🧹').setStyle(ButtonStyle.Danger))],
      private: true,
    });
  },
};

const pick: Record<string, string> = { keep: '✅ Keep it as it is', stat: '🔁 Worth a stat reroll', passive: '🔁 Worth a passive reroll', locked: '🔒 Can\'t be rerolled', unknown: '❔ Not sure yet' };

// one weapon in full: every number against its range, and whether it's worth shards
function weaponCard(store: Store, userId: string, id: string) {
  const st = stateOf(store);
  const w = st.weapons(userId).find((x) => x.id === id.toUpperCase());
  if (!w) return `I don't know \`${id}\` yet. Run \`w w ${id}\` once and ask again.`;
  const name = w.name ?? (w.type ? weaponOf(w.type).name : '?');
  if (!w.detailed) return `I only know \`${w.id}\` from your weapon list. Run \`w w ${w.id}\` once so I see its numbers.`;
  const ranges = rangesFrom(st);
  const r = report(ranges, { ...w, name });
  const tidy = (n: number) => (Math.abs(n) >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000);
  const lines = r.rolls.map((x) => {
    const cost = x.key.endsWith(':cost');
    const range = x.min !== null && x.max !== null ? ` · range ${tidy(Math.min(x.min, x.max))}–${tidy(Math.max(x.min, x.max))}${cost ? ', lower is better' : ''}` : '';
    return `**${x.label}** ${x.value}${range} · ${x.roll !== null ? `rolled **${Math.round(x.roll)}%**` : 'range not learnt yet'}`;
  });
  const fit = ranges.fit.get(name);
  const sure = r.sure && (fit?.samples ?? 0) >= 4 ? `Ranges checked against ${fit!.samples} ${name}s` : `Rough: I've only seen ${fit?.samples ?? 0} ${name}${(fit?.samples ?? 0) === 1 ? '' : 's'} with full numbers so far`;
  const odds = r.advice.chance !== null && r.advice.kind === 'stat' && r.advice.shards ? `\n-# About ${r.advice.shards.toLocaleString()} shards on average for that.` : '';
  return {
    embeds: [card({
      kind: 'help', title: `${name} · ${w.quality}%`, emoji: '🗡️', gif: 'off', line: '',
      body: `\`${w.id}\` · ${cap(w.rarity ?? '?')}${w.wear && w.wear !== 'worn' ? ` · ${cap(w.wear)}` : ''}${w.empowered ? ' · Empowered' : ''}${w.on ? ` · held by ${w.on}` : ''}\n\n**${pick[r.advice.kind]}**\n${r.advice.why}${odds}`,
      fields: [{ name: 'Its numbers', value: lines.join('\n') || '?', inline: false }],
    }).setFooter({ text: `${sure} · quality is only compared within the same weapon` })],
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
    if (!all.length) return ctx.reply('No weapons yet. Run `w weapon` and flip through every page once.');
    const { safe, think, whole } = dismantleList(all);
    const shards = safe.reduce((n, x) => n + x.shards, 0);
    const ids = safe.slice(0, 15).map((x) => x.id);
    const fields = [];
    if (whole.length) fields.push({ name: 'One command per rarity', value: whole.map((r) => `\`w dismantle ${r[0]}w\` · every ${r} you have can go`).join('\n') + '\n-# OwO skips weapons on a pet and favourites by itself.', inline: false });
    if (ids.length) fields.push({ name: `Safe to dismantle · ${safe.length}`, value: safe.slice(0, 15).map((x) => `\`${x.id}\` ${x.name} ${x.quality}% · ${cap(x.rarity)} · ${x.shards} shards`).join('\n') + (safe.length > 15 ? `\n-# and ${safe.length - 15} more` : ''), inline: false });
    if (think.length) fields.push({ name: `Mythic spares · think first · ${think.length}`, value: think.slice(0, 6).map((x) => `\`${x.id}\` ${x.name} ${x.quality}% · ${x.why}`).join('\n') + `\n-# ${SHARDS.mythic} shards each, but a spare mythic can be the right weapon for a new pet.`, inline: false });
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'What can go', emoji: '♻️', gif: 'off', line: '',
      body: safe.length ? `About **${shards.toLocaleString()}** shards from ${safe.length} weapon${safe.length === 1 ? '' : 's'} you won't miss.\n-# Kept no matter what: weapons on a pet, favourites, empowered ones, Pristine and Fine wear, Legendary and up, and your best two of every weapon type.` : 'Nothing worth scrapping right now. Everything left is either in use, protected or one of your best two of its kind.',
      fields,
    }).setFooter({ text: `From what I've seen of your weapons · run w weapon and flip every page to refresh` })] });
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
    return ctx.reply(want === 'on' ? '🎲 Reroll check is **on**. When you reroll a weapon I\'ll say confirm or cancel and when to stop.' : '🎲 Reroll check is **off**. `tz o reroll on` brings it back.');
  },
};

export const owo: Module = {
  name: 'owo',
  label: 'OwO helper',
  about: 'Learns your OwO account from your normal commands and helps with teams, weapons and HuntBot',
  commands: [synced, team, weaponsCmd, weaponCmd, dismantle, rerollHelp, zooCmd, hbCmd, forget],
};
