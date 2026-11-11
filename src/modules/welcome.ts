import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder, StringSelectMenuBuilder,
  type GuildMember, type Role, type Interaction, type MessageActionRowComponentBuilder, type PartialGuildMember,
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

// booster thank-yous are off until an admin switches them on, and go to their own room
export const boostOn = (store: Store, g: string) => store.getKv(`boostann:${g}`) === 'on';
const boostLines = [
  '{user} just boosted the server. Dazai calls it an investment, Kunikida calls it the only sensible thing anyone did today.',
  '{user} boosted us. The Agency\'s budget thanks you, and so does whoever was about to sell the office sofa.',
  'A boost from {user}. Even the Port Mafia would be jealous of that loyalty.',
  '{user} has become a patron of the Agency. Your name goes in Kunikida\'s notebook, the good page.',
];
export async function onBoost(store: Store, m: GuildMember) {
  const id = store.getKv(`boostch:${m.guild.id}`);
  if (!boostOn(store, m.guild.id) || !id) return;
  // the member update and Discord's own boost message can both arrive, one thank-you is enough
  const seen = `boosted:${m.guild.id}:${m.id}`;
  if (Date.now() - Number(store.getKv(seen) ?? 0) < 30 * 60_000) return;
  store.setKv(seen, String(Date.now()));
  const ch = await m.guild.channels.fetch(id).catch(() => null);
  if (!ch?.isSendable()) return;
  const line = boostLines[Math.floor(Math.random() * boostLines.length)].replace('{user}', `<@${m.id}>`);
  const n = m.guild.premiumSubscriptionCount ?? 0;
  const e = card({ kind: 'bulletin', title: `💎 A new patron · ${m.displayName}`, emoji: '', gif: store.guild(m.guild.id).gifs.boost ?? 'off', body: `${line}\n\n-# ${n} boost${n === 1 ? '' : 's'} on the server now · level ${m.guild.premiumTier}` });
  e.setThumbnail(m.displayAvatarURL({ size: 256 })).setColor(0xf47fff);
  await ch.send({ content: `<@${m.id}>`, embeds: [e], allowedMentions: { users: [m.id] } }).catch(() => {});
}

const rolepicker: Command = {
  name: 'rolepicker',
  group: 'staff',
  admin: true,
  data: new SlashCommandBuilder().setName('rolepicker').setDescription('Post a panel people use to give themselves roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false)
    .addStringOption((x) => x.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
    .addStringOption((x) => x.setName('style').setDescription('Buttons (up to 5 roles) or a menu (up to 25)')
      .addChoices({ name: 'buttons', value: 'buttons' }, { name: 'menu', value: 'menu' }, { name: 'menu, one role only', value: 'single' }))
    .addStringOption((x) => x.setName('about').setDescription('A line under the title').setMaxLength(300)).toJSON(),
  // tz rolepicker Colours, then pick the roles from the menu that shows up
  text: { args: ['title'] },
  run: (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Server only.');
    const style = ctx.str('style') ?? 'menu';
    // the draft waits here while the roles get picked
    store.setKv(`rpk:${ctx.userId}`, JSON.stringify({ title: ctx.str('title') ?? 'Pick your roles', about: ctx.str('about'), style }));
    const max = style === 'buttons' ? 5 : 25;
    return ctx.reply({
      content: `🎭 Which roles go on the panel? Pick up to ${max}, then I'll post it in this channel.`,
      components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`rpk|${ctx.userId}`).setPlaceholder('Pick the roles').setMinValues(1).setMaxValues(max))],
    });
  },
};

function pickerView(title: string, about: string | null, style: string, roles: Role[]) {
  const e = card({ kind: 'roles', title, emoji: '🎭', gif: 'off', body: [about ?? '', roles.map((r) => `<@&${r.id}>`).join(' · ')].filter(Boolean).join('\n\n') });
  const rows = style === 'buttons'
    ? [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        ...roles.map((r) => new ButtonBuilder().setCustomId(`role|${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary)))]
    : [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`rolem|${style === 'single' ? 1 : 0}`).setPlaceholder(style === 'single' ? 'Pick one' : 'Pick any, unpick to drop')
          .setMinValues(0).setMaxValues(style === 'single' ? 1 : roles.length)
          .addOptions(roles.map((r) => ({ label: r.name.slice(0, 100), value: r.id }))))];
  return { embeds: [e], components: rows };
}

export async function onRoleButton(store: Store, i: Interaction) {
  if (!i.guild) return false;
  if (i.isRoleSelectMenu() && i.customId.startsWith('rpk|')) {
    if (i.customId.split('|')[1] !== i.user.id) { await i.reply({ content: 'Start your own with `/admin view:roles`.', flags: 64 }); return true; }
    const draft = JSON.parse(store.getKv(`rpk:${i.user.id}`) ?? 'null') as { title: string; about: string | null; style: string } | null;
    if (!draft) { await i.reply({ content: 'That draft expired, run `/admin view:roles` again.', flags: 64 }); return true; }
    const me = await i.guild.members.fetchMe();
    const roles = [...i.roles.values()].map((r) => i.guild!.roles.cache.get(r.id)).filter((r): r is Role => !!r);
    const bad = roles.filter((r) => r.position >= me.roles.highest.position || r.managed || r.id === i.guild!.id);
    if (bad.length) { await i.reply({ content: `I can't hand out ${bad.map((r) => `<@&${r.id}>`).join(' ')}, drag my role **${i.guild?.members.me?.roles.highest.name ?? 'Texz'}** above them in Server Settings → Roles first.`, flags: 64, allowedMentions: { parse: [] } }); return true; }
    const ch = i.channel;
    if (!ch?.isSendable()) { await i.reply({ content: 'I can\'t post here.', flags: 64 }); return true; }
    await ch.send({ ...pickerView(draft.title, draft.about, draft.style, roles), allowedMentions: { parse: [] } });
    store.setKv(`rpk:${i.user.id}`, null);
    await i.update({ content: '🎭 Panel posted.', components: [] });
    return true;
  }
  if (i.isStringSelectMenu() && i.customId.startsWith('rolem|')) {
    const m = await i.guild.members.fetch(i.user.id).catch(() => null);
    if (!m) return true;
    const all = i.component.options.map((o) => o.value);
    const want = new Set(i.values);
    const add = all.filter((id) => want.has(id) && !m.roles.cache.has(id));
    const drop = all.filter((id) => !want.has(id) && m.roles.cache.has(id));
    const ok = await Promise.all([...add.map((id) => m.roles.add(id, 'role picker')), ...drop.map((id) => m.roles.remove(id, 'role picker'))]).then(() => true).catch(() => false);
    const parts = [add.length && `➕ ${add.map((id) => `<@&${id}>`).join(' ')}`, drop.length && `➖ ${drop.map((id) => `<@&${id}>`).join(' ')}`].filter(Boolean);
    await i.reply({ content: ok ? (parts.join('\n') || 'Nothing changed.') : 'I couldn\'t change those roles. Ask an admin to check my permissions.', flags: 64, allowedMentions: { parse: [] } });
    return true;
  }
  if (!i.isButton() || !i.customId.startsWith('role|')) return false;
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
