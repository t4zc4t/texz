import { AttachmentBuilder, SlashCommandBuilder, type Guild, type GuildMember, type Message } from 'discord.js';
import { fetchAvatar, rankCard } from '../features/rankcard.js';
import type { LevelRules, Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';

// xp needed to go from a level to the next one, the usual curve so early levels come quick
export const stepXp = (level: number) => 5 * level * level + 50 * level + 100;

export function levelOf(total: number) {
  let level = 0;
  let left = total;
  while (left >= stepXp(level)) { left -= stepXp(level); level++; }
  return { level, into: left, need: stepXp(level) };
}

export const totalFor = (level: number) => Array.from({ length: level }, (_, i) => stepXp(i)).reduce((a, b) => a + b, 0);

// Agency ranks, the title that comes with each band of levels
export const ranks = [
  { at: 0, name: 'Stray', emoji: '🐾' },
  { at: 3, name: 'Agency Visitor', emoji: '🚪' },
  { at: 6, name: 'Errand Runner', emoji: '📮' },
  { at: 10, name: 'Junior Detective', emoji: '🔍' },
  { at: 15, name: 'Field Investigator', emoji: '🕵️' },
  { at: 20, name: 'Senior Detective', emoji: '🧥' },
  { at: 30, name: 'Ability User', emoji: '✨' },
  { at: 40, name: 'Agency Elite', emoji: '🎖️' },
  { at: 50, name: 'Strategist', emoji: '♟️' },
  { at: 75, name: 'Living Legend of Yokohama', emoji: '🌉' },
];
export const rankFor = (level: number) => [...ranks].reverse().find((r) => level >= r.at)!;

// what each rank earns: a bit more xp, a bigger daily, extra giveaway chances, and a spot of its own in the member list
export const perks: Record<string, { xp: number; yen: number; tickets: number; hoist: boolean }> = {
  'Stray': { xp: 1, yen: 0, tickets: 1, hoist: false },
  'Agency Visitor': { xp: 1, yen: 10, tickets: 1, hoist: false },
  'Errand Runner': { xp: 1.05, yen: 20, tickets: 1, hoist: false },
  'Junior Detective': { xp: 1.05, yen: 30, tickets: 1, hoist: false },
  'Field Investigator': { xp: 1.1, yen: 40, tickets: 1, hoist: false },
  'Senior Detective': { xp: 1.1, yen: 60, tickets: 1, hoist: true },
  'Ability User': { xp: 1.15, yen: 80, tickets: 2, hoist: true },
  'Agency Elite': { xp: 1.2, yen: 100, tickets: 2, hoist: true },
  'Strategist': { xp: 1.25, yen: 150, tickets: 2, hoist: true },
  'Living Legend of Yokohama': { xp: 1.3, yen: 250, tickets: 3, hoist: true },
};
export const perksFor = (level: number) => perks[rankFor(level).name];
export const perkLine = (name: string) => {
  const p = perks[name];
  const bits = [p.xp > 1 && `+${Math.round((p.xp - 1) * 100)}% xp`, p.yen && `+¥${p.yen} daily`, p.tickets > 1 && `${p.tickets}x giveaway chance`, p.hoist && 'own spot in the member list'].filter(Boolean);
  return bits.join(' · ') || 'nothing yet, everyone starts somewhere';
};

// every multiplier that applies right now, so the rank card and /setup can show the same maths giveXp uses
export function boostsFor(l: LevelRules, member: GuildMember | null, channelId: string | null, parentId: string | null, now = Date.now()) {
  const parts: { why: string; x: number }[] = [];
  if (l.boost && now >= l.boost.from && now < l.boost.until) parts.push({ why: l.boost.name || 'Event', x: l.boost.x });
  const day = new Date(now).getUTCDay();
  if (l.weekend > 1 && (day === 0 || day === 6)) parts.push({ why: 'Weekend', x: l.weekend });
  // only the best role boost counts, stacking five booster roles would get silly fast
  const roleX = member ? Math.max(0, ...member.roles.cache.map((r) => l.roleBoosts[r.id] ?? 0)) : 0;
  if (roleX) parts.push({ why: 'Role', x: roleX });
  const chX = (channelId && l.channelBoosts[channelId]) || (parentId && l.channelBoosts[parentId]) || 0;
  if (chX) parts.push({ why: 'Channel', x: chX });
  const total = Math.min(10, parts.reduce((a, p) => a * p.x, 1));
  return { parts, total };
}

// which reward roles someone at this level should hold: only the highest one, or all of them when the server stacks them
export function rolesToKeep(rewards: Record<string, string>, level: number, stack: boolean): Set<string> {
  const earned = Object.entries(rewards).map(([lvl, id]) => ({ lvl: Number(lvl), id })).filter((r) => r.lvl <= level);
  if (stack) return new Set(earned.map((r) => r.id));
  const top = earned.sort((a, b) => b.lvl - a.lvl)[0];
  return new Set(top ? [top.id] : []);
}

// gives the earned reward role and takes the lower ones away, the new one is added first so nobody is left rankless
export async function syncRewards(member: GuildMember, l: LevelRules, level: number) {
  const keep = rolesToKeep(l.rewards, level, l.stack);
  const all = Object.values(l.rewards).filter((id) => member.guild.roles.cache.has(id));
  for (const id of all) if (keep.has(id) && !member.roles.cache.has(id)) await member.roles.add(id, `level ${level} reward`).catch(() => {});
  for (const id of all) if (!keep.has(id) && member.roles.cache.has(id)) await member.roles.remove(id, 'only the highest rank is kept').catch(() => {});
}

// with one rank role each, a higher rank has to carry every permission the ranks under it gave
export function carriedPerms(chain: bigint[]): bigint[] {
  let sum = 0n;
  return chain.map((p) => (sum |= p));
}
export async function carryRankPerms(guild: Guild, rewards: Record<string, string>) {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return;
  const ranked = Object.entries(rewards).map(([lvl, id]) => ({ lvl: Number(lvl), role: guild.roles.cache.get(id) }))
    .filter((x): x is { lvl: number; role: NonNullable<typeof x.role> } => !!x.role && x.role.position < me.roles.highest.position && !x.role.managed)
    .sort((a, b) => a.lvl - b.lvl);
  // a bot can only hand out permissions it has itself
  const want = carriedPerms(ranked.map((x) => x.role.permissions.bitfield & me.permissions.bitfield));
  for (const [n, x] of ranked.entries()) {
    const next = x.role.permissions.bitfield | want[n];
    if (next !== x.role.permissions.bitfield) await x.role.setPermissions(next, 'carries the lower rank perms').catch(() => {});
  }
}

// people holding more than the one rank role they should, from before only the highest was kept
export async function tidyRanks(store: Store, guild: Guild) {
  const l = store.guild(guild.id).levels;
  if (l.stack || Object.keys(l.rewards).length < 2) return 0;
  await guild.members.fetch().catch(() => null);
  const ids = new Set(Object.values(l.rewards));
  let fixed = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot || member.roles.cache.filter((r) => ids.has(r.id)).size < 2) continue;
    await syncRewards(member, l, levelOf(store.xpOf(guild.id, member.id).xp).level);
    fixed++;
  }
  return fixed;
}

