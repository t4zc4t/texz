import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags, ModalBuilder,
  PermissionFlagsBits, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Guild, type GuildMember, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { isGifLink, resolve } from '../gifs.js';
import type { Module } from '../core/module.js';
import { card } from '../theme.js';
import { welcomeCard } from '../modules/welcome.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// the panel owner and what was pressed ride in the id, nothing is kept in memory
const id = (owner: string, action: string, arg = '') => `su|${owner}|${action}|${arg}`.slice(0, 100);
const modalId = (owner: string, what: string, arg = '') => `sum|${owner}|${what}|${arg}`.slice(0, 100);

const back = (owner: string, to = 'home') => new ButtonBuilder().setCustomId(id(owner, 'page', to)).setLabel(to === 'home' ? 'Front desk' : 'Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary);
const toggle = (owner: string, action: string, arg: string, label: string, on: boolean, emoji: string) =>
  new ButtonBuilder().setCustomId(id(owner, action, arg)).setLabel(`${label}: ${on ? 'on' : 'off'}`).setEmoji(emoji).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);

export const gifMoments = ['help', 'ping', 'welcome', 'goodbye', 'levelup', 'warn', 'timeout', 'kick', 'ban', 'status', 'leaderboard'];

let modulesRef: Module[] = [];
export const useModules = (m: Module[]) => { modulesRef = m; };
const switchable = () => modulesRef.filter((m) => !m.locked);
const icon: Record<string, string> = { owo: '🐾', anime: '📺', utility: '🧰', moderation: '🛡️', welcome: '🌸', levels: '🎖️' };

