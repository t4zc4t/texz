import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags, ModalBuilder,
  PermissionFlagsBits, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Guild, type GuildMember, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { isGifLink, resolve } from '../gifs.js';
import type { Module } from '../core/module.js';
import { card } from '../theme.js';
import { boostOn, welcomeCard } from '../modules/welcome.js';
import { ticketPanel } from '../modules/server.js';
import { buildBoard } from '../modules/bulletins.js';
import { searchMedia, titleOf } from '../anime/anilist.js';
import { applyPerks, carryRankPerms, fixRankOrder, perks, rankFor, ranks, tidyRanks } from '../modules/levels.js';
import { parseLength } from '../modules/moderation.js';
import { p2HelperOn, setP2Helper } from '../modules/spawns.js';
import { staffRoles } from '../core/staff.js';
import { botLog, buildAgency } from './layout.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// the panel owner and what was pressed ride in the id, nothing is kept in memory
const id = (owner: string, action: string, arg = '') => `su|${owner}|${action}|${arg}`.slice(0, 100);
const modalId = (owner: string, what: string, arg = '') => `sum|${owner}|${what}|${arg}`.slice(0, 100);

const back = (owner: string, to = 'home') => new ButtonBuilder().setCustomId(id(owner, 'page', to)).setLabel(to === 'home' ? 'Front desk' : 'Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary);
const toggle = (owner: string, action: string, arg: string, label: string, on: boolean, emoji: string) =>
  new ButtonBuilder().setCustomId(id(owner, action, arg)).setLabel(`${label}: ${on ? 'on' : 'off'}`).setEmoji(emoji).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);

export const gifMoments = ['help', 'ping', 'welcome', 'goodbye', 'levelup', 'birthday', 'warn', 'timeout', 'kick', 'ban', 'status', 'leaderboard'];

