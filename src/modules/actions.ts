import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { report } from '../ops.js';

// hugs, pats, bonks and the rest, with an anime gif from nekos.best and a line in the Agency's voice

type Act = { emoji: string; past: string; lines: string[]; self?: string; solo?: string[]; back?: string };

// {a} is whoever did it, {b} whoever got it
const acts: Record<string, Act> = {
  hug: { emoji: '🤗', past: 'hugs', back: 'Hug back', lines: ['{a} wraps {b} in a hug. Kunikida pretends not to see, but writes it down anyway.', '{a} hugs {b}. Dazai says it\'s the closest thing to a cure he knows.', '{a} pulls {b} into a hug. The Agency approves, quietly.'], self: '{a} hugs themself. Dazai knows the feeling.' },
  pat: { emoji: '🫳', past: 'pats', back: 'Pat back', lines: ['{a} pats {b} on the head. Good work today, apparently.', '{a} gives {b} a pat. Atsushi would purr if he could.', '{a} pats {b}, slowly, like they earned it.'], self: '{a} pats their own head. Someone has to.' },
  cuddle: { emoji: '🫂', past: 'cuddles with', back: 'Cuddle back', lines: ['{a} cuddles up to {b}. The office sofa has never been this busy.', '{a} and {b}, cuddled up. Do not disturb, Kunikida\'s orders.'], self: '{a} cuddles a pillow. Close enough.' },
  poke: { emoji: '👉', past: 'pokes', back: 'Poke back', lines: ['{a} pokes {b}. Again. And again.', '{a} pokes {b} like Ranpo poking a case he already solved.'], self: '{a} pokes themself. Checking they\'re still real.' },
  bonk: { emoji: '🔨', past: 'bonks', back: 'Bonk back', lines: ['{a} bonks {b}. Straight to the corner.', '{a} bonks {b} with Kunikida\'s notebook. It\'s a heavy notebook.'], self: '{a} bonks themself. Self-discipline, Kunikida style.' },
  slap: { emoji: '🖐️', past: 'slaps', back: 'Slap back', lines: ['{a} slaps {b}. Chuuya would call that a warm-up.', '{a} slaps {b} across the room. Someone fetch Yosano.'], self: '{a} slaps themself awake. Respect.' },
  punch: { emoji: '👊', past: 'punches', back: 'Punch back', lines: ['{a} punches {b}. Gravity-assisted, probably.', '{a} lands one on {b}. Port Mafia rules apply.'], self: '{a} punches the air. The air lost.' },
  bite: { emoji: '😬', past: 'bites', back: 'Bite back', lines: ['{a} bites {b}. Feral behaviour, noted in the file.', '{a} chomps {b}. Atsushi\'s tiger is jealous.'], self: '{a} bites their own tongue. Wise.' },
  tickle: { emoji: '🤭', past: 'tickles', back: 'Tickle back', lines: ['{a} tickles {b} until they give up the case files.', '{a} attacks {b} with tickles. No mercy.'], self: '{a} tries to tickle themself. Doesn\'t work, never has.' },
  highfive: { emoji: '🙌', past: 'high-fives', back: 'High-five back', lines: ['{a} high-fives {b}. Case closed.', '{a} and {b} high-five. Soukoku energy.'], self: '{a} high-fives themself. Leaving nobody hanging.' },
  handhold: { emoji: '🤝', past: 'holds hands with', back: 'Hold on', lines: ['{a} holds {b}\'s hand. Scandalous, says the whole Agency.', '{a} takes {b}\'s hand. Dazai is already planning the double date.'], self: '{a} holds their own hand. A brave kind of independence.' },
  kiss: { emoji: '💋', past: 'kisses', back: 'Kiss back', lines: ['{a} kisses {b}. The Agency pretends to be very busy with paperwork.', '{a} plants one on {b}. Dazai demands to know why it wasn\'t him.'], self: '{a} kisses the mirror. Confidence.' },
  yeet: { emoji: '🫸', past: 'yeets', back: 'Yeet back', lines: ['{a} yeets {b} into the Yokohama bay. They\'ll float.', '{a} launches {b} out the Agency window. Again.'], self: '{a} yeets themself out of the conversation.' },
  wave: { emoji: '👋', past: 'waves at', back: 'Wave back', lines: ['{a} waves at {b}. Friendly, for once.', '{a} waves at {b} from across the bar.'], solo: ['{a} waves at everyone. Hello, Agency.'] },
  carry: { emoji: '🏋️', past: 'carries', back: 'Carry back', lines: ['{a} carries {b}, like Atsushi carrying a passed out Dazai.', '{a} scoops {b} up. Off to the next case.'], self: '{a} tries to carry themself. Physics says no.' },
  feed: { emoji: '🍙', past: 'feeds', back: 'Feed back', lines: ['{a} feeds {b}. Ochazuke, probably.', '{a} shares food with {b}. Kyouka approves if it\'s tofu.'], self: '{a} eats alone. Crab, hopefully.' },
  stare: { emoji: '👀', past: 'stares at', back: 'Stare back', lines: ['{a} stares at {b}. Ranpo-level suspicion.', '{a} is staring at {b} and not blinking.'], solo: ['{a} stares into the void. The void files a complaint.'] },
  baka: { emoji: '😤', past: 'calls out', back: 'Baka back', lines: ['{a} calls {b} a baka. Chuuya says it to Dazai daily.', '{a} looks at {b}: baka.'], self: '{a} calls themself a baka. Growth.' },
  cry: { emoji: '😭', past: 'cries', lines: [], solo: ['{a} is crying. Someone get the tissues, and Yosano just in case.', '{a} cries. Even Dazai has his moments.'] },
  blush: { emoji: '😳', past: 'blushes', lines: ['{a} blushes because of {b}. Very visible.'], solo: ['{a} is blushing. Caught red-handed.'] },
  dance: { emoji: '💃', past: 'dances', lines: ['{a} dances with {b}. Lupin\'s floor has seen worse.'], solo: ['{a} dances. Lupin turns the music up.', '{a} breaks into a dance. Nobody asked, everybody watches.'] },
  laugh: { emoji: '😂', past: 'laughs', lines: ['{a} laughs at {b}. Mercilessly.'], solo: ['{a} laughs. It\'s contagious.'] },
  smug: { emoji: '😏', past: 'smugs', lines: ['{a} looks smugly at {b}. Ranpo would be proud.'], solo: ['{a} looks very smug. Something was solved, or stolen.'] },
  sleep: { emoji: '😴', past: 'sleeps', lines: ['{a} falls asleep on {b}. Comfortable, apparently.'], solo: ['{a} is asleep. Do not wake them, Dazai\'s rules.'] },
  pout: { emoji: '😾', past: 'pouts', lines: ['{a} pouts at {b}. Fix it.'], solo: ['{a} is pouting. Someone owes them crab.'] },
  shrug: { emoji: '🤷', past: 'shrugs', lines: ['{a} shrugs at {b}. Not their problem.'], solo: ['{a} shrugs. Not my case, not my problem.'] },
  facepalm: { emoji: '🤦', past: 'facepalms', lines: ['{a} facepalms at {b}. Kunikida does this hourly.'], solo: ['{a} facepalms. Understandable.'] },
  tableflip: { emoji: '🙃', past: 'flips a table', lines: ['{a} flips a table at {b}. The Agency\'s furniture budget weeps.'], solo: ['{a} flips a table. (╯°□°)╯︵ ┻━┻'] },
  sip: { emoji: '🍵', past: 'sips tea', lines: ['{a} sips tea while watching {b}. Drama noted.'], solo: ['{a} sips their tea. Watching. Always watching.'] },
  nope: { emoji: '🙅', past: 'says nope', lines: ['{a} says nope to {b}. Firmly.'], solo: ['{a}: nope.'] },
  salute: { emoji: '🫡', past: 'salutes', lines: ['{a} salutes {b}. Yes, boss.'], solo: ['{a} salutes. Reporting for duty.'] },
};

