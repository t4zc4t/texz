import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, type Interaction, type MessageActionRowComponentBuilder, SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder, type Client, type GuildMember, type PermissionResolvable,
} from 'discord.js';
import type { Case, Store } from '../db.js';
import type { Ctx } from '../core/ctx.js';
import type { Command, Module } from '../core/module.js';
import { RED, card, say, type Kind } from '../theme.js';

const unix = (ms: number) => Math.floor(ms / 1000);

// "10m", "2h", "1d 3h", "90s" into milliseconds
export function parseLength(raw: string | null): number | null {
  if (!raw) return null;
  let ms = 0;
  for (const m of raw.toLowerCase().matchAll(/(\d+)\s*(s|sec|m|min|h|hr|d|day|w|week)s?/g)) {
    const n = Number(m[1]);
    const unit = m[2][0];
    ms += n * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as Record<string, number>)[unit];
  }
  return ms || null;
}

export const human = (ms: number) => {
  const d = Math.floor(ms / 86_400_000); const h = Math.floor((ms % 86_400_000) / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000);
  return [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || `${Math.round(ms / 1000)}s`;
};

// posts to the server's log channel, if it has one
// server goings-on (joins, edits, deletes) go to the surveillance room when the layout made one
export async function log(client: Client, store: Store, guildId: string, e: EmbedBuilder, kind: 'mod' | 'server' = 'mod') {
  const id = (kind === 'server' ? store.getKv(`serverlog:${guildId}`) : null) ?? store.guild(guildId).mod.logChannel;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  // the log keeps it plain, no gif filling the channel
  const plain = new EmbedBuilder(e.toJSON()).setImage(null);
  if (ch?.isSendable()) await ch.send({ embeds: [plain], allowedMentions: { parse: [] } }).catch(() => {});
}

// the person running the command needs the permission, and both they and Texz must sit above the target
export async function target(ctx: Ctx, perm: PermissionResolvable, need = true): Promise<{ me: GuildMember; them: GuildMember | null } | string> {
  if (!ctx.guild || !ctx.member) return 'That only works inside a server.';
  if (!ctx.member.permissions.has(perm)) return 'You don\'t have the authority for that, partner.';
  const me = await ctx.guild.members.fetchMe();
  if (!me.permissions.has(perm)) return 'I don\'t have the permission for that here. Give me the right role first.';
  const id = ctx.user('user');
  if (!id) return need ? 'Who? Mention someone.' : { me, them: null } as never;
  const them = await ctx.guild.members.fetch(id).catch(() => null);
  if (!them) return need ? 'They aren\'t in this server.' : { me, them: null } as never;
  if (them.id === ctx.userId) return 'Doing that to yourself? I admire the drama, but no.';
  if (them.id === ctx.guild.ownerId) return 'That\'s the owner. Even I don\'t have the nerve.';
  if (ctx.member.id !== ctx.guild.ownerId && them.roles.highest.position >= ctx.member.roles.highest.position) return 'They\'re ranked the same as you or higher. Office politics, I\'m afraid.';
  if (them.roles.highest.position >= me.roles.highest.position) return `🔧 Their top role **${them.roles.highest.name}** sits at or above mine (**${me.roles.highest.name}**). Drag my role above theirs in Server Settings → Roles and I'll handle it.`;
  return { me, them };
}

// the reply in chat is one short line, the full card goes to the log channel
export function brief(e: EmbedBuilder) {
  const d = e.toJSON();
  const f = (name: string) => d.fields?.find((x) => x.name.includes(name))?.value;
  const parts = [f('Who') && `${f('Who')}`, f('Until') && `until ${f('Until')}`, f('Back') && `back ${f('Back')}`, f('Warnings') && f('Warnings')].filter(Boolean);
  const why = f('Reason');
  return { content: `**${d.title}**${parts.length ? ` · ${parts.join(' · ')}` : ''}${why && why !== '-' ? `\n-# ${why}` : ''}`, temp: false };
}

export function actionCard(kind: Kind, title: string, emoji: string, who: string, by: string, reason: string, extra: { name: string; value: string; inline?: boolean }[] = []) {
  return card({
    kind, title, emoji, color: RED,
    fields: [
      { name: '👤 Who', value: who, inline: true },
      { name: '🕵️ By', value: `<@${by}>`, inline: true },
      ...extra,
      { name: '📝 Reason', value: reason, inline: false },
    ],
  });
}

export async function tellThem(them: GuildMember, text: string) {
  await them.send(text).catch(() => {});
}

type Builder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
const user = (o: Builder) => o.addUserOption((x) => x.setName('user').setDescription('Who').setRequired(true));
const reason = (o: Builder) => o.addStringOption((x) => x.setName('reason').setDescription('Why').setMaxLength(300));

const warn: Command = {
  name: 'warn',
  group: 'staff',
  data: reason(user(new SlashCommandBuilder().setName('warn').setDescription('Warn someone, it goes in their file')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false))).toJSON(),
  text: { args: ['user', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.ModerateMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const why = ctx.str('reason') ?? say('noReason');
    const num = store.addCase({ guild_id: ctx.guildId!, type: 'warn', user_id: t.them!.id, user_name: t.them!.user.username, mod_id: ctx.userId, reason: why });
    const count = store.findCases(ctx.guildId!, { user: t.them!.id, type: 'warn' }, 1).total;
    await tellThem(t.them!, `⚠️ You were warned in **${ctx.guild!.name}**: ${why}`);
    const e = actionCard('warn', `Case #${num} · Warning`, '⚠️', `<@${t.them!.id}>`, ctx.userId, why, [{ name: '📒 Warnings', value: `${count} on file`, inline: true }]);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply(brief(e));
  },
};

const timeout: Command = {
  name: 'timeout',
  group: 'staff',
  data: reason(user(new SlashCommandBuilder().setName('timeout').setDescription('No Longer Human: mute someone for a while')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false))
    .addStringOption((x) => x.setName('length').setDescription('Like 10m, 2h, 1d (max 28d), or off to lift it').setRequired(true))).toJSON(),
  text: { aliases: ['mute', 'nullify', 'to'], args: ['user', 'length', 'reason'] },
  run: async (ctx, store) => {
    if (/^(off|0|none|lift)$/i.test(ctx.str('length') ?? '')) return untimeout.run(ctx, store);
    const t = await target(ctx, PermissionFlagsBits.ModerateMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const ms = parseLength(ctx.str('length'));
    if (!ms || ms > 28 * 86_400_000) return ctx.reply('Give me a length like `10m`, `2h` or `1d`, up to 28 days.');
    const why = ctx.str('reason') ?? say('noReason');
    await t.them!.timeout(ms, why);
    const num = store.addCase({ guild_id: ctx.guildId!, type: 'timeout', user_id: t.them!.id, user_name: t.them!.user.username, mod_id: ctx.userId, reason: why, until: Date.now() + ms });
    await tellThem(t.them!, `🔇 You were timed out in **${ctx.guild!.name}** for ${human(ms)}: ${why}`);
    const e = actionCard('timeout', `Case #${num} · No Longer Human`, '🩹', `<@${t.them!.id}>`, ctx.userId, why, [{ name: '⏳ Until', value: `<t:${unix(Date.now() + ms)}:R>`, inline: true }]);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply(brief(e));
  },
};

const untimeout: Command = {
  name: 'untimeout',
  // "/mod timeout length:off" does the same on slash
  hidden: true,
  data: user(new SlashCommandBuilder().setName('untimeout').setDescription('Give someone their voice back')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false)).toJSON(),
  text: { aliases: ['unmute'], args: ['user'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.ModerateMembers);
    if (typeof t === 'string') return ctx.reply(t);
    await t.them!.timeout(null);
    const num = store.addCase({ guild_id: ctx.guildId!, type: 'untimeout', user_id: t.them!.id, user_name: t.them!.user.username, mod_id: ctx.userId, reason: 'timeout lifted' });
    const e = actionCard('unban', `Case #${num} · Voice restored`, '🔊', `<@${t.them!.id}>`, ctx.userId, 'timeout lifted');
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply(brief(e));
  },
};

const kick: Command = {
  name: 'kick',
  group: 'staff',
  data: reason(user(new SlashCommandBuilder().setName('kick').setDescription('Show someone the door')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers).setDMPermission(false))).toJSON(),
  text: { args: ['user', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.KickMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const why = ctx.str('reason') ?? say('noReason');
    await tellThem(t.them!, `👢 You were kicked from **${ctx.guild!.name}**: ${why}`);
    await t.them!.kick(why);
    const num = store.addCase({ guild_id: ctx.guildId!, type: 'kick', user_id: t.them!.id, user_name: t.them!.user.username, mod_id: ctx.userId, reason: why });
    const e = actionCard('kick', `Case #${num} · Shown the door`, '👢', `${t.them!.user.username} (\`${t.them!.id}\`)`, ctx.userId, why);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply(brief(e));
  },
};

const ban: Command = {
  name: 'ban',
  group: 'staff',
  data: reason(user(new SlashCommandBuilder().setName('ban').setDescription('Banish someone, for good or for a while')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).setDMPermission(false)))
    .addStringOption((x) => x.setName('length').setDescription('Temporary ban, like 1d or 2w (empty = forever)'))
    .addIntegerOption((x) => x.setName('clear').setDescription('Delete their messages from the last N days').setMinValue(0).setMaxValue(7)).toJSON(),
  // "tz ban @x 3d spamming" is a temp ban, "tz ban @x spamming" is forever
  text: { aliases: ['tempban'], args: ['user', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.BanMembers);
    if (typeof t === 'string') return ctx.reply(t);
    let lengthRaw = ctx.str('length');
    let why = ctx.str('reason');
    if (ctx.viaText && why) {
      const [first, ...rest] = why.split(/\s+/);
      if (/^(\d+(s|m|h|d|w))+$/i.test(first)) { lengthRaw = first; why = rest.join(' ') || null; }
    }
    const ms = lengthRaw ? parseLength(lengthRaw) : null;
    if (lengthRaw && (!ms || ms < 60_000 || ms > 365 * 86_400_000)) return ctx.reply('Ban length should look like `1d`, `12h` or `2w`, from a minute to a year.');
    why ??= say('noReason');
    const until = ms ? Date.now() + ms : null;
    await tellThem(t.them!, `🔨 You were banned from **${ctx.guild!.name}**${ms ? ` for ${human(ms)}` : ''}: ${why}`);
    await t.them!.ban({ reason: why, deleteMessageSeconds: (ctx.int('clear') ?? 0) * 86_400 });
    const num = store.addCase({ guild_id: ctx.guildId!, type: ms ? 'tempban' : 'ban', user_id: t.them!.id, user_name: t.them!.user.username, mod_id: ctx.userId, reason: why, until, open: !!ms });
    const e = actionCard(ms ? 'tempban' : 'ban', `Case #${num} · ${ms ? 'Sent on holiday' : 'Banished'}`, '🔨', `${t.them!.user.username} (\`${t.them!.id}\`)`, ctx.userId, why,
      until ? [{ name: '⏳ Back', value: `<t:${unix(until)}:R>`, inline: true }] : []);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply(brief(e));
  },
};