let modulesRef: Module[] = [];
export const useModules = (m: Module[]) => { modulesRef = m; };
const switchable = () => modulesRef.filter((m) => !m.locked);
const icon: Record<string, string> = { owo: '🐾', anime: '📺', utility: '🧰', moderation: '🛡️', welcome: '🌸', levels: '🎖️', giveaways: '🎁', birthdays: '🎂', server: '🏛️', economy: '💴', bulletins: '🗞️' };

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
      { name: '🎖️ Levels', value: !store.rules(guild.id, 'levels').enabled ? '*off*' : `${g.levels.announce ? (g.levels.channel ? `posts in ${ch(g.levels.channel)}` : 'posts where people chat') : 'silent'}\n${Object.keys(g.levels.rewards).length} reward roles`, inline: true },
      { name: '⌨️ Prefix', value: `\`${g.prefix}\``, inline: true },
      { name: '🧹 Auto-clean', value: g.autoclean ? `quick replies vanish after ${g.autoclean < 60 ? `${g.autoclean}s` : `${g.autoclean / 60}m`}` : '*off, replies stay*', inline: true },
      { name: '🎞️ Gifs', value: Object.keys(g.gifs).length ? Object.keys(g.gifs).join(', ') : 'my defaults', inline: true },
    );
    comps.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, 'page')).setPlaceholder('🗂️ What should we set up?').addOptions(
      { label: 'Features on or off, and where they work', value: 'features', emoji: '🧩' },
      { label: 'Welcome and goodbye messages', value: 'welcome', emoji: '🌸' },
      { label: 'Autorole for newcomers', value: 'autorole', emoji: '🎭' },
      { label: 'Staff role, logs and automod', value: 'mod', emoji: '🛡️' },
      { label: 'Levels, xp and reward roles', value: 'levels', emoji: '🎖️' },
      { label: 'Birthday greetings and role', value: 'birthdays', emoji: '🎂' },
      { label: 'Bulletins: F1, football, anime', value: 'bulletins', emoji: '🗞️' },
      { label: 'Community: quotes, archive, counting, confessions', value: 'quotes', emoji: '🖋️' },
      { label: 'Character of the day', value: 'cotd', emoji: '🎭' },
      { label: 'Tickets', value: 'tickets', emoji: '🎫' },
      { label: 'Gifs for each moment', value: 'gifs', emoji: '🎞️' },
      { label: 'Text prefix', value: 'prefix', emoji: '⌨️' },
    )));
    // short confirmations, errors and dice rolls from typed commands, cards and lists always stay
    comps.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, 'clean')).setPlaceholder('🧹 Auto-clean quick replies').addOptions(
      [[0, 'Off, keep everything'], [10, 'After 10 seconds'], [30, 'After 30 seconds'], [60, 'After a minute'], [300, 'After 5 minutes']]
        .map(([v, label]) => ({ label: `🧹 ${label}`, value: String(v), default: g.autoclean === v })),
    )));
    comps.push(row(
      new ButtonBuilder().setCustomId(id(owner, 'agency')).setLabel('Build the Agency').setEmoji('🏗️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id(owner, 'page', 'features')).setLabel('Features').setEmoji('🧩').setStyle(ButtonStyle.Secondary),
    ));
    fields.push({ name: '🏗️ Build the Agency', value: 'One click lays out the whole Texz corner: a front door for welcomes, the bulletin board, the Bar Lupin for counting and confessions, and staff-only archives for logs. Existing Texz channels are moved and renamed, the right locks go on every room.', inline: false });
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
    )), row(
      back(owner),
      new ButtonBuilder().setCustomId(id(owner, 'allon')).setLabel('Everything on').setEmoji('🟢').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id(owner, 'alloff')).setLabel('Everything off').setEmoji('⚫').setStyle(ButtonStyle.Secondary),
    ));
  }

  if (page.startsWith('f:')) {
    const mod = switchable().find((m) => m.name === page.slice(2));
    if (mod) {
      const r = { ...defaultRules(mod.name), ...g.modules[mod.name] };
      title = mod.label;
      body = `${mod.about}\n\nLeave the menus empty to allow it everywhere and for everyone. Admins can always use everything.`;
      comps.push(
        row(toggle(owner, 'mod', mod.name, 'Feature', r.enabled, icon[mod.name] ?? '📁'), ...(mod.name === 'spawns' ? [toggle(owner, 'p2help', mod.name, 'Pokétwo helper', p2HelperOn(store, guild.id), '🔎')] : []), back(owner, 'features')),
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
      { name: '💎 Booster thank-you', value: `${boostOn(store, guild.id) ? '🟢 on' : '⚫ off'} · ${ch(store.getKv(`boostch:${guild.id}`))}`, inline: false },
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
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'boostch')).setPlaceholder('💎 Booster thank-you channel')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(store.getKv(`boostch:${guild.id}`) ? [store.getKv(`boostch:${guild.id}`)!] : [])),
      row(new ButtonBuilder().setCustomId(id(owner, 'boost')).setLabel(`Booster thank-you: ${boostOn(store, guild.id) ? 'on' : 'off'}`).setEmoji('💎').setStyle(boostOn(store, guild.id) ? ButtonStyle.Success : ButtonStyle.Secondary)),
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
    title = 'Staff, logs and automod';
    body = 'The staff roles get the Staff dashboard: giveaways, role pickers, announcements, xp tools and the case archive. Kicks, bans and timeouts still need the matching Discord permission. The log channel gets joins, leaves, deleted and edited messages, bans and every moderation action. Automod never touches anyone who can manage messages.';
    const staff = staffRoles(store, guild.id);
    fields.push(
      { name: '🛡️ Staff', value: `${staff.length ? staff.map((r) => `<@&${r}>`).join(' ') : '*only people with Manage Server*'}`, inline: false },
      { name: '🔗 Invites', value: 'deletes invite links', inline: true },
      { name: '🌊 Spam', value: '6 messages in 5s → 5 min timeout', inline: true },
      { name: '📣 Mentions', value: 'deletes messages pinging 6+ people', inline: true },
    );
    comps.push(
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'staff')).setPlaceholder('🛡️ Staff roles (empty = only Manage Server)').setMinValues(0).setMaxValues(5).setDefaultRoles(staff)),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'logch')).setPlaceholder('📜 Log channel (empty = no logs)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(g.mod.logChannel ? [g.mod.logChannel] : [])),
      row(
        toggle(owner, 'am', 'invites', 'Invites', g.mod.invites, '🔗'),
        toggle(owner, 'am', 'spam', 'Spam', g.mod.spam, '🌊'),
        toggle(owner, 'am', 'mentions', 'Mentions', g.mod.mentions, '📣'),
        back(owner),
      ),
    );
    // only whoever owns the bot sees this one, it collects Texz's own crashes from every server
    if (isBotOwner(guild, owner)) {
      const err = store.getKv('errorChannel');
      fields.push({ name: '🩹 Texz error reports', value: err ? `<#${err}>` : '*off, only the console*', inline: false });
      comps.push(row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'errch')).setPlaceholder('🩹 Where Texz reports its own errors (owner only)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(err ? [err] : [])));
    }
  }

  if (page === 'levels') {
    title = 'Levels';
    const on = store.rules(guild.id, 'levels').enabled;
    const l = g.levels;
    body = on
      ? 'Levels are **on**. People earn xp by chatting and climb the Agency ranks. Pick where level-ups get posted (empty = where they chat) and which channels earn nothing.'
      : 'Levels are **off**, nobody earns xp and `rank` stays quiet. Switch them on when you want them.';
    fields.push(
      { name: '📣 Level-up posts', value: l.announce ? (l.channel ? `in <#${l.channel}>` : 'where people chat') : '*off, levels go up quietly*', inline: true },
      { name: '🎁 Reward roles', value: `${Object.keys(l.rewards).length} set`, inline: true },
      { name: '🚫 No xp in', value: l.noXpChannels.map((c) => `<#${c}>`).join(' ') || '*nowhere*', inline: false },
    );
    comps.push(
      row(
        toggle(owner, 'lvon', '', 'Levels', on, '🎖️'),
        toggle(owner, 'ann', '', 'Level-up posts', l.announce, '📣'),
        new ButtonBuilder().setCustomId(id(owner, 'page', 'rewards')).setLabel('Reward roles').setEmoji('🎁').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id(owner, 'page', 'lvxp')).setLabel('Xp and boosts').setEmoji('🔥').setStyle(ButtonStyle.Primary),
        back(owner),
      ),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'lvch')).setPlaceholder('📣 Level-up channel (empty = where they chat)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(l.channel ? [l.channel] : [])),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'noxpch')).setPlaceholder('🚫 Channels where chatting gives no xp')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(25).setDefaultChannels(l.noXpChannels.slice(0, 25))),
    );
  }

  if (page === 'rewards') {
    title = 'Reward roles';
    const rewards = Object.entries(g.levels.rewards).sort((a, b) => Number(a[0]) - Number(b[0]));
    body = 'Make the Agency ranks in one go, make a single role with your own name, or hand out a role you already have. Pick a reward in the edit menu to rename it or change its level.';
    fields.push({ name: '🎁 Reward roles', value: rewards.length ? rewards.map(([l, r]) => `lvl ${l} → <@&${r}>`).join('\n') : '*none yet*' });
    comps.push(row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'rwrole')).setPlaceholder('🎁 Use a role you already have as a reward').setMinValues(1).setMaxValues(1)));
    if (rewards.length) {
      comps.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, 'rwedit')).setPlaceholder('✏️ Rename, move or remove a reward')
        .addOptions(rewards.slice(0, 25).map(([l, r]) => ({ label: `Level ${l} · ${guild.roles.cache.get(r)?.name ?? 'missing role'}`.slice(0, 100), value: l })))));
    }
    comps.push(row(
      new ButtonBuilder().setCustomId(id(owner, 'rwranks')).setLabel('Make or fix rank roles').setEmoji('✨').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id(owner, 'rwnew')).setLabel('New reward role').setEmoji('➕').setStyle(ButtonStyle.Primary),
      back(owner, 'levels'),
    ));
  }

  if (page === 'lvxp') {
    title = 'Xp and boosts';
    const l = g.levels;
    const now = Date.now();
    const t = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`;
    const ev = l.boost && l.boost.until > now
      ? `**${l.boost.x}x** ${l.boost.name ? `· ${l.boost.name} ` : ''}${l.boost.from > now ? `from ${t(l.boost.from)} ` : '**live** '}until ${t(l.boost.until)}`
      : '*none planned*';
    const list = (o: Record<string, number>, tag: (x: string) => string) => Object.entries(o).map(([k, x]) => `${tag(k)} ${x}x`).join('\n') || '*none*';
    body = [
      'How fast people climb, and when they climb faster. Boosts multiply each other, capped at 10x. Only the best role boost counts.',
      'Pick a role or channel in the boost menus to give it a multiplier, type `1` there to remove it.',
    ].join('\n');
    fields.push(
      { name: '✨ Per message', value: `${l.min} to ${l.max} xp\nonce every ${l.cooldown}s`, inline: true },
      { name: '🎉 Event boost', value: ev, inline: true },
      { name: '📅 Weekends', value: l.weekend > 1 ? `**${l.weekend}x** on Sat and Sun (UTC)` : '*off*', inline: true },
      { name: '🎭 Role boosts', value: list(l.roleBoosts, (k) => `<@&${k}>`), inline: true },
      { name: '💬 Channel boosts', value: list(l.channelBoosts, (k) => `<#${k}>`), inline: true },
      { name: '🎁 Reward roles', value: l.stack ? 'people keep every one they earn' : 'only the highest one is kept', inline: true },
      { name: '🚫 No xp in', value: [...l.noXpChannels.map((c) => `<#${c}>`), ...l.noXpRoles.map((r) => `<@&${r}>`)].join(' ') || '*nowhere*', inline: false },
      { name: '📣 Level-up line', value: l.message ? `> ${l.message}` : '*my own lines*', inline: false },
    );
    comps.push(
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'noxprole')).setPlaceholder('🚫 Roles that earn no xp (muted, bots...)')
        .setMinValues(0).setMaxValues(25).setDefaultRoles(l.noXpRoles.slice(0, 25))),
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'rboost')).setPlaceholder('🎭 Give a role an xp boost (boosters, vips...)').setMinValues(1).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'cboost')).setPlaceholder('💬 Give a channel an xp boost')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)),
      row(
        new ButtonBuilder().setCustomId(id(owner, 'xprate')).setLabel('Xp rate').setEmoji('✨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id(owner, 'event')).setLabel(l.boost && l.boost.until > now ? 'Edit event' : 'Plan a boost').setEmoji('🎉').setStyle(ButtonStyle.Success),
        toggle(owner, 'stack', '', 'Keep all rewards', l.stack, '🎁'),
        new ButtonBuilder().setCustomId(id(owner, 'lvmsg')).setLabel('Level-up line').setEmoji('📝').setStyle(ButtonStyle.Secondary),
        back(owner, 'levels'),
      ),
    );
  }

  if (page === 'birthdays') {
    title = 'Birthdays';
    const b = g.birthdays;
    const on = store.rules(guild.id, 'birthdays').enabled;
    body = [
      'People save their birthday with `tz bday set 14 feb` (no year). On the day, going by their own timezone, I greet them in the birthday channel and hand out the birthday role for 24 hours.',
      on ? '' : '**Birthdays are switched off** in Features, so nothing happens until they\'re back on.',
    ].filter(Boolean).join('\n');
    fields.push(
      { name: '📣 Channel', value: ch(b.channel), inline: true },
      { name: '🎭 Role for the day', value: b.role ? `<@&${b.role}>` : '*none*', inline: true },
      { name: '📝 Greeting', value: b.message ? `> ${b.message}` : '*my own lines*', inline: false },
    );
    comps.push(
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'bdch')).setPlaceholder('📣 Birthday channel (empty = no greeting)')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1).setDefaultChannels(b.channel ? [b.channel] : [])),
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'bdrole')).setPlaceholder('🎭 Birthday role for the day (empty = none)')
        .setMinValues(0).setMaxValues(1).setDefaultRoles(b.role ? [b.role] : [])),
      row(
        new ButtonBuilder().setCustomId(id(owner, 'bdmsg')).setLabel('Greeting').setEmoji('📝').setStyle(ButtonStyle.Secondary),
        back(owner),
      ),
    );
  }

  if (page === 'quotes') {
    title = 'Community';
    body = 'The rooms everyone uses. **Build the Agency** puts them where they belong, with the right locks:\n🖋️ quotes and ⭐ the archive (5 stars) on the bulletin board, read-only\n🔢 the count and 🕯️ the confessional in the 🥃 Bar Lupin\n🌸 a front door for welcomes, 🗄️ staff-only archives for logs\nEvery Monday the week\'s file (top chatters, catchers, numbers) goes to the archive.';
    const count = JSON.parse(store.getKv(`count:${guild.id}`) ?? '{}') as { channel?: string; n?: number; best?: number };
    const conf = store.getKv(`confessch:${guild.id}`);
    fields.push(
      { name: '🖋️ Quotes', value: ch(g.quotes.channel), inline: true },
      { name: '📁 Archive', value: `${ch(g.starboard.channel)} · ${g.starboard.min} ${g.starboard.emoji}`, inline: true },
      { name: '🔢 Count', value: count.channel ? `<#${count.channel}> · at ${count.n ?? 0}, record ${count.best ?? 0}` : '*none*', inline: true },
      { name: '🕯️ Confessional', value: conf ? `<#${conf}>` : '*none*', inline: true },
      { name: '🗂️ Monday recap', value: store.getKv(`recap:${guild.id}`) === 'off' ? 'off' : 'on', inline: true },
    );
    comps.push(
      row(
        new ButtonBuilder().setCustomId(id(owner, 'commbuild')).setLabel('Build the Agency').setEmoji('🏗️').setStyle(ButtonStyle.Primary),
        toggle(owner, 'recap', '', 'Monday recap', store.getKv(`recap:${guild.id}`) !== 'off', '🗂️'),
      ),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'qch')).setPlaceholder('🖼️ Quotes channel (empty = where it was asked)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(g.quotes.channel ? [g.quotes.channel] : [])),
      row(back(owner)),
    );
  }

  if (page === 'bulletins') {
    title = 'Bulletins';
    const b = g.bulletins;
    body = 'Three notice channels under one category, each with its own role people pick up from a button: Grand Prix results and race day pings from Parc Fermé, big football matches and your clubs, and new anime episodes. **Set up the board** makes whatever is missing and repairs anything deleted, renamed pieces are kept as they are.';
    // green only once the channel and role really exist
    const ready = (f: { channel: string | null; role: string | null }) => !!f.channel && guild.channels.cache.has(f.channel) && !!f.role && guild.roles.cache.has(f.role);
    const line = (f: { on: boolean; channel: string | null; role: string | null }) => !ready(f) ? (f.channel || f.role ? '🔴 *something was deleted, press Set up the board*' : '⚪ *not set up yet*') : `${f.on ? '🟢' : '⚫'} ${ch(f.channel)} · <@&${f.role}>`;
    fields.push(
      { name: '🏎️ Grand Prix', value: `${line(b.f1)}\nfacts: ${b.f1.facts ? 'daily' : 'off'}`, inline: true },
      { name: '⚽ Football', value: `${line(b.football)}\nclubs: ${b.football.favs.join(', ') || '*none*'}\nbig matches: ${b.football.big ? 'on' : 'off'}`, inline: true },
      { name: '📺 Anime', value: `${line(b.anime)}\nshows: ${b.anime.shows.length}\npopular: ${b.anime.popular ? 'on' : 'off'}`, inline: true },
      { name: '🎨 F1 card style', value: store.getKv(`f1theme:${guild.id}`) === 'agency' ? '📜 Detective Agency, the light one' : '🌑 Port Mafia, the dark one', inline: true },
      ...(b.anime.shows.length ? [{ name: '📺 Shows that get a ping every episode', value: b.anime.shows.map((x) => x.title).join(', ').slice(0, 1024), inline: false }] : []),
    );
    comps.push(
      row(
        new ButtonBuilder().setCustomId(id(owner, 'bulbuild')).setLabel('Set up the board').setEmoji('🗞️').setStyle(ButtonStyle.Success),
        toggle(owner, 'bulon', 'f1', 'F1', b.f1.on, '🏎️'),
        toggle(owner, 'bulon', 'football', 'Football', b.football.on, '⚽'),
        toggle(owner, 'bulon', 'anime', 'Anime', b.anime.on, '📺'),
        back(owner),
      ),
      row(new ButtonBuilder().setCustomId(id(owner, 'f1look')).setLabel(`F1 cards: ${store.getKv(`f1theme:${guild.id}`) === 'agency' ? 'Detective Agency' : 'Port Mafia'}`).setEmoji('🎨').setStyle(ButtonStyle.Secondary)),
      row(
        toggle(owner, 'bulopt', 'facts', 'F1 facts', b.f1.facts, '🗞️'),
        toggle(owner, 'bulopt', 'big', 'Big matches', b.football.big, '🏟️'),
        toggle(owner, 'bulopt', 'popular', 'Popular anime', b.anime.popular, '🔥'),
        new ButtonBuilder().setCustomId(id(owner, 'bulfav')).setLabel('Add or remove a club').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id(owner, 'bultrack')).setLabel('Add or remove a show').setEmoji('📺').setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  if (page === 'cotd') {
    title = 'Character of the day';
    body = 'Every morning (about 9:00 in India) I post one well-loved anime character from AniList in this channel. Anyone can see today\'s with `tz cotd`.';
    fields.push({ name: '📣 Channel', value: ch(g.daily.channel), inline: true });
    comps.push(
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'cotdch')).setPlaceholder('🎭 Channel for the daily character (empty = off)')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1).setDefaultChannels(g.daily.channel ? [g.daily.channel] : [])),
      row(back(owner)),
    );
  }

  if (page === 'tickets') {
    title = 'Tickets';
    const t = g.tickets;
    body = 'Pick a category for ticket channels, the staff role that can see them, and a channel for transcripts. Then press **Post the panel here** in the channel where people should open tickets.';
    fields.push(
      { name: '📁 Category', value: t.category ? `<#${t.category}>` : '*top of the list*', inline: true },
      { name: '🛡️ Staff', value: t.staff ? `<@&${t.staff}>` : '*admins only*', inline: true },
      { name: '🧾 Transcripts', value: ch(t.log), inline: true },
    );
    comps.push(
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'tkcat')).setPlaceholder('📁 Category for ticket channels')
        .setChannelTypes(ChannelType.GuildCategory).setMinValues(0).setMaxValues(1).setDefaultChannels(t.category ? [t.category] : [])),
      row(new RoleSelectMenuBuilder().setCustomId(id(owner, 'tkstaff')).setPlaceholder('🛡️ Staff role that sees tickets')
        .setMinValues(0).setMaxValues(1).setDefaultRoles(t.staff ? [t.staff] : [])),
      row(new ChannelSelectMenuBuilder().setCustomId(id(owner, 'tklog')).setPlaceholder('🧾 Transcript channel (empty = none)')
        .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setDefaultChannels(t.log ? [t.log] : [])),
      row(
        new ButtonBuilder().setCustomId(id(owner, 'tkpost')).setLabel('Post the panel here').setEmoji('🎫').setStyle(ButtonStyle.Success),
        back(owner),
      ),
    );
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