export async function announce(store: Store, member: GuildMember, was: number, now: number, fallback: Message['channel'] | null) {
  const g = store.guild(member.guild.id);
  if (!g.levels.announce || now <= was) return;
  const oldRank = rankFor(was);
  const newRank = rankFor(now);
  const promoted = oldRank.name !== newRank.name;
  const vars = { user: `<@${member.id}>`, name: member.displayName, level: String(now), rank: newRank.name, server: member.guild.name };
  const e = card({
    kind: promoted ? 'rankUp' : 'levelUp', vars, line: g.levels.message ?? undefined,
    title: promoted ? `Promoted · ${newRank.name}` : `Level ${now}`,
    emoji: promoted ? newRank.emoji : '⬆️',
    // the dancing gif is saved for promotions so it doesn't show up every few minutes
    gif: promoted ? g.gifs.levelup ?? null : 'off',
  });
  const where = g.levels.channel ? await member.guild.channels.fetch(g.levels.channel).catch(() => null) : fallback;
  if (where?.isSendable()) await where.send({ content: `<@${member.id}>`, embeds: [e], allowedMentions: { users: [member.id] } }).catch(() => {});
}

// one message per cooldown counts, so spam doesn't climb faster than chatting
export async function giveXp(store: Store, m: Message) {
  if (!m.guild || m.author.bot || !m.member) return;
  if (!store.rules(m.guild.id, 'levels').enabled) return;
  const l = store.guild(m.guild.id).levels;
  const parentId = m.channel.isThread() ? m.channel.parentId : null;
  if (l.noXpChannels.includes(m.channelId) || (parentId && l.noXpChannels.includes(parentId))) return;
  if (m.member.roles.cache.some((r) => l.noXpRoles.includes(r.id))) return;
  const before = store.xpOf(m.guild.id, m.author.id);
  if (Date.now() - before.last_at < l.cooldown * 1000) return;
  const base = l.min + Math.floor(Math.random() * (Math.max(l.min, l.max) - l.min + 1));
  const rankX = perksFor(levelOf(before.xp).level).xp;
  const gain = Math.max(1, Math.round(base * boostsFor(l, m.member, m.channelId, parentId).total * rankX));
  store.addXp(m.guild.id, m.author.id, gain);
  const was = levelOf(before.xp).level;
  const now = levelOf(before.xp + gain).level;
  if (now <= was) return;
  await syncRewards(m.member, l, now);
  await announce(store, m.member, was, now, m.channel);
}

