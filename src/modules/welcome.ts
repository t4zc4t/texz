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
    await ch.send({ embeds: [card({ kind: 'goodbye', title: 'Gone', emoji: '🍂', gif: store.guild(m.guild.id).gifs.goodbye ?? 'off', vars: { user: name, server: m.guild.name }, body: text })] }).catch(() => {});
  }
}

const welcome: Command = {
  name: 'welcome',
  admin: true,
  data: new SlashCommandBuilder().setName('welcome').setDescription('Welcome and goodbye messages, and a role for newcomers')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
    .addChannelOption((x) => x.setName('channel').setDescription('Where to greet people').addChannelTypes(ChannelType.GuildText))
    .addStringOption((x) => x.setName('message').setDescription('Your own text, {user} {name} {server} {count}, or "default"').setMaxLength(500))
    .addChannelOption((x) => x.setName('goodbye').setDescription('Where to say goodbye').addChannelTypes(ChannelType.GuildText))
    .addStringOption((x) => x.setName('goodbye_message').setDescription('Your own goodbye text, or "default"').setMaxLength(500))
    .addRoleOption((x) => x.setName('autorole').setDescription('Role every newcomer gets'))
    .addStringOption((x) => x.setName('off').setDescription('Turn something off').addChoices(
      { name: 'welcome', value: 'welcome' }, { name: 'goodbye', value: 'goodbye' }, { name: 'autorole', value: 'autorole' }))
    .addBooleanOption((x) => x.setName('test').setDescription('Show me what a welcome looks like')).toJSON(),
  text: { aliases: ['greet'], args: ['channel'] },
  run: async (ctx, store) => {
    if (!ctx.guildId || !ctx.member) return ctx.reply('Server only.');
    const g = store.guild(ctx.guildId);
    const w = g.welcome;
    const ch = ctx.channel('channel'); if (ch) w.channel = ch;
    const msg = ctx.str('message'); if (msg) w.message = msg === 'default' ? null : msg;
    const bye = ctx.channel('goodbye'); if (bye) w.goodbyeChannel = bye;
    const byeMsg = ctx.str('goodbye_message'); if (byeMsg) w.goodbyeMessage = byeMsg === 'default' ? null : byeMsg;
    const role = ctx.role('autorole');
    if (role) {
      const me = await ctx.guild!.members.fetchMe();
      const r = await ctx.guild!.roles.fetch(role).catch(() => null);
      if (!r || r.position >= me.roles.highest.position || r.managed) return ctx.reply('I can\'t hand out that role, it sits above mine or belongs to a bot.');
      w.autorole = role;
    }
    const off = ctx.str('off');
    if (off === 'welcome') w.channel = null;
    if (off === 'goodbye') w.goodbyeChannel = null;
    if (off === 'autorole') w.autorole = null;
    store.saveGuild(ctx.guildId, g);
    if (ctx.bool('test')) return ctx.reply({ embeds: [welcomeCard(store, ctx.member)], private: false });
    return ctx.reply(card({
      kind: 'welcomeSetup', title: 'Welcome desk', emoji: '🌸', gif: 'off',
      fields: [
        { name: '👋 Welcome', value: w.channel ? `<#${w.channel}>` : 'off', inline: true },
        { name: '🍂 Goodbye', value: w.goodbyeChannel ? `<#${w.goodbyeChannel}>` : 'off', inline: true },
        { name: '🎭 Autorole', value: w.autorole ? `<@&${w.autorole}>` : 'off', inline: true },
        { name: '💬 Welcome text', value: w.message ?? '*my own lines, a different one each time*', inline: false },
        { name: '💬 Goodbye text', value: w.goodbyeMessage ?? '*my own lines, a different one each time*', inline: false },
        { name: '🧪 Try it', value: '`/welcome test:true`', inline: false },
      ],
    }));
  },
};

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
    return ctx.reply({ embeds: [e], components: [row], private: false });
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
  about: 'Greets newcomers, waves goodbye, gives an autorole, and role picker buttons',
  commands: [welcome, rolepicker],
};