// the ones in the slash menu, Discord takes 25 choices at most, the rest are typed: tz feed @x
const menu = ['hug', 'pat', 'cuddle', 'poke', 'bonk', 'slap', 'punch', 'bite', 'tickle', 'highfive', 'handhold', 'kiss', 'yeet', 'wave', 'carry', 'cry', 'blush', 'dance', 'laugh', 'smug', 'sleep', 'pout', 'shrug', 'facepalm', 'tableflip'];

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// one gif per call, a small stash per action so a slow API doesn't hold anyone up
const stash = new Map<string, { url: string; anime: string }[]>();
async function gifFor(action: string): Promise<{ url: string; anime: string } | null> {
  const have = stash.get(action) ?? [];
  if (have.length > 2) return have.splice(Math.floor(Math.random() * have.length), 1)[0];
  try {
    const r = await fetch(`https://nekos.best/api/v2/${action}?amount=8`, { headers: { 'User-Agent': 'Texz Discord bot (https://github.com/t4zc4t/texz)' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`nekos ${r.status}`);
    const j = await r.json() as { results: { url: string; anime_name?: string }[] };
    const fresh = j.results.map((x) => ({ url: x.url, anime: x.anime_name ?? '' }));
    stash.set(action, [...have, ...fresh].slice(-16));
    return stash.get(action)!.splice(0, 1)[0] ?? null;
  } catch (e) {
    report(`gif ${action}`, e);
    return have.shift() ?? null;
  }
}

// how many times one person did this to another in this server
function bump(store: Store, guild: string | null, from: string, to: string, action: string) {
  if (!guild || from === to) return 0;
  const k = `act:${guild}:${action}:${from}:${to}`;
  const n = Number(store.getKv(k) ?? 0) + 1;
  store.setKv(k, String(n));
  return n;
}

const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

async function perform(store: Store, guild: string | null, action: string, from: { id: string; name: string }, to: { id: string; name: string; bot: boolean } | null, botId: string) {
  const a = acts[action];
  const who = `**${from.name}**`;
  let line: string;
  let n = 0;
  if (!to) line = pick(a.solo ?? [`{a} ${a.past}.`]);
  else if (to.id === from.id) line = a.self ?? pick(a.solo ?? [`{a} ${a.past} themself.`]);
  else if (to.id === botId) line = pick([`{a} ${a.past} Texz. I'll allow it, just this once.`, `{a} ${a.past} Texz. Dazai would have dodged, I'm not that quick.`]);
  else { line = pick(a.lines.length ? a.lines : a.solo ?? ['{a} {b}']); n = bump(store, guild, from.id, to.id, action); }
  const text = line.replaceAll('{a}', who).replaceAll('{b}', to ? `**${to.name}**` : 'someone');
  const gif = await gifFor(action);
  const e = new EmbedBuilder().setColor(0xc8283c).setDescription(`${a.emoji} ${text}${n > 1 ? `\n-# That's the ${nth(n)} ${action} from ${from.name} to ${to!.name} here.` : ''}`);
  if (gif) e.setImage(gif.url).setFooter({ text: gif.anime ? `from ${gif.anime}` : 'nekos.best' });
  // whoever got it can send one straight back
  const rows = to && a.back && to.id !== from.id && to.id !== botId && !to.bot
    ? [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`act|${action}|${to.id}|${from.id}`).setLabel(a.back).setEmoji(a.emoji).setStyle(ButtonStyle.Secondary))]
    : [];
  return { embeds: [e], components: rows };
}

function run(action: string): Command['run'] {
  return async (ctx, store) => {
    const target = ctx.user('user');
    const member = target && ctx.guild ? await ctx.guild.members.fetch(target).catch(() => null) : null;
    if (target && ctx.guild && !member) return ctx.reply({ content: 'They\'re not in this server. The Agency only acts locally.', temp: true });
    const me = ctx.member?.displayName ?? ctx.displayName;
    const to = member ? { id: member.id, name: member.displayName, bot: member.user.bot } : null;
    const a = acts[action];
    if (!to && !a.solo) return ctx.reply({ content: `Who? Like this: \`tz ${action} @someone\``, temp: true });
    const out = await perform(store, ctx.guildId, action, { id: ctx.userId, name: me }, to, ctx.guild?.members.me?.id ?? '');
    return ctx.reply({ ...out, public: true, temp: false, ...(to ? { content: `<@${to.id}>`, ping: [to.id] } : {}) });
  };
}

// every action can be typed on its own, tz hug @someone, they just don't each get a slash command
const each: Command[] = Object.keys(acts).map((name) => ({
  name,
  group: 'fun',
  hidden: true,
  cooldown: 4,
  data: new SlashCommandBuilder().setName(name).setDescription(`${name[0].toUpperCase()}${name.slice(1)} someone, with an anime gif`)
    .addUserOption((o) => o.setName('user').setDescription('Who')).toJSON(),
  text: { args: ['user'] },
  run: run(name),
}));

const act: Command = {
  name: 'act',
  cooldown: 4,
  data: new SlashCommandBuilder().setName('act').setDescription('Hug, pat, bonk or slap someone, with an anime gif')
    .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true).addChoices(...menu.map((m) => ({ name: `${acts[m].emoji} ${m}`, value: m }))))
    .addUserOption((o) => o.setName('user').setDescription('Who, leave empty for the ones that work alone')).toJSON(),
  text: { aliases: ['action', 'interact'], args: ['action', 'user'] },
  example: 'hug @someone',
  hint: '`{p} hug @someone` · `/fun view:act input:hug @someone`\n-# swap hug for pat, cuddle, poke, bonk, slap, punch, bite, tickle, highfive, handhold, kiss, yeet, wave, carry, feed, stare or baka\n`{p} cry`\n-# works alone too: cry, blush, dance, laugh, smug, sleep, pout, shrug, facepalm, tableflip, sip, nope, salute',
  run: async (ctx, store) => {
    const action = (ctx.str('action') ?? '').toLowerCase();
    if (!acts[action]) return ctx.reply({ content: `Pick one of: ${Object.keys(acts).map((x) => `\`${x}\``).join(' ')}`, temp: true });
    return run(action)(ctx, store);
  },
};

export async function onAct(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('act|')) return false;
  const [, action, owner, other] = i.customId.split('|');
  if (i.user.id !== owner) { await i.reply({ content: 'That one\'s not addressed to you. Start your own with `tz hug @someone`.', flags: MessageFlags.Ephemeral }); return true; }
  if (!store.rules(i.guildId, 'actions').enabled) { await i.reply({ content: '🚫 Interactions are switched off here.', flags: MessageFlags.Ephemeral }); return true; }
  const me = i.guild ? await i.guild.members.fetch(owner).catch(() => null) : null;
  const them = i.guild ? await i.guild.members.fetch(other).catch(() => null) : null;
  // one reply per button, so the original keeps its gif and loses the button
  await i.update({ components: [] }).catch(() => {});
  const out = await perform(store, i.guildId, action, { id: owner, name: me?.displayName ?? i.user.displayName }, them ? { id: them.id, name: them.displayName, bot: them.user.bot } : null, i.client.user.id);
  if (i.channel?.isSendable()) await i.channel.send({ ...out, content: them ? `<@${them.id}>` : undefined, allowedMentions: { users: them ? [them.id] : [] } }).catch(() => {});
  return true;
}

export const actions: Module = {
  name: 'actions',
  label: 'Interactions',
  about: 'Hug, pat, bonk, slap and 25 more with anime gifs, a counter for each pair and a button to send one back',
  commands: [act, ...each],
};
