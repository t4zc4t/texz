import {
  ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder, type Client, type GuildMember, type PermissionResolvable,
} from 'discord.js';
import type { Store } from '../db.js';
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
export async function log(client: Client, store: Store, guildId: string, e: EmbedBuilder) {
  const id = store.guild(guildId).mod.logChannel;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  // the log keeps it plain, no gif filling the channel
  const plain = new EmbedBuilder(e.toJSON()).setImage(null);
  if (ch?.isSendable()) await ch.send({ embeds: [plain], allowedMentions: { parse: [] } }).catch(() => {});
}

// the person running the command needs the permission, and both they and Texz must sit above the target
async function target(ctx: Ctx, perm: PermissionResolvable, need = true): Promise<{ me: GuildMember; them: GuildMember | null } | string> {
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
  if (them.roles.highest.position >= me.roles.highest.position) return 'Their role sits above mine. Move my role higher and I\'ll handle it.';
  return { me, them };
}

function actionCard(kind: Kind, title: string, emoji: string, who: string, by: string, reason: string, extra: { name: string; value: string; inline?: boolean }[] = []) {
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

async function tellThem(them: GuildMember, text: string) {
  await them.send(text).catch(() => {});
}

type Builder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
const user = (o: Builder) => o.addUserOption((x) => x.setName('user').setDescription('Who').setRequired(true));
const reason = (o: Builder) => o.addStringOption((x) => x.setName('reason').setDescription('Why').setMaxLength(300));

const warn: Command = {
  name: 'warn',
  data: reason(user(new SlashCommandBuilder().setName('warn').setDescription('Warn someone, it goes in their file')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false))).toJSON(),
  text: { args: ['user', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.ModerateMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const why = ctx.str('reason') ?? say('noReason');
    const id = store.warn(ctx.guildId!, t.them!.id, ctx.userId, why);
    const count = store.warnings(ctx.guildId!, t.them!.id).length;
    await tellThem(t.them!, `⚠️ You were warned in **${ctx.guild!.name}**: ${why}`);
    const e = actionCard('warn', 'Warning filed', '⚠️', `<@${t.them!.id}>`, ctx.userId, why, [{ name: '📒 Warnings', value: `#${id} · ${count} total`, inline: true }]);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const warnings: Command = {
  name: 'warnings',
  data: new SlashCommandBuilder().setName('warnings').setDescription('Someone\'s warnings, or remove one')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false)
    .addUserOption((x) => x.setName('user').setDescription('Who').setRequired(true))
    .addIntegerOption((x) => x.setName('remove').setDescription('Warning number to remove')).toJSON(),
  text: { aliases: ['warns'], args: ['user', 'remove'] },
  run: async (ctx, store) => {
    if (!ctx.guildId || !ctx.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return ctx.reply('You don\'t have the authority for that, partner.');
    const id = ctx.user('user');
    if (!id) return ctx.reply('Whose file? Mention someone.');
    const rm = ctx.int('remove');
    if (rm) return ctx.reply(store.unwarn(ctx.guildId, rm) ? `🧽 Warning #${rm} wiped from the record.` : 'No warning with that number.');
    const list = store.warnings(ctx.guildId, id);
    return ctx.reply(card({
      kind: 'warn', title: `Record · ${list.length} warning${list.length === 1 ? '' : 's'}`, emoji: '📒', gif: 'off',
      body: list.length ? list.slice(0, 15).map((w) => `\`#${w.id}\` <t:${unix(w.at)}:d> by <@${w.mod_id}> · ${w.reason}`).join('\n') : `<@${id}> has a spotless record. Suspiciously spotless.`,
    }));
  },
};

const timeout: Command = {
  name: 'timeout',
  data: reason(user(new SlashCommandBuilder().setName('timeout').setDescription('No Longer Human: mute someone for a while')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false))
    .addStringOption((x) => x.setName('length').setDescription('Like 10m, 2h, 1d (max 28d)').setRequired(true))).toJSON(),
  text: { aliases: ['mute', 'nullify', 'to'], args: ['user', 'length', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.ModerateMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const ms = parseLength(ctx.str('length'));
    if (!ms || ms > 28 * 86_400_000) return ctx.reply('Give me a length like `10m`, `2h` or `1d`, up to 28 days.');
    const why = ctx.str('reason') ?? say('noReason');
    await t.them!.timeout(ms, why);
    await tellThem(t.them!, `🔇 You were timed out in **${ctx.guild!.name}** for ${human(ms)}: ${why}`);
    const e = actionCard('timeout', 'No Longer Human', '🩹', `<@${t.them!.id}>`, ctx.userId, why, [{ name: '⏳ Until', value: `<t:${unix(Date.now() + ms)}:R>`, inline: true }]);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const untimeout: Command = {
  name: 'untimeout',
  data: user(new SlashCommandBuilder().setName('untimeout').setDescription('Give someone their voice back')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).setDMPermission(false)).toJSON(),
  text: { aliases: ['unmute'], args: ['user'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.ModerateMembers);
    if (typeof t === 'string') return ctx.reply(t);
    await t.them!.timeout(null);
    const e = actionCard('unban', 'Voice restored', '🔊', `<@${t.them!.id}>`, ctx.userId, 'timeout lifted');
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const kick: Command = {
  name: 'kick',
  data: reason(user(new SlashCommandBuilder().setName('kick').setDescription('Show someone the door')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers).setDMPermission(false))).toJSON(),
  text: { args: ['user', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.KickMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const why = ctx.str('reason') ?? say('noReason');
    await tellThem(t.them!, `👢 You were kicked from **${ctx.guild!.name}**: ${why}`);
    await t.them!.kick(why);
    const e = actionCard('kick', 'Shown the door', '👢', `${t.them!.user.username} (\`${t.them!.id}\`)`, ctx.userId, why);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const ban: Command = {
  name: 'ban',
  data: reason(user(new SlashCommandBuilder().setName('ban').setDescription('Banish someone for good')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).setDMPermission(false)))
    .addIntegerOption((x) => x.setName('clear').setDescription('Delete their messages from the last N days').setMinValue(0).setMaxValue(7)).toJSON(),
  text: { args: ['user', 'reason'] },
  run: async (ctx, store) => {
    const t = await target(ctx, PermissionFlagsBits.BanMembers);
    if (typeof t === 'string') return ctx.reply(t);
    const why = ctx.str('reason') ?? say('noReason');
    await tellThem(t.them!, `🔨 You were banned from **${ctx.guild!.name}**: ${why}`);
    await t.them!.ban({ reason: why, deleteMessageSeconds: (ctx.int('clear') ?? 0) * 86_400 });
    const e = actionCard('ban', 'Banished', '🔨', `${t.them!.user.username} (\`${t.them!.id}\`)`, ctx.userId, why);
    await log(ctx.guild!.client, store, ctx.guildId!, e);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const unban: Command = {
  name: 'unban',
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
    const e = actionCard('unban', 'Pardoned', '🕊️', `\`${id}\``, ctx.userId, 'unbanned');
    await log(ctx.guild.client, store, ctx.guild.id, e);
    return ctx.reply({ embeds: [e], private: false });
  },
};

const purge: Command = {
  name: 'purge',
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
    const r = await ctx.reply({ embeds: [card({ kind: 'purge', title: `${count} message${count === 1 ? '' : 's'} gone`, emoji: '🧹', gif: 'off' })], private: false });
    // the confirmation tidies itself away too
    if (ctx.viaText && r && 'delete' in (r as object)) setTimeout(() => void (r as { delete: () => Promise<unknown> }).delete().catch(() => {}), 5000);
    return r;
  },
};

const lock: Command = {
  name: 'lock',
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
    return ctx.reply({ embeds: [e], private: false });
  },
};

const slowmode: Command = {
  name: 'slowmode',
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
    return ctx.reply({ embeds: [card({ kind: 'slowmode', title: secs ? `Slowmode · ${human(secs * 1000)}` : 'Slowmode off', emoji: '🐢', gif: 'off' })], private: false });
  },
};

export const moderation: Module = {
  name: 'moderation',
  label: 'Moderation',
  about: 'Warn, timeout, kick, ban, purge, lock and slowmode. Logs and automod are in /setup',
  commands: [warn, warnings, timeout, untimeout, kick, ban, unban, purge, lock, slowmode],
};
