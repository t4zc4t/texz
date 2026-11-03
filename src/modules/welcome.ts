import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, SlashCommandBuilder,
  type GuildMember, type Interaction, type MessageActionRowComponentBuilder, type PartialGuildMember,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card, say } from '../theme.js';

// {user} {name} {server} {count} work in custom messages
export function fill(text: string, m: GuildMember | PartialGuildMember) {
  return text
    .replaceAll('{user}', `<@${m.id}>`)
    .replaceAll('{name}', m.displayName ?? m.user?.username ?? 'someone')
    .replaceAll('{server}', m.guild.name)
    .replaceAll('{count}', String(m.guild.memberCount));
}

export function welcomeCard(store: Store, m: GuildMember) {
  const w = store.guild(m.guild.id).welcome;
  const custom = store.guild(m.guild.id).gifs.welcome;
  // Texz's own greeting rides in the quote line, a custom message goes underneath
  const e = card({
    kind: 'welcome', title: `Welcome, ${m.displayName}`, emoji: '🌸', gif: custom ?? null,
    vars: { user: `<@${m.id}>`, server: m.guild.name, count: String(m.guild.memberCount) },
    body: w.message ? fill(w.message, m) : undefined,
    fields: [
      { name: '👥 Member', value: `#${m.guild.memberCount}`, inline: true },
      { name: '🎂 Account made', value: `<t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`, inline: true },
    ],
  });
  e.setThumbnail(m.displayAvatarURL({ size: 256, forceStatic: false }));
  return e;
}

export async function onJoin(store: Store, m: GuildMember) {
  const w = store.guild(m.guild.id).welcome;
  if (w.autorole) await m.roles.add(w.autorole, 'autorole').catch(() => {});
  if (!w.channel) return;
  const ch = await m.guild.channels.fetch(w.channel).catch(() => null);
  if (ch?.isSendable()) await ch.send({ content: `<@${m.id}>`, embeds: [welcomeCard(store, m)], allowedMentions: { users: [m.id] } }).catch(() => {});
}

export async function onLeave(store: Store, m: GuildMember | PartialGuildMember) {
  const w = store.guild(m.guild.id).welcome;
  if (!w.goodbyeChannel) return;
  const ch = await m.guild.channels.fetch(w.goodbyeChannel).catch(() => null);
  const name = `**${m.displayName ?? m.user?.username ?? 'someone'}**`;
  const text = w.goodbyeMessage ? fill(w.goodbyeMessage, m).replaceAll(`<@${m.id}>`, name) : undefined;
  if (ch?.isSendable()) {
    await ch.send({ embeds: [card({ kind: 'goodbye', title: 'Gone', emoji: '🍂', gif: store.guild(m.guild.id).gifs.goodbye ?? null, vars: { user: name, server: m.guild.name }, body: text })] }).catch(() => {});
  }
}

const rolepicker: Command = {
  name: 'rolepicker',
  admin: true,
  data: new SlashCommandBuilder().setName('rolepicker').setDescription('Post buttons people press to get or drop roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false)
    .addStringOption((x) => x.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
    .addRoleOption((x) => x.setName('role1').setDescription('Role').setRequired(true))
    .addRoleOption((x) => x.setName('role2').setDescription('Role'))
    .addRoleOption((x) => x.setName('role3').setDescription('Role'))
    .addRoleOption((x) => x.setName('role4').setDescription('Role'))
    .addRoleOption((x) => x.setName('role5').setDescription('Role'))
    .addStringOption((x) => x.setName('about').setDescription('A line under the title').setMaxLength(300)).toJSON(),
  run: async (ctx) => {
    if (!ctx.guild) return ctx.reply('Server only.');
    const me = await ctx.guild.members.fetchMe();
    const ids = ['role1', 'role2', 'role3', 'role4', 'role5'].map((k) => ctx.role(k)).filter((x): x is string => !!x);
    const roles = (await Promise.all(ids.map((id) => ctx.guild!.roles.fetch(id).catch(() => null)))).filter((r) => !!r);
    const bad = roles.filter((r) => r!.position >= me.roles.highest.position || r!.managed);
    if (bad.length) return ctx.reply(`I can't hand out ${bad.map((r) => `<@&${r!.id}>`).join(' ')}, move my role above them first.`);
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...roles.map((r) => new ButtonBuilder().setCustomId(`role|${r!.id}`).setLabel(r!.name.slice(0, 80)).setStyle(ButtonStyle.Secondary)),
    );
    const e = card({
      kind: 'roles', title: ctx.str('title')!, emoji: '🎭', gif: 'off',
      body: [ctx.str('about') ?? '', roles.map((r) => `<@&${r!.id}>`).join(' · ')].filter(Boolean).join('\n\n'),
    });
    return ctx.reply({ embeds: [e], components: [row], public: true });
  },
};

export async function onRoleButton(i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('role|') || !i.guild) return false;
  const roleId = i.customId.split('|')[1];
  const m = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!m) return true;
  const has = m.roles.cache.has(roleId);
  const ok = await (has ? m.roles.remove(roleId, 'role picker') : m.roles.add(roleId, 'role picker')).then(() => true).catch(() => false);
  await i.reply({
    content: ok ? `${has ? '➖' : '➕'} ${say(has ? 'roleRemoved' : 'roleAdded')} <@&${roleId}>` : 'I couldn\'t change that role. Ask an admin to check my permissions.',
    flags: 64, allowedMentions: { parse: [] },
  });
  return true;
}

export const welcomeModule: Module = {
  name: 'welcome',
  label: 'Welcome and roles',
  about: 'Greets newcomers, waves goodbye, autorole (all in /setup) and role picker buttons',
  commands: [rolepicker],
};