const rank: Command = {
  name: 'rank',
  group: 'levels',
  data: new SlashCommandBuilder().setName('rank').setDescription('Your level and Agency rank card')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['level', 'lvl'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Ranks live in servers.');
    const id = ctx.user('user') ?? ctx.userId;
    const m = await ctx.guild.members.fetch(id).catch(() => null);
    if (m?.user.bot) return ctx.reply('Bots don\'t get promoted. Trust me, I\'ve asked.');
    const { xp } = store.xpOf(ctx.guild.id, id);
    const l = levelOf(xp);
    const r = rankFor(l.level);
    const next = ranks.find((x) => x.at > l.level);
    const boost = boostsFor(store.guild(ctx.guild.id).levels, m, ctx.channelId, null);
    const png = await rankCard({
      name: m?.displayName ?? 'Agent', handle: m?.user.username ?? id, level: l.level, rank: r.name,
      avatar: m ? await fetchAvatar(m.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 })) : null,
      position: store.xpPosition(ctx.guild.id, xp), totalXp: xp, into: l.into, need: l.need,
      nextRank: next ? `${next.name} at ${next.at}` : null, boost: boost.total,
    });
    return ctx.reply({ files: [new AttachmentBuilder(png, { name: 'rank.png' })], private: false });
  },
};

const levels: Command = {
  name: 'levels',
  group: 'levels',
  as: 'top',
  data: new SlashCommandBuilder().setName('levels').setDescription('The server\'s top 10 by level').toJSON(),
  text: { aliases: ['ranks', 'xplb'] },
  run: (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Ranks live in servers.');
    const rows = store.xpBoard(ctx.guildId);
    const medal = ['🥇', '🥈', '🥉'];
    const body = rows.length
      ? rows.map((x, i) => {
          const l = levelOf(x.xp);
          return `${medal[i] ?? `\`#${i + 1}\``} <@${x.user_id}> · lvl **${l.level}** · ${rankFor(l.level).emoji} ${rankFor(l.level).name}`;
        }).join('\n')
      : 'Nobody has said a word yet. A quiet Agency. Suspicious.';
    return ctx.reply({ embeds: [card({ kind: 'levels', title: 'Agency roster', emoji: '📜', gif: 'off', body })], private: false });
  },
};

const perksCmd: Command = {
  name: 'perks',
  group: 'levels',
  data: new SlashCommandBuilder().setName('perks').setDescription('What every Agency rank earns, and where you are').toJSON(),
  text: { aliases: ['rankperks'] },
  run: (ctx, store) => {
    const lvl = ctx.guildId ? levelOf(store.xpOf(ctx.guildId, ctx.userId).xp).level : 0;
    const mine = rankFor(lvl).name;
    const body = ranks.map((r) => `${r.name === mine ? '▶️' : r.emoji} **${r.name}** · lvl ${r.at}\n-# ${perkLine(r.name)}`).join('\n');
    return ctx.reply({ embeds: [card({ kind: 'levelSetup', title: 'Agency ranks and perks', emoji: '🎖️', gif: 'off', body, fields: [{ name: 'You', value: `${mine} · level ${lvl}`, inline: true }] })] });
  },
};

const xp: Command = {
  name: 'xp',
  group: 'levels',
  admin: true,
  data: new SlashCommandBuilder().setName('xp').setDescription('Hand out, take or reset xp (admins)')
    .addSubcommand((c) => c.setName('give').setDescription('Add xp to someone')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(1_000_000)))
    .addSubcommand((c) => c.setName('take').setDescription('Take xp away')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(1_000_000)))
    .addSubcommand((c) => c.setName('level').setDescription('Put someone at an exact level')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
      .addIntegerOption((o) => o.setName('level').setDescription('Which level').setRequired(true).setMinValue(0).setMaxValue(500)))
    .addSubcommand((c) => c.setName('reset').setDescription('Wipe one person, or everyone with confirm: wipe')
      .addUserOption((o) => o.setName('user').setDescription('Who, empty means the whole server'))
      .addStringOption((o) => o.setName('confirm').setDescription('Type wipe to reset the whole server')))
    .toJSON(),
  text: { sub: true, subArgs: { give: ['user', 'amount'], take: ['user', 'amount'], level: ['user', 'level'], reset: ['user', 'confirm'] } },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Xp lives in servers.');
    const sub = ctx.sub();
    const p = store.guild(ctx.guild.id).prefix;
    const userId = ctx.user('user');
    if (sub === 'reset' && !userId) {
      // the text form can't tell "wipe" from a user, so accept it in either slot
      if ((ctx.str('confirm') ?? (ctx.viaText ? ctx.str('user') : null))?.toLowerCase() !== 'wipe') return ctx.reply(`That clears everyone's xp. If you mean it: \`/xp reset confirm:wipe\` or \`${p} xp reset wipe\`.`);
      store.resetXp(ctx.guild.id);
      return ctx.reply({ content: '🧹 Fresh start, every file in the roster is blank again. Reward roles stay until people level past them or you remove them.', temp: true });
    }
    if (!sub || !['give', 'take', 'level', 'reset'].includes(sub) || !userId) {
      return ctx.reply(`Like this: \`${p} xp give @user 500\`, \`${p} xp take @user 200\`, \`${p} xp level @user 10\`, \`${p} xp reset @user\``);
    }
    const before = store.xpOf(ctx.guild.id, userId).xp;
    let after = before;
    if (sub === 'give' || sub === 'take') {
      const n = ctx.int('amount');
      if (!n || n < 1) return ctx.reply('How much? A positive number please.');
      after = Math.max(0, before + (sub === 'give' ? n : -n));
    }
    if (sub === 'level') {
      const lvl = ctx.int('level');
      if (lvl === null || lvl < 0 || lvl > 500) return ctx.reply('Pick a level from 0 to 500.');
      after = totalFor(lvl);
    }
    if (sub === 'reset') after = 0;
    if (after === 0) store.resetXp(ctx.guild.id, userId);
    else store.setXp(ctx.guild.id, userId, after);
    const was = levelOf(before).level;
    const now = levelOf(after).level;
    const member = await ctx.guild.members.fetch(userId).catch(() => null);
    if (member) {
      await syncRewards(member, store.guild(ctx.guild.id).levels, now);
      if (now > was) await announce(store, member, was, now, null);
    }
    const diff = after - before;
    return ctx.reply({ content: `🖋️ <@${userId}> · ${before.toLocaleString()} → **${after.toLocaleString()} xp** (${diff >= 0 ? '+' : ''}${diff.toLocaleString()}) · level ${was} → **${now}** ${rankFor(now).emoji} ${rankFor(now).name}`, temp: true });
  },
};