function rewardModal(owner: string, what: string, arg: string, title: string, name: string, level: string) {
  return new ModalBuilder().setCustomId(modalId(owner, what, arg)).setTitle(title).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Role name').setStyle(TextInputStyle.Short)
      .setRequired(true).setMaxLength(100).setValue(name)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('level').setLabel('At which level (empty removes the reward)').setStyle(TextInputStyle.Short)
      .setRequired(what !== 'rwedit').setMaxLength(3).setValue(level)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Colour, like #c2a46e (optional)').setStyle(TextInputStyle.Short)
      .setRequired(false).setMaxLength(7)),
  );
}

function formModal(owner: string, what: string, arg: string, title: string, inputs: { id: string; label: string; value: string; required?: boolean; long?: boolean; max?: number; hint?: string }[]) {
  return new ModalBuilder().setCustomId(modalId(owner, what, arg)).setTitle(title.slice(0, 45)).addComponents(
    inputs.map((x) => {
      const input = new TextInputBuilder().setCustomId(x.id).setLabel(x.label).setStyle(x.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(x.required ?? false).setMaxLength(x.max ?? 20);
      if (x.value) input.setValue(x.value);
      if (x.hint) input.setPlaceholder(x.hint);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    }),
  );
}

const num = (raw: string) => (raw.trim() === '' ? null : Number(raw.trim().replace(/x$/i, '')));

export const isBotOwner = (guild: Guild, userId: string) => {
  const o = guild.client?.application?.owner;
  return !!o && ('members' in o ? o.members.has(userId) : o.id === userId);
};

const parseColor = (c: string) => (/^#?[0-9a-f]{6}$/i.test(c) ? Number.parseInt(c.replace('#', ''), 16) : undefined);

async function canGive(guild: Guild, roleId: string) {
  const me = await guild.members.fetchMe();
  const r = await guild.roles.fetch(roleId).catch(() => null);
  return !!r && !r.managed && r.id !== guild.id && r.position < me.roles.highest.position;
}

const pageOf: Record<string, string> = {
  mod: 'f', p2help: 'f', modch: 'f', modrole: 'f', wch: 'welcome', gch: 'welcome', wtext: 'welcome', gtext: 'welcome', wreset: 'welcome', boost: 'welcome', boostch: 'welcome',
  arole: 'autorole', logch: 'mod', staff: 'mod', am: 'mod', lvch: 'levels', lvon: 'levels', ann: 'levels', rwrole: 'rewards', rwdel: 'rewards', rw: 'rewards',
  rwranks: 'rewards', rwnew: 'rewards', rwedit: 'rewards', gifm: 'gifs', gif: 'gifs', prefix: 'home',
  clean: 'home', errch: 'mod', sbch: 'starboard', sbmin: 'starboard', sbemoji: 'starboard', sbself: 'starboard',
  qch: 'quotes', commbuild: 'quotes', recap: 'quotes', bulbuild: 'bulletins', bulon: 'bulletins', bulopt: 'bulletins', bulfav: 'bulletins', bultrack: 'bulletins', f1look: 'bulletins', cotdch: 'cotd', tkcat: 'tickets', tkstaff: 'tickets', tklog: 'tickets', tkpost: 'tickets', bdch: 'birthdays', bdrole: 'birthdays', bdmsg: 'birthdays',
  noxpch: 'levels', noxprole: 'lvxp', rboost: 'lvxp', cboost: 'lvxp', rb: 'lvxp', cb: 'lvxp', xprate: 'lvxp', event: 'lvxp', stack: 'lvxp', lvmsg: 'lvxp',
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
  const text = i.isModalSubmit() && i.fields.fields.has('v') ? i.fields.getTextInputValue('v').trim() : '';
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
    if (action === 'rwnew') { await i.showModal(rewardModal(owner, 'rwnew', '', 'New reward role', '', '10')); return true; }
    if (action === 'rwedit') {
      const lvl = values[0];
      const role = await i.guild.roles.fetch(g.levels.rewards[lvl]).catch(() => null);
      await i.showModal(rewardModal(owner, 'rwedit', lvl, `Reward at level ${lvl}`, role?.name ?? '', lvl));
      return true;
    }
    if (action === 'rwranks') {
      // one role per Agency rank, sand coloured, placed just under Texz so it can hand them out
      const me = await i.guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return fail('I need the Manage Roles permission to make roles.');
      await i.deferUpdate();
      const shades = [0x8a8172, 0x9c8f78, 0xad9c7c, 0xc2a46e, 0xc9a35a, 0xd1a046, 0xd99a33, 0xe0901f, 0xe8850c];
      let made = 0;
      for (const [n, r] of ranks.filter((x) => x.at > 0).entries()) {
        if (g.levels.rewards[String(r.at)]) continue;
        const existing = i.guild.roles.cache.find((x) => x.name === r.name);
        const role = existing ?? await i.guild.roles.create({ name: r.name, colors: { primaryColor: shades[n] ?? 0xc2a46e }, reason: 'Agency rank roles from /setup' }).catch(() => null);
        if (role) { g.levels.rewards[String(r.at)] = role.id; made++; }
      }
      store.saveGuild(i.guild.id, g);
      // highest rank on top, all of them just under Texz, the top ranks shown separately in the member list
      const ordered = await fixRankOrder(i.guild, g.levels.rewards);
      if (!g.levels.stack) await carryRankPerms(i.guild, g.levels.rewards);
      await applyPerks(store, i.guild);
      const tidied = await tidyRanks(store, i.guild);
      const list = Object.entries(g.levels.rewards).map(([lvl, rid]) => ({ lvl: Number(lvl), role: i.guild!.roles.cache.get(rid) })).filter((x) => x.role && x.role.position < me.roles.highest.position).sort((a, b) => a.lvl - b.lvl);
      for (const x of list) {
        const p = perks[rankFor(x.lvl).name];
        if (p && x.role!.hoist !== p.hoist && rankFor(x.lvl).at === x.lvl) await x.role!.setHoist(p.hoist, 'rank perk').catch(() => {});
      }
      await i.editReply(setupPanel(store, i.guild, owner, 'rewards'));
      await i.followUp({ content: `${made ? `✨ ${made} rank roles made. ` : ''}${ordered ? 'Ranks are in order, highest on top,' : '⚠️ Some rank roles couldn\'t move, drag the Texz role above them and press this again.'} every rank has its own spot in the member list, and gifs, images, emojis and the rest now unlock by rank.${tidied ? ` ${tidied} members had extra rank roles, now they keep just their highest.` : ''} \`tz perks\` shows what each one earns.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'rboost' || action === 'cboost') {
      const target = values[0];
      const now = (action === 'rboost' ? g.levels.roleBoosts : g.levels.channelBoosts)[target];
      const label = action === 'rboost' ? i.guild.roles.cache.get(target)?.name ?? 'role' : i.guild.channels.cache.get(target)?.name ?? 'channel';
      await i.showModal(formModal(owner, action === 'rboost' ? 'rb' : 'cb', target, `Boost for ${label}`, [
        { id: 'x', label: 'Multiplier, like 1.5 or 2 (1 removes it)', value: now ? String(now) : '', required: true, max: 5, hint: '2' },
      ]));
      return true;
    }
    if (action === 'xprate') {
      const l = g.levels;
      await i.showModal(formModal(owner, 'xprate', '', 'Xp rate', [
        { id: 'min', label: 'Least xp per message', value: String(l.min), required: true, max: 4 },
        { id: 'max', label: 'Most xp per message', value: String(l.max), required: true, max: 4 },
        { id: 'cd', label: 'Seconds between counted messages', value: String(l.cooldown), required: true, max: 4 },
        { id: 'wk', label: 'Weekend multiplier (1 = off)', value: String(l.weekend), required: true, max: 4 },
      ]));
      return true;
    }
    if (action === 'event') {
      const b = g.levels.boost && g.levels.boost.until > Date.now() ? g.levels.boost : null;
      await i.showModal(formModal(owner, 'event', '', 'Boost event', [
        { id: 'x', label: 'Multiplier (1 or empty cancels the event)', value: b ? String(b.x) : '2', max: 5 },
        { id: 'for', label: 'How long, like 3h, 2d or 1d12h', value: '', hint: b ? 'leave empty to keep the current end' : '24h', max: 20 },
        { id: 'in', label: 'Starts in (30m, 2h) or a <t:unix> stamp', value: '', hint: 'empty = right now', max: 20 },
        { id: 'name', label: 'Name, shows on rank cards (optional)', value: b?.name ?? '', hint: 'Anniversary week', max: 40 },
      ]));
      return true;
    }
    if (action === 'agency') {
      await i.deferUpdate();
      const msg = await buildAgency(store, i.guild).catch((e: unknown) => `Something went wrong: ${e instanceof Error ? e.message : e}`);
      await i.editReply(setupPanel(store, i.guild, owner, 'home'));
      await i.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'allon' || action === 'alloff') {
      const on = action === 'allon';
      for (const m of switchable()) g.modules[m.name] = { ...defaultRules(m.name), ...g.modules[m.name], enabled: on };
      store.saveGuild(i.guild.id, g);
      void botLog(i.guild, store, `🧩 <@${i.user.id}> switched **every feature ${on ? 'on' : 'off'}**.`);
      await i.update(setupPanel(store, i.guild, owner, 'features'));
      return true;
    }
    if (action === 'commbuild') {
      await i.deferUpdate();
      const msg = await buildAgency(store, i.guild).catch((e: unknown) => `Something went wrong: ${e instanceof Error ? e.message : e}`);
      await i.editReply(setupPanel(store, i.guild, owner, 'quotes'));
      await i.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'bulbuild') {
      await i.deferUpdate();
      const msg = await buildBoard(store, i.guild).catch((e) => `Something went wrong: ${e instanceof Error ? e.message : e}`);
      await i.editReply(setupPanel(store, i.guild, owner, 'bulletins'));
      await i.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'bultrack') {
      await i.showModal(formModal(owner, 'bultrack', '', 'Anime show', [
        { id: 'v', label: 'Show title (again to remove it)', value: '', required: true, max: 100, hint: 'Frieren' },
      ]));
      return true;
    }
    if (action === 'bulfav') {
      await i.showModal(formModal(owner, 'bulfav', '', 'Favourite club', [
        { id: 'v', label: 'Club name (again to remove it)', value: '', required: true, max: 40, hint: 'Real Madrid' },
      ]));
      return true;
    }
    if (action === 'sbemoji') {
      await i.showModal(formModal(owner, 'sbemoji', '', 'Starboard emoji', [
        { id: 'v', label: 'One emoji, like ⭐ or 🔥 or a server emoji', value: g.starboard.emoji, required: true, max: 60 },
      ]));
      return true;
    }
    if (action === 'tkpost') {
      const here = i.channel;
      if (!here?.isSendable()) return fail('I can\'t post in this channel.');
      await here.send(ticketPanel()).catch(() => null);
      await i.reply({ content: '🎫 Panel posted. People press the button to open a ticket.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'bdmsg') {
      await i.showModal(formModal(owner, 'bdmsg', '', 'Birthday greeting', [
        { id: 'v', label: 'Use {user} {name} {server}', value: g.birthdays.message ?? '', long: true, max: 300, hint: 'Empty brings back my own lines' },
      ]));
      return true;
    }
    if (action === 'lvmsg') {
      await i.showModal(formModal(owner, 'lvmsg', '', 'Level-up line', [
        { id: 'v', label: 'Use {user} {name} {level} {rank} {server}', value: g.levels.message ?? '', long: true, max: 300, hint: 'Empty brings back my own lines' },
      ]));
      return true;
    }
    if (action === 'preview') {
      const me = i.member as GuildMember;
      await i.reply({ embeds: [welcomeCard(store, me)], flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'f1look') store.setKv(`f1theme:${i.guild.id}`, store.getKv(`f1theme:${i.guild.id}`) === 'agency' ? 'mafia' : 'agency');
    if (action === 'recap') store.setKv(`recap:${i.guild.id}`, store.getKv(`recap:${i.guild.id}`) === 'off' ? 'on' : 'off');
    if (action === 'p2help') setP2Helper(store, i.guild.id, !p2HelperOn(store, i.guild.id));
    if (action === 'mod') {
      g.modules[arg] = { ...defaultRules(arg), ...g.modules[arg], enabled: !store.rules(i.guild.id, arg).enabled };
      void botLog(i.guild, store, `🧩 <@${i.user.id}> switched **${switchable().find((m) => m.name === arg)?.label ?? arg}** ${g.modules[arg].enabled ? 'on' : 'off'}.`);
    }
    if (action === 'modch') g.modules[arg] = { ...defaultRules(arg), ...g.modules[arg], channels: values };
    if (action === 'modrole') g.modules[arg] = { ...defaultRules(arg), ...g.modules[arg], roles: values };
    if (action === 'wch') g.welcome.channel = values[0] ?? null;
    if (action === 'gch') g.welcome.goodbyeChannel = values[0] ?? null;
    if (action === 'boostch') store.setKv(`boostch:${i.guild.id}`, values[0] ?? null);
    if (action === 'boost') {
      const on = !boostOn(store, i.guild.id);
      store.setKv(`boostann:${i.guild.id}`, on ? 'on' : null);
      void botLog(i.guild, store, `💎 <@${i.user.id}> switched booster thank-yous ${on ? 'on' : 'off'}.`);
    }
    if (action === 'wreset') { g.welcome.message = null; g.welcome.goodbyeMessage = null; }
    if (action === 'arole') {
      if (values[0] && !(await canGive(i.guild, values[0]))) return fail('I can\'t hand out that role. Move my role above it in Server Settings → Roles, then try again.');
      g.welcome.autorole = values[0] ?? null;
    }
    if (action === 'logch') g.mod.logChannel = values[0] ?? null;
    if (action === 'staff') store.setKv(`staffroles:${i.guild.id}`, JSON.stringify(values));
    if (action === 'am' && (arg === 'invites' || arg === 'spam' || arg === 'mentions')) g.mod[arg] = !g.mod[arg];
    if (action === 'lvch') g.levels.channel = values[0] ?? null;
    if (action === 'ann') g.levels.announce = !g.levels.announce;
    if (action === 'lvon') g.modules.levels = { ...defaultRules('levels'), ...g.modules.levels, enabled: !store.rules(i.guild.id, 'levels').enabled };
    if (action === 'rwdel') delete g.levels.rewards[values[0]];
    if (action === 'noxpch') g.levels.noXpChannels = values;
    if (action === 'noxprole') g.levels.noXpRoles = values;
    if (action === 'stack') g.levels.stack = !g.levels.stack;
    if (action === 'clean') g.autoclean = Number(values[0]) || 0;
    if (action === 'sbch') g.starboard.channel = values[0] ?? null;
    if (action === 'cotdch') g.daily.channel = values[0] ?? null;
    if (action === 'qch') g.quotes.channel = values[0] ?? null;
    if (action === 'bulon' && (arg === 'f1' || arg === 'football' || arg === 'anime')) g.bulletins[arg].on = !g.bulletins[arg].on;
    if (action === 'bulopt') {
      if (arg === 'facts') g.bulletins.f1.facts = !g.bulletins.f1.facts;
      if (arg === 'big') g.bulletins.football.big = !g.bulletins.football.big;
      if (arg === 'popular') g.bulletins.anime.popular = !g.bulletins.anime.popular;
    }
    if (action === 'sbmin') g.starboard.min = Number(values[0]) || 3;
    if (action === 'sbself') g.starboard.self = !g.starboard.self;
    if (action === 'tkcat') g.tickets.category = values[0] ?? null;
    if (action === 'tkstaff') g.tickets.staff = values[0] ?? null;
    if (action === 'tklog') g.tickets.log = values[0] ?? null;
    if (action === 'errch' && isBotOwner(i.guild, i.user.id)) store.setKv('errorChannel', values[0] ?? null);
    if (action === 'bdch') g.birthdays.channel = values[0] ?? null;
    if (action === 'bdrole') {
      if (values[0] && !(await canGive(i.guild, values[0]))) return fail('I can\'t hand out that role. Move my role above it in Server Settings → Roles, then try again.');
      g.birthdays.role = values[0] ?? null;
    }
  } else {
    if (!i.isModalSubmit()) return true;
    if (action === 'wtext') g.welcome.message = text;
    if (action === 'gtext') g.welcome.goodbyeMessage = text;
    if (action === 'rw') {
      const lvl = Number.parseInt(text, 10);
      if (!(lvl >= 1 && lvl <= 200)) return fail('Level has to be a number from 1 to 200.');
      g.levels.rewards[String(lvl)] = arg;
    }
    if (action === 'rwnew' || action === 'rwedit') {
      const name = i.fields.getTextInputValue('name').trim();
      const lvlRaw = i.fields.getTextInputValue('level').trim();
      const color = parseColor(i.fields.getTextInputValue('color').trim());
      const lvl = lvlRaw ? Number.parseInt(lvlRaw, 10) : null;
      if (lvlRaw && !(lvl! >= 1 && lvl! <= 200)) return fail('Level has to be a number from 1 to 200.');
      if (action === 'rwnew') {
        const me = await i.guild.members.fetchMe();
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return fail('I need the Manage Roles permission to make roles.');
        const role = await i.guild.roles.create({ name, colors: color !== undefined ? { primaryColor: color } : undefined, reason: 'reward role from /setup' }).catch(() => null);
        if (!role) return fail('Discord wouldn\'t let me make that role.');
        g.levels.rewards[String(lvl)] = role.id;
      } else {
        const roleId = g.levels.rewards[arg];
        const role = roleId ? await i.guild.roles.fetch(roleId).catch(() => null) : null;
        if (role && (role.name !== name || color !== undefined)) {
          const ok = await role.edit({ name, ...(color !== undefined ? { colors: { primaryColor: color } } : {}) }).then(() => true).catch(() => false);
          if (!ok) return fail('I couldn\'t edit that role, it might sit above mine.');
        }
        delete g.levels.rewards[arg];
        if (lvl && roleId) g.levels.rewards[String(lvl)] = roleId;
      }
    }
    if (action === 'rb' || action === 'cb') {
      const x = num(i.fields.getTextInputValue('x'));
      if (x === null || Number.isNaN(x) || x < 0.1 || x > 5) return fail('Multiplier has to be between 0.1 and 5. Use `1` to remove the boost.');
      const map = action === 'rb' ? g.levels.roleBoosts : g.levels.channelBoosts;
      if (x === 1) delete map[arg];
      else map[arg] = Math.round(x * 100) / 100;
    }
    if (action === 'xprate') {
      const [min, max, cd, wk] = ['min', 'max', 'cd', 'wk'].map((k) => num(i.fields.getTextInputValue(k)));
      if (!Number.isInteger(min) || !Number.isInteger(max) || min! < 1 || max! < min! || max! > 1000) return fail('Xp per message: whole numbers, at least 1, the most can\'t be below the least, and 1000 tops.');
      if (!Number.isInteger(cd) || cd! < 0 || cd! > 3600) return fail('The gap is in seconds, from 0 to 3600.');
      if (wk === null || Number.isNaN(wk) || wk < 1 || wk > 5) return fail('Weekend multiplier goes from 1 (off) to 5.');
      Object.assign(g.levels, { min, max, cooldown: cd, weekend: Math.round(wk * 100) / 100 });
    }
    if (action === 'event') {
      const x = num(i.fields.getTextInputValue('x'));
      if (x === null || x === 1) g.levels.boost = null;
      else {
        if (Number.isNaN(x) || x < 1.1 || x > 5) return fail('Event multiplier goes from 1.1 to 5, or 1 to cancel.');
        const forRaw = i.fields.getTextInputValue('for').trim();
        const inRaw = i.fields.getTextInputValue('in').trim();
        const old = g.levels.boost && g.levels.boost.until > Date.now() ? g.levels.boost : null;
        const length = parseLength(forRaw);
        // a Discord timestamp (<t:1767225600>) or unix seconds pins an exact start, otherwise it's "in 2h"
        const stamp = inRaw.match(/^(?:<t:)?(\d{10})/)?.[1];
        const delay = stamp ? Math.max(0, Number(stamp) * 1000 - Date.now()) : inRaw && inRaw.toLowerCase() !== 'now' ? parseLength(inRaw) : 0;
        if (forRaw && !length) return fail('How long? Something like `3h`, `2d` or `1d12h`.');
        if (!length && !old) return fail('A new event needs a length, like `24h`.');
        if (delay === null) return fail('Starts in? Something like `30m` or `2h`, or leave it empty for now.');
        if ((length ?? 0) > 30 * 86_400_000 || delay > 30 * 86_400_000) return fail('Keep it within 30 days.');
        const from = inRaw ? Date.now() + delay : old?.from ?? Date.now();
        const until = length ? from + length : old!.until;
        if (until <= from) return fail('That would end before it starts. Give it a length too.');
        g.levels.boost = { x: Math.round(x * 100) / 100, from, until, name: i.fields.getTextInputValue('name').trim() };
      }
    }
    if (action === 'lvmsg') g.levels.message = i.fields.getTextInputValue('v').trim() || null;
    if (action === 'bultrack') {
      const want = i.fields.getTextInputValue('v').trim();
      const [m] = await searchMedia(want, 'ANIME').catch(() => []);
      if (!m) return fail(`Nothing called "${want}" on AniList.`);
      const shows = g.bulletins.anime.shows;
      const at = shows.findIndex((x) => x.id === m.id);
      if (at >= 0) shows.splice(at, 1); else shows.push({ id: m.id, title: titleOf(m) });
    }
    if (action === 'bulfav') {
      const club = i.fields.getTextInputValue('v').trim();
      const favs = g.bulletins.football.favs;
      const at = favs.findIndex((f) => f.toLowerCase() === club.toLowerCase());
      if (at >= 0) favs.splice(at, 1); else if (club) favs.push(club.slice(0, 40));
    }
    if (action === 'sbemoji') {
      // a plain emoji, or a server one written as <:name:id>
      const v = i.fields.getTextInputValue('v').trim();
      if (!/^(<a?:\w+:\d+>|\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*)$/u.test(v)) return fail('That needs to be one emoji.');
      g.starboard.emoji = v;
    }
    if (action === 'bdmsg') g.birthdays.message = i.fields.getTextInputValue('v').trim() || null;
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
