import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type Message } from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { bar, card } from '../theme.js';

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

const COOLDOWN = 60_000;

// one message a minute counts, 15 to 25 xp each, so spam doesn't climb faster than chatting
export async function giveXp(store: Store, m: Message) {
  if (!m.guild || m.author.bot || !m.member) return;
  if (!store.rules(m.guild.id, 'levels').enabled) return;
  const before = store.xpOf(m.guild.id, m.author.id);
  if (Date.now() - before.last_at < COOLDOWN) return;
  const gain = 15 + Math.floor(Math.random() * 11);
  store.addXp(m.guild.id, m.author.id, gain);
  const was = levelOf(before.xp).level;
  const now = levelOf(before.xp + gain).level;
  if (now <= was) return;

  const g = store.guild(m.guild.id);
  // reward roles for every level reached so far
  for (const [lvl, roleId] of Object.entries(g.levels.rewards)) {
    if (now >= Number(lvl) && !m.member.roles.cache.has(roleId)) await m.member.roles.add(roleId, `level ${lvl}`).catch(() => {});
  }
  if (!g.levels.announce) return;
  const oldRank = rankFor(was);
  const newRank = rankFor(now);
  const promoted = oldRank.name !== newRank.name;
  const vars = { user: `<@${m.author.id}>`, level: String(now), rank: newRank.name };
  const e = card({
    kind: promoted ? 'rankUp' : 'levelUp', vars, title: promoted ? `Promoted · ${newRank.name}` : `Level ${now}`,
    emoji: promoted ? newRank.emoji : '⬆️',
    // the dancing gif is saved for promotions so it doesn't show up every few minutes
    gif: promoted ? g.gifs.levelup ?? null : 'off',
  });
  const where = g.levels.channel ? await m.guild.channels.fetch(g.levels.channel).catch(() => null) : m.channel;
  if (where?.isSendable()) await where.send({ content: `<@${m.author.id}>`, embeds: [e], allowedMentions: { users: [m.author.id] } }).catch(() => {});
}

const rank: Command = {
  name: 'rank',
  data: new SlashCommandBuilder().setName('rank').setDescription('Your level and Agency rank in this server')
    .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')).toJSON(),
  text: { aliases: ['level', 'lvl', 'xp'], args: ['user'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Ranks live in servers.');
    const id = ctx.user('user') ?? ctx.userId;
    const m = await ctx.guild.members.fetch(id).catch(() => null);
    const { xp } = store.xpOf(ctx.guild.id, id);
    const l = levelOf(xp);
    const r = rankFor(l.level);
    const next = ranks.find((x) => x.at > l.level);
    const e = card({
      kind: 'rank', title: `${m?.displayName ?? 'Agent'} · ${r.name}`, emoji: r.emoji, gif: 'off',
      fields: [
        { name: '📈 Level', value: `**${l.level}**`, inline: true },
        { name: '🏅 Position', value: `#${store.xpPosition(ctx.guild.id, xp)}`, inline: true },
        { name: '✨ Total xp', value: xp.toLocaleString(), inline: true },
        { name: `To level ${l.level + 1}`, value: `${bar(l.into, l.need, 16)}\n${l.into.toLocaleString()} / ${l.need.toLocaleString()} xp`, inline: false },
        { name: '🎖️ Next promotion', value: next ? `${next.emoji} **${next.name}** at level ${next.at}` : 'None left. You\'ve outranked everyone, me included. Well, almost.', inline: false },
      ],
    });
    if (m) e.setThumbnail(m.displayAvatarURL({ size: 256, forceStatic: false }));
    return ctx.reply({ embeds: [e], private: false });
  },
};

const levels: Command = {
  name: 'levels',
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

export const levelsModule: Module = {
  name: 'levels',
  label: 'Levels and ranks',
  about: 'Chat xp and Agency ranks from Stray to Living Legend. Reward roles and the level-up channel are in /setup',
  commands: [rank, levels],
};