export const levelsModule: Module = {
  name: 'levels',
  label: 'Levels and ranks',
  about: 'Chat xp and Agency ranks from Stray to Living Legend. Reward roles, xp rates, boosts and no-xp zones are in /setup, admins move xp with /levels view:xp',
  commands: [rank, levels, perksCmd, xp],
};


// rank roles in level order, highest rank right under Texz. Discord shifts every role when one moves,
// so the whole order is worked out first and sent in one go, then checked, and tried once more if it slipped
export async function fixRankOrder(guild: Guild, rewards: Record<string, string>): Promise<boolean> {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return false;
  await guild.roles.fetch().catch(() => null);
  const ceiling = me.roles.highest.position;
  const ranked = Object.entries(rewards).map(([lvl, id]) => ({ lvl: Number(lvl), role: guild.roles.cache.get(id) }))
    .filter((x): x is { lvl: number; role: NonNullable<typeof x.role> } => !!x.role && x.role.position < ceiling && !x.role.managed)
    .sort((a, b) => a.lvl - b.lvl);
  if (ranked.length < 2) return true;
  const ids = new Set(ranked.map((x) => x.role.id));
  const inOrder = () => ranked.every((x, n) => n === 0 || x.role.position > ranked[n - 1].role.position);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (inOrder() && ranked.at(-1)!.role.position === ceiling - 1) return true;
    // everything below Texz from the bottom up, the rank roles taken out and put back on top in level order
    const below = [...guild.roles.cache.values()].filter((r) => r.position < ceiling && r.id !== guild.id).sort((a, b) => a.position - b.position);
    const order = [...below.filter((r) => !ids.has(r.id)), ...ranked.map((x) => x.role)];
    await guild.roles.setPositions(order.map((r, n) => ({ role: r.id, position: n + 1 }))).catch(() => null);
    await guild.roles.fetch().catch(() => null);
  }
  return inOrder();
}