export function setupPanel(store: Store, guild: Guild, owner: string, page: string) {
  const g = store.guild(guild.id);
  const ch = (x: string | null) => (x ? `<#${x}>` : '*not set*');
  const comps: Row[] = [];
  let title = 'Front desk';
  let body = '';
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (page === 'home') {
    body = 'Everything about how I behave here, set with a few clicks. Pick what to change below.';
    fields.push(
      { name: '🧩 Features', value: switchable().map((m) => `${store.rules(guild.id, m.name).enabled ? '🟢' : '⚫'} ${m.label}`).join('\n'), inline: true },
      { name: '🌸 Welcome', value: `in ${ch(g.welcome.channel)}\ngoodbye ${ch(g.welcome.goodbyeChannel)}\nautorole ${g.welcome.autorole ? `<@&${g.welcome.autorole}>` : '*none*'}`, inline: true },
      { name: '🛡️ Moderation', value: `logs ${ch(g.mod.logChannel)}\nautomod: ${[g.mod.invites && 'invites', g.mod.spam && 'spam', g.mod.mentions && 'mentions'].filter(Boolean).join(', ') || '*off*'}`, inline: true },
      { name: '🎖️ Levels', value: `${g.levels.announce ? (g.levels.channel ? `posts in ${ch(g.levels.channel)}` : 'posts where people chat') : 'silent'}\n${Object.keys(g.levels.rewards).length} reward roles`, inline: true },
      { name: '⌨️ Prefix', value: `\`${g.prefix}\``, inline: true },
      { name: '🎞️ Gifs', value: Object.keys(g.gifs).length ? Object.keys(g.gifs).join(', ') : 'my defaults', inline: true },
    );
    comps.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, 'page')).setPlaceholder('🗂️ What should we set up?').addOptions(
      { label: 'Features on or off, and where they work', value: 'features', emoji: '🧩' },
      { label: 'Welcome and goodbye messages', value: 'welcome', emoji: '🌸' },
      { label: 'Autorole for newcomers', value: 'autorole', emoji: '🎭' },
      { label: 'Log channel and automod', value: 'mod', emoji: '🛡️' },
      { label: 'Levels and reward roles', value: 'levels', emoji: '🎖️' },
      { label: 'Gifs for each moment', value: 'gifs', emoji: '🎞️' },
      { label: 'Text prefix', value: 'prefix', emoji: '⌨️' },
    )));
  }

  if (page === 'features') {
    title = 'Features';
    body = 'Pick a feature to switch it on or off, or to limit it to certain channels or roles.';
    fields.push({ name: 'Right now', value: switchable().map((m) => {
      const r = store.rules(guild.id, m.name);
      const where = r.channels.length ? `${r.channels.length} channel${r.channels.length > 1 ? 's' : ''}` : 'everywhere';
      const who = r.roles.length ? `${r.roles.length} role${r.roles.length > 1 ? 's' : ''}` : 'everyone';
      return `${r.enabled ? '🟢' : '⚫'} ${icon[m.name] ?? '📁'} **${m.label}** · ${where} · ${who}`;
    }).join('\n') });
    comps.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, 'page')).setPlaceholder('🧩 Pick a feature').addOptions(
      switchable().map((m) => ({ label: m.label, value: `f:${m.name}`, emoji: icon[m.name] ?? '📁', description: m.about.slice(0, 100) })),
    )), row(back(owner)));
  }

  if (page.startsWith('f:')) {
    const mod = switchable().find((m) => m.name === page.slice(2));
    if (mod) {
      const r = { ...defaultRules(), ...g.modules[mod.name] };
      title = mod.label;
      body = `${mod.about}\n\nLeave the menus empty to allow it everywhere and for everyone. Admins can always use everything.`;
      comps.push(
        row(toggle(owner, 'mod', mod.name, 'Feature', r.enabled, icon[mod.name] ?? '📁'), back(owner, 'features')),
        row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'modch', mod.name)).setPlaceholder('📍 Only in these channels (empty = everywhere)')
          .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(25).setDefaultChannels(r.channels.slice(0, 25))),
        row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'modrole', mod.name)).setPlaceholder('🎭 Only for these roles (empty = everyone)')
          .setMinValues(0).setMaxValues(25).setDefaultRoles(r.roles.slice(0, 25))),
      );
    }
  }

  if (page === 'welcome') {
    title = 'Welcome desk';
    body = 'Pick the channels in the menus, clear a menu to switch that part off. Without your own text I use my own lines, a different one each time.';
    fields.push(
      { name: '👋 Welcome text', value: g.welcome.message ?? '*my own lines*', inline: false },
      { name: '🍂 Goodbye text', value: g.welcome.goodbyeMessage ?? '*my own lines*', inline: false },
      { name: '🧩 Placeholders', value: '`{user}` ping · `{name}` name · `{server}` server · `{count}` member number', inline: false },
    );
    comps.push(
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'wch')).setPlaceholder('👋 Welcome channel (empty = off)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(g.welcome.channel ? [g.welcome.channel] : [])),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'gch')).setPlaceholder('🍂 Goodbye channel (empty = off)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(g.welcome.goodbyeChannel ? [g.welcome.goodbyeChannel] : [])),
      row(
        new ButtonBuilder().setCustomId(id(owner, 'wtext')).setLabel('Welcome text').setEmoji('✍️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id(owner, 'gtext')).setLabel('Goodbye text').setEmoji('✍️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id(owner, 'wreset')).setLabel('Use Texz\'s lines').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id(owner, 'preview')).setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
        back(owner),
      ),
    );
  }

  if (page === 'autorole') {
    title = 'Autorole';
    body = 'Every newcomer gets this role the moment they join. Clear the menu to stop.\n-# My own role has to sit above it in Server Settings → Roles.';
    fields.push({ name: '🎭 Right now', value: g.welcome.autorole ? `<@&${g.welcome.autorole}>` : '*none*' });
    comps.push(
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'arole')).setPlaceholder('🎭 Role for newcomers (empty = none)')
        .setMinValues(0).setMaxValues(1).setDefaultRoles(g.welcome.autorole ? [g.welcome.autorole] : [])),
      row(back(owner)),
    );
  }

  if (page === 'mod') {
    title = 'Logs and automod';
    body = 'The log channel gets joins, leaves, deleted and edited messages, bans and every moderation action. Automod never touches anyone who can manage messages.';
    fields.push(
      { name: '🔗 Invites', value: 'deletes invite links', inline: true },
      { name: '🌊 Spam', value: '6 messages in 5s → 5 min timeout', inline: true },
      { name: '📣 Mentions', value: 'deletes messages pinging 6+ people', inline: true },
    );
    comps.push(
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'logch')).setPlaceholder('📜 Log channel (empty = no logs)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(g.mod.logChannel ? [g.mod.logChannel] : [])),
      row(
        toggle(owner, 'am', 'invites', 'Invites', g.mod.invites, '🔗'),
        toggle(owner, 'am', 'spam', 'Spam', g.mod.spam, '🌊'),
        toggle(owner, 'am', 'mentions', 'Mentions', g.mod.mentions, '📣'),
        back(owner),
      ),
    );
  }

  if (page === 'levels') {
    title = 'Levels';
    const rewards = Object.entries(g.levels.rewards).sort((a, b) => Number(a[0]) - Number(b[0]));
    body = 'Pick where level-ups get posted, or leave it empty to post where people chat. To add a reward, pick a role in the last menu and I\'ll ask which level.';
    fields.push({ name: '🎁 Reward roles', value: rewards.length ? rewards.map(([l, r]) => `lvl ${l} → <@&${r}>`).join('\n') : '*none yet*' });
    comps.push(
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'lvch')).setPlaceholder('📣 Level-up channel (empty = where they chat)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(g.levels.channel ? [g.levels.channel] : [])),
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'rwrole')).setPlaceholder('🎁 Add a reward role').setMinValues(1).setMaxValues(1)),
    );
    if (rewards.length) {
      comps.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, 'rwdel')).setPlaceholder('🗑️ Remove a reward')
        .addOptions(rewards.slice(0, 25).map(([l, r]) => ({ label: `Level ${l}`, value: l, description: guild.roles.cache.get(r)?.name ?? r })))));
    }
    comps.push(row(toggle(owner, 'ann', '', 'Level-up posts', g.levels.announce, '📣'), back(owner)));
  }

  if (page === 'gifs') {
    title = 'Gifs';
    body = 'Pick a moment and paste a Giphy link (or a direct .gif). Type `default` to bring mine back or `off` to hide it.';
    fields.push({ name: 'Set here', value: Object.entries(g.gifs).map(([k, v]) => `**${k}** · ${v === 'off' ? 'off' : `[link](${v})`}`).join('\n') || '*my defaults everywhere*' });
    comps.push(
      row(new StringSelectMenuBuilder().setCustomId(id(owner, 'gifm')).setPlaceholder('🎞️ Pick a moment').addOptions(gifMoments.map((m) => ({ label: m, value: m })))),
      row(back(owner)),
    );
  }

  const e = card({ kind: 'settings', title, emoji: '🏛️', gif: 'off', body, fields });
  return { embeds: [e], components: comps.slice(0, 5) };
}