const unban: Command = {
  name: 'unban',
  group: 'staff',
  data: new SlashCommandBuilder().setName('unban').setDescription('Pardon a banned user by their ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).setDMPermission(false)
    .addStringOption((x) => x.setName('id').setDescription('Their user ID').setRequired(true)).toJSON(),
  text: { args: ['id'] },
  run: async (ctx, store) => {
    if (!ctx.guild || !ctx.member?.permissions.has(PermissionFlagsBits.BanMembers)) return ctx.reply('You don\'t have the authority for that, partner.');
    const id = ctx.str('id')?.replace(/\D/g, '');
    if (!id) return ctx.reply('I need their user ID.');
    const done = await ctx.guild.members.unban(id).then(() => true).catch(() => false);
    if (!done) return ctx.reply('Couldn\'t unban that ID. Are they actually banned?');
    store.closeCases(ctx.guild.id, id, 'tempban');
    const num = store.addCase({ guild_id: ctx.guild.id, type: 'unban', user_id: id, mod_id: ctx.userId, reason: 'pardoned' });
    const e = actionCard('unban', `Case #${num} · Pardoned`, '🕊️', `\`${id}\``, ctx.userId, 'unbanned');
    await log(ctx.guild.client, store, ctx.guild.id, e);
    return ctx.reply(brief(e));
  },
};

const purge: Command = {
  name: 'purge',
  group: 'staff',
  data: new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages here, optionally from one person')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).setDMPermission(false)
    .addIntegerOption((x) => x.setName('amount').setDescription('How many, up to 100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((x) => x.setName('user').setDescription('Only their messages')).toJSON(),
  text: { aliases: ['clear', 'clean'], args: ['amount', 'user'] },
  run: async (ctx, store) => {
    if (!ctx.guild || !ctx.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return ctx.reply('You don\'t have the authority for that, partner.');
    const n = Math.min(Math.max(ctx.int('amount') ?? 0, 1), 100);
    const ch = await ctx.guild.channels.fetch(ctx.channelId).catch(() => null);
    if (!ch || !ch.isTextBased() || !('bulkDelete' in ch)) return ctx.reply('Can\'t purge here.');
    const who = ctx.user('user');
    let msgs = await ch.messages.fetch({ limit: who ? 100 : Math.min(n + (ctx.viaText ? 1 : 0), 100) });
    if (who) msgs = msgs.filter((m) => m.author.id === who);
    // discord refuses to bulk delete anything older than two weeks
    const fresh = msgs.filter((m) => Date.now() - m.createdTimestamp < 14 * 86_400_000).first(who ? n : msgs.size);
    const gone = await ch.bulkDelete(fresh, true).catch(() => null);
    const count = gone?.size ?? 0;
    await log(ctx.guild.client, store, ctx.guild.id, actionCard('purge', 'Messages swept', '🧹', who ? `<@${who}>` : 'everyone', ctx.userId, `${count} in <#${ctx.channelId}>`));
    const r = await ctx.reply({ content: `🧹 **${count}** message${count === 1 ? '' : 's'} gone. ${say('purge')}`, temp: true });
    // the confirmation tidies itself away too
    if (ctx.viaText && r && 'delete' in (r as object)) setTimeout(() => void (r as { delete: () => Promise<unknown> }).delete().catch(() => {}), 5000);
    return r;
  },
};

const lock: Command = {
  name: 'lock',
  group: 'staff',
  data: new SlashCommandBuilder().setName('lock').setDescription('Lock or unlock this channel for everyone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).setDMPermission(false)
    .addBooleanOption((x) => x.setName('on').setDescription('Lock (true) or unlock (false)')).toJSON(),
  text: { args: ['on'] },
  run: async (ctx, store) => {
    if (!ctx.guild || !ctx.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return ctx.reply('You don\'t have the authority for that, partner.');
    const ch = await ctx.guild.channels.fetch(ctx.channelId).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) return ctx.reply('Only works in a normal text channel.');
    const on = ctx.bool('on') ?? true;
    await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: on ? false : null });
    const e = card({ kind: on ? 'lock' : 'unlock', title: on ? 'Channel locked' : 'Channel unlocked', emoji: on ? '🔒' : '🔓', gif: 'off' });
    await log(ctx.guild.client, store, ctx.guild.id, actionCard(on ? 'lock' : 'unlock', on ? 'Channel locked' : 'Channel unlocked', on ? '🔒' : '🔓', `<#${ch.id}>`, ctx.userId, '-'));
    return ctx.reply(brief(e));
  },
};

const slowmode: Command = {
  name: 'slowmode',
  group: 'staff',
  data: new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode here, 0 turns it off')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).setDMPermission(false)
    .addStringOption((x) => x.setName('length').setDescription('Like 5s, 1m, or 0').setRequired(true)).toJSON(),
  text: { aliases: ['slow'], args: ['length'] },
  run: async (ctx) => {
    if (!ctx.guild || !ctx.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return ctx.reply('You don\'t have the authority for that, partner.');
    const ch = await ctx.guild.channels.fetch(ctx.channelId).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) return ctx.reply('Only works in a normal text channel.');
    const raw = ctx.str('length') ?? '0';
    const secs = raw.trim() === '0' ? 0 : Math.round((parseLength(raw) ?? Number(raw) * 1000) / 1000);
    if (!Number.isFinite(secs) || secs < 0 || secs > 21_600) return ctx.reply('Between 0 and 6 hours, please.');
    await ch.setRateLimitPerUser(secs);
    return ctx.reply({ content: secs ? `🐢 Slowmode here is now **${human(secs * 1000)}**.` : '🐢 Slowmode off. Talk as fast as you like.', temp: true });
  },
};

const caseIcon: Record<string, string> = { warn: '⚠️', timeout: '🩹', untimeout: '🔊', kick: '👢', ban: '🔨', tempban: '⏳', unban: '🕊️' };
const caseTypes = Object.keys(caseIcon);

function caseCard(c: Case) {
  const fields = [
    { name: '👤 Who', value: `<@${c.user_id}>${c.user_name ? ` · ${c.user_name}` : ''}`, inline: true },
    { name: '🕵️ By', value: `<@${c.mod_id}>`, inline: true },
    { name: '📅 When', value: `<t:${unix(c.at)}:f>`, inline: true },
  ];
  if (c.until) fields.push({ name: c.type === 'tempban' ? '⏳ Ban ends' : '⏳ Until', value: `<t:${unix(c.until)}:R>${c.type === 'tempban' && !c.open ? ' (over)' : ''}`, inline: true });
  fields.push({ name: '📝 Reason', value: c.reason, inline: false });
  return card({ kind: 'caseFile', title: `Case #${c.num} · ${c.type}`, emoji: caseIcon[c.type] ?? '📁', color: RED, gif: 'off', fields });
}

interface CaseFilter { user?: string; mod?: string; type?: string; text?: string }
const PER = 8;

// ids carry the filter so the pages work without remembering anything
export function casePage(store: Store, guildId: string, owner: string, page: number, f: CaseFilter) {
  const { rows, total } = store.findCases(guildId, f, PER, page * PER);
  const pages = Math.max(1, Math.ceil(total / PER));
  const what = [f.user && `about <@${f.user}>`, f.mod && `by <@${f.mod}>`, f.type && `type **${f.type}**`, f.text && `matching "${f.text}"`].filter(Boolean).join(' · ');
  const body = rows.length
    ? rows.map((c) => `${caseIcon[c.type] ?? '📁'} \`#${c.num}\` <t:${unix(c.at)}:d> <@${c.user_id}> by <@${c.mod_id}>\n-# ${c.reason.slice(0, 90)}`).join('\n')
    : 'Nothing on file. Either everyone behaves, or nobody gets caught.';
  const key = [f.user ?? '', f.mod ?? '', f.type ?? '', (f.text ?? '').slice(0, 20).replace(/\|/g, '')].join('|');
  const nav = (p: number, label: string, emoji: string) => new ButtonBuilder().setCustomId(`cs|${owner}|${p}|${key}`.slice(0, 100))
    .setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary).setDisabled(p < 0 || p >= pages);
  const e = card({ kind: 'caseList', title: `Case archive · ${total}`, emoji: '🗄️', gif: 'off', body: `${what ? `${what}\n\n` : ''}${body}` });
  e.setFooter({ text: `Page ${page + 1}/${pages} · /admin view:case opens one` });
  return { embeds: [e], components: pages > 1 ? [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(nav(page - 1, 'Newer', '◀️'), nav(page + 1, 'Older', '▶️'))] : [] };
}

export async function onCaseComponent(store: Store, i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('cs|') || !i.guildId) return false;
  const [, owner, page, user, mod, type, text] = i.customId.split('|');
  if (i.user.id !== owner) {
    await i.reply({ content: 'Open your own with `/admin view:case`.', flags: MessageFlags.Ephemeral });
    return true;
  }
  await i.update(casePage(store, i.guildId, owner, Number(page), { user: user || undefined, mod: mod || undefined, type: type || undefined, text: text || undefined }));
  return true;
}

const cases: Command = {
  name: 'case',
  group: 'staff',
  data: new SlashCommandBuilder().setName('case').setDescription('The moderation archive: look up, search, edit cases')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false)
    .addSubcommand((c) => c.setName('view').setDescription('Open one case')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)))
    .addSubcommand((c) => c.setName('list').setDescription('Search the archive')
      .addUserOption((o) => o.setName('user').setDescription('Cases about them'))
      .addUserOption((o) => o.setName('mod').setDescription('Cases filed by them'))
      .addStringOption((o) => o.setName('type').setDescription('Only one kind').addChoices(...caseTypes.map((t) => ({ name: t, value: t }))))
      .addStringOption((o) => o.setName('search').setDescription('Words in the reason or name').setMaxLength(50)))
    .addSubcommand((c) => c.setName('reason').setDescription('Change a case\'s reason')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(300)))
    .addSubcommand((c) => c.setName('delete').setDescription('Remove a case from the record')
      .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)))
    .toJSON(),
  // tz case 12, tz case @user, tz case list warn, tz case reason 12 new words, tz warnings @user
  text: { aliases: ['cases', 'warnings', 'warns'], sub: true, subArgs: { view: ['number'], list: ['user', 'search'], reason: ['number', 'reason'], delete: ['number'] } },
  run: async (ctx, store) => {
    if (!ctx.guildId || !ctx.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return ctx.reply('You don\'t have the authority for that, partner.');
    let sub = ctx.sub();
    let num = ctx.int('number');
    const f: CaseFilter = {};
    // text shortcuts: a bare number opens it, a bare mention or type searches
    if (ctx.viaText && sub && !['view', 'list', 'reason', 'delete'].includes(sub)) {
      if (/^#?\d+$/.test(sub)) { num = Number(sub.replace('#', '')); sub = 'view'; }
      else if (/^<@!?\d+>$/.test(sub)) { f.user = sub.replace(/\D/g, ''); sub = 'list'; }
      else if (caseTypes.includes(sub)) { f.type = sub; sub = 'list'; }
      else { f.text = sub; sub = 'list'; }
    }
    sub ??= 'list';
    if (sub === 'view') {
      const c = num ? store.getCase(ctx.guildId, num) : null;
      return ctx.reply(c ? { embeds: [caseCard(c)], private: false } : 'No case with that number.');
    }
    if (sub === 'reason') {
      const why = ctx.str('reason');
      if (!num || !why) return ctx.reply('Like this: `tz case reason 12 ...`');
      return ctx.reply(store.editCase(ctx.guildId, num, why) ? `🖋️ Case #${num} amended.` : 'No case with that number.');
    }
    if (sub === 'delete') {
      if (!num) return ctx.reply('Which number?');
      return ctx.reply(store.deleteCase(ctx.guildId, num) ? `🧽 Case #${num} wiped from the record. Kunikida-kun will be furious.` : 'No case with that number.');
    }
    f.user ??= ctx.user('user') ?? undefined;
    f.mod = ctx.viaText ? undefined : ctx.user('mod') ?? undefined;
    f.type ??= ctx.viaText ? undefined : ctx.str('type') ?? undefined;
    const search = ctx.str('search');
    if (search) {
      if (ctx.viaText && caseTypes.includes(search.toLowerCase())) f.type = search.toLowerCase();
      else f.text = search;
    }
    return ctx.reply({ ...casePage(store, ctx.guildId, ctx.userId, 0, f), private: false });
  },
};

// lifts temp bans when their time is up, checked every minute so a restart doesn't lose any
export function startModTimers(client: Client, store: Store) {
  const tick = async () => {
    for (const c of store.dueCases(Date.now())) {
      store.closeCases(c.guild_id, c.user_id, 'tempban');
      const guild = await client.guilds.fetch(c.guild_id).catch(() => null);
      if (!guild) continue;
      const ok = await guild.members.unban(c.user_id, `temp ban from case #${c.num} ended`).then(() => true).catch(() => false);
      if (!ok) continue;
      const num = store.addCase({ guild_id: c.guild_id, type: 'unban', user_id: c.user_id, user_name: c.user_name, mod_id: client.user!.id, reason: `temp ban from case #${c.num} ended` });
      await log(client, store, c.guild_id, actionCard('unban', `Case #${num} · Holiday over`, '🕊️', `${c.user_name ?? ''} (\`${c.user_id}\`)`, client.user!.id, `temp ban from case #${c.num} ended`));
    }
  };
  setInterval(() => void tick(), 60_000);
  void tick();
}

export const moderation: Module = {
  name: 'moderation',
  label: 'Moderation',
  about: 'Warn, timeout, kick, bans (temporary too), purge, lock, slowmode and voice moderation, every action filed as a numbered case. Logs and automod are in /setup',
  commands: [warn, cases, timeout, untimeout, kick, ban, unban, purge, lock, slowmode],
};