function textModal(owner: string, what: string, arg: string, title: string, label: string, value: string, style = TextInputStyle.Paragraph, max = 500) {
  return new ModalBuilder().setCustomId(modalId(owner, what, arg)).setTitle(title).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('v').setLabel(label).setStyle(style)
      .setRequired(true).setMaxLength(max).setValue(value.slice(0, max))),
  );
}

async function canGive(guild: Guild, roleId: string) {
  const me = await guild.members.fetchMe();
  const r = await guild.roles.fetch(roleId).catch(() => null);
  return !!r && !r.managed && r.id !== guild.id && r.position < me.roles.highest.position;
}

const pageOf: Record<string, string> = {
  mod: 'f', modch: 'f', modrole: 'f', wch: 'welcome', gch: 'welcome', wtext: 'welcome', gtext: 'welcome', wreset: 'welcome',
  arole: 'autorole', logch: 'mod', am: 'mod', lvch: 'levels', rwrole: 'levels', rwdel: 'levels', ann: 'levels', rw: 'levels', gifm: 'gifs', gif: 'gifs', prefix: 'home',
};

export async function onSetup(store: Store, i: Interaction): Promise<boolean> {
  if (!('customId' in i) || typeof i.customId !== 'string') return false;
  if (!i.customId.startsWith('su|') && !i.customId.startsWith('sum|')) return false;
  if (!i.isButton() && !i.isAnySelectMenu() && !i.isModalSubmit()) return false;
  const [tag, owner, action, arg = ''] = i.customId.split('|');
  if (!i.guild) return true;
  if (i.user.id !== owner || !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await i.reply({ content: 'This front desk belongs to whoever opened it. Run `/setup` for your own.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const g = store.guild(i.guild.id);
  const values = i.isAnySelectMenu() ? i.values : [];
  const text = i.isModalSubmit() ? i.fields.getTextInputValue('v').trim() : '';
  let page = pageOf[action] === 'f' ? `f:${arg}` : pageOf[action] ?? 'home';
  const fail = (msg: string) => i.reply({ content: msg, flags: MessageFlags.Ephemeral }).then(() => true);

  if (tag === 'su') {
    if (i.isModalSubmit()) return true;
    if (action === 'page') {
      const to = i.isStringSelectMenu() ? values[0] : arg;
      if (to === 'prefix' && i.isStringSelectMenu()) {
        await i.showModal(textModal(owner, 'prefix', '', 'Text prefix', 'New prefix, no spaces', g.prefix, TextInputStyle.Short, 5));
        return true;
      }
      await i.update(setupPanel(store, i.guild, owner, to));
      return true;
    }
    // buttons that need typing open a small form
    if (action === 'wtext') { await i.showModal(textModal(owner, 'wtext', '', 'Welcome text', 'Use {user} {name} {server} {count}', g.welcome.message ?? 'Welcome to {server}, {user}! You are member #{count}.')); return true; }
    if (action === 'gtext') { await i.showModal(textModal(owner, 'gtext', '', 'Goodbye text', 'Use {name} {server}', g.welcome.goodbyeMessage ?? '{name} has left {server}.')); return true; }
    if (action === 'gifm') { await i.showModal(textModal(owner, 'gif', values[0], `Gif for ${values[0]}`, 'Giphy link, .gif link, default or off', g.gifs[values[0]] ?? 'default', TextInputStyle.Short, 300)); return true; }
    if (action === 'rwrole') {
      if (!(await canGive(i.guild, values[0]))) return fail('I can\'t hand out that role. Move my role above it in Server Settings → Roles, then try again.');
      await i.showModal(textModal(owner, 'rw', values[0], 'Reward role', 'At which level? (1 to 200)', '10', TextInputStyle.Short, 3));
      return true;
    }
    if (action === 'preview') {
      const me = i.member as GuildMember;
      await i.reply({ embeds: [welcomeCard(store, me)], flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'mod') g.modules[arg] = { ...defaultRules(), ...g.modules[arg], enabled: !store.rules(i.guild.id, arg).enabled };
    if (action === 'modch') g.modules[arg] = { ...defaultRules(), ...g.modules[arg], channels: values };
    if (action === 'modrole') g.modules[arg] = { ...defaultRules(), ...g.modules[arg], roles: values };
    if (action === 'wch') g.welcome.channel = values[0] ?? null;
    if (action === 'gch') g.welcome.goodbyeChannel = values[0] ?? null;
    if (action === 'wreset') { g.welcome.message = null; g.welcome.goodbyeMessage = null; }
    if (action === 'arole') {
      if (values[0] && !(await canGive(i.guild, values[0]))) return fail('I can\'t hand out that role. Move my role above it in Server Settings → Roles, then try again.');
      g.welcome.autorole = values[0] ?? null;
    }
    if (action === 'logch') g.mod.logChannel = values[0] ?? null;
    if (action === 'am' && (arg === 'invites' || arg === 'spam' || arg === 'mentions')) g.mod[arg] = !g.mod[arg];
    if (action === 'lvch') g.levels.channel = values[0] ?? null;
    if (action === 'ann') g.levels.announce = !g.levels.announce;
    if (action === 'rwdel') delete g.levels.rewards[values[0]];
  } else {
    if (action === 'wtext') g.welcome.message = text;
    if (action === 'gtext') g.welcome.goodbyeMessage = text;
    if (action === 'rw') {
      const lvl = Number.parseInt(text, 10);
      if (!(lvl >= 1 && lvl <= 200)) return fail('Level has to be a number from 1 to 200.');
      g.levels.rewards[String(lvl)] = arg;
    }
    if (action === 'prefix') {
      const p = text.toLowerCase();
      if (!p || /\s/.test(p) || p === 'owo' || p === 'w') return fail('Pick a short prefix without spaces, and not `owo` or `w`, those belong to OwO.');
      g.prefix = p;
      page = 'home';
    }
    if (action === 'gif') {
      const v = text.toLowerCase();
      if (v === 'default') delete g.gifs[arg];
      else if (v === 'off') g.gifs[arg] = 'off';
      else if (isGifLink(text) && (await resolve(text))) g.gifs[arg] = text;
      else return fail('That needs to be a Giphy link (giphy.com/gifs/...), a direct .gif link, `default` or `off`.');
    }
  }
  store.saveGuild(i.guild.id, g);
  const view = setupPanel(store, i.guild, owner, page);
  if (i.isModalSubmit()) {
    if (i.isFromMessage()) await i.update(view);
    else await i.reply({ ...view, flags: MessageFlags.Ephemeral });
  } else await i.update(view);
  return true;
}
