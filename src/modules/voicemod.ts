import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type Client, type GuildMember, type VoiceBasedChannel, type VoiceState } from 'discord.js';
import type { Store } from '../db.js';
import type { Ctx } from '../core/ctx.js';
import type { Command } from '../core/module.js';
import { report } from '../ops.js';
import { say } from '../theme.js';
import { actionCard, brief, human, log, parseLength, target, tellThem } from './moderation.js';

// voice rooms get the same treatment as chat: mute, deafen, disconnect, move, ban from voice, lock a room.
// every action is a numbered case, same as warns and timeouts

const unix = (ms: number) => Math.floor(ms / 1000);
const banKey = (g: string, u: string) => `vcban:${g}:${u}`;

// the voice room a channel option points at, or the one the moderator is sitting in
async function roomOf(ctx: Ctx, name: string): Promise<VoiceBasedChannel | null> {
  const id = ctx.channel(name);
  const ch = id ? await ctx.guild?.channels.fetch(id).catch(() => null) : null;
  if (ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) return ch as VoiceBasedChannel;
  return id ? null : ctx.member?.voice.channel ?? null;
}

async function file(ctx: Ctx, store: Store, them: GuildMember, type: string, title: string, emoji: string, why: string, extra: { name: string; value: string; inline?: boolean }[] = []) {
  const num = store.addCase({ guild_id: ctx.guildId!, type, user_id: them.id, user_name: them.user.username, mod_id: ctx.userId, reason: why });
  const e = actionCard('timeout', `Case #${num} · ${title}`, emoji, `<@${them.id}>`, ctx.userId, why, extra);
  await log(ctx.guild!.client, store, ctx.guildId!, e);
  return ctx.reply(brief(e));
}

const MUTE = PermissionFlagsBits.MuteMembers;
const DEAF = PermissionFlagsBits.DeafenMembers;
const MOVE = PermissionFlagsBits.MoveMembers;
const CHANNELS = PermissionFlagsBits.ManageChannels;

export const vc: Command = {
  name: 'vc',
  data: new SlashCommandBuilder().setName('vc').setDescription('Voice moderation: mute, deafen, disconnect, move, ban from voice, lock a room')
    .setDefaultMemberPermissions(MOVE).setDMPermission(false)
    .addSubcommand((s) => s.setName('mute').setDescription('Server mute someone in voice').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why')))
    .addSubcommand((s) => s.setName('unmute').setDescription('Lift a voice mute').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('deafen').setDescription('Server deafen someone').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why')))
    .addSubcommand((s) => s.setName('undeafen').setDescription('Lift a deafen').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('kick').setDescription('Disconnect someone from voice').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why')))
    .addSubcommand((s) => s.setName('move').setDescription('Move someone to another voice room').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('Where to').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true)))
    .addSubcommand((s) => s.setName('moveall').setDescription('Move everyone from one room to another').addChannelOption((o) => o.setName('channel').setDescription('Where to').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true)).addChannelOption((o) => o.setName('from').setDescription('From where, leave empty for the room you\'re in').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .addSubcommand((s) => s.setName('ban').setDescription('Keep someone out of every voice room').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)).addStringOption((o) => o.setName('length').setDescription('Like 1h or 3d, empty for until lifted')).addStringOption((o) => o.setName('reason').setDescription('Why')))
    .addSubcommand((s) => s.setName('unban').setDescription('Let someone back into voice').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand((s) => s.setName('lock').setDescription('Nobody new can join a voice room').addChannelOption((o) => o.setName('channel').setDescription('Which, leave empty for the room you\'re in').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .addSubcommand((s) => s.setName('unlock').setDescription('Open a locked voice room again').addChannelOption((o) => o.setName('channel').setDescription('Which, leave empty for the room you\'re in').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
    .toJSON(),
  text: {
    aliases: ['voice', 'vmod'],
    sub: true,
    subArgs: { mute: ['user', 'reason'], unmute: ['user'], deafen: ['user', 'reason'], deaf: ['user', 'reason'], undeafen: ['user'], undeaf: ['user'], kick: ['user', 'reason'], dc: ['user', 'reason'], move: ['user', 'channel'], moveall: ['channel', 'from'], ban: ['user', 'length', 'reason'], unban: ['user'], lock: ['channel'], unlock: ['channel'] },
  },
  example: 'mute @someone shouting',
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('That only works inside a server.');
    const sub = ({ deaf: 'deafen', undeaf: 'undeafen', dc: 'kick', disconnect: 'kick' } as Record<string, string>)[ctx.sub() ?? ''] ?? ctx.sub();
    const why = ctx.str('reason') ?? say('noReason');

    if (sub === 'mute' || sub === 'unmute' || sub === 'deafen' || sub === 'undeafen') {
      const deafen = sub.includes('deaf');
      const on = !sub.startsWith('un');
      const t = await target(ctx, deafen ? DEAF : MUTE);
      if (typeof t === 'string') return ctx.reply(t);
      const them = t.them!;
      // a server mute only sticks while they're connected, so out of voice it waits for them
      if (!them.voice.channelId) return ctx.reply(`${them.displayName} isn't in a voice room right now. Try once they join, or use \`tz vc ban\` to keep them out.`);
      const ok = await (deafen ? them.voice.setDeaf(on, why) : them.voice.setMute(on, why)).then(() => true).catch(() => false);
      if (!ok) return ctx.reply('Discord refused that one. Check I can mute and deafen in that room.');
      if (on) await tellThem(them, `${deafen ? '🔇 You were server deafened' : '🎙️ You were server muted'} in **${ctx.guild.name}**: ${why}`);
      return file(ctx, store, them, `vc${sub}`, ({ mute: 'Voice muted', unmute: 'Voice unmuted', deafen: 'Deafened', undeafen: 'Undeafened' } as Record<string, string>)[sub], on ? '🔇' : '🔊', on ? why : 'lifted', [{ name: '📍 Room', value: `<#${them.voice.channelId}>`, inline: true }]);
    }

    if (sub === 'kick') {
      const t = await target(ctx, MOVE);
      if (typeof t === 'string') return ctx.reply(t);
      const them = t.them!;
      const was = them.voice.channelId;
      if (!was) return ctx.reply(`${them.displayName} isn't in voice.`);
      await them.voice.disconnect(why).catch(() => {});
      return file(ctx, store, them, 'vckick', 'Pulled from voice', '📵', why, [{ name: '📍 Room', value: `<#${was}>`, inline: true }]);
    }

    if (sub === 'move') {
      const t = await target(ctx, MOVE);
      if (typeof t === 'string') return ctx.reply(t);
      const them = t.them!;
      const to = await roomOf(ctx, 'channel');
      if (!them.voice.channelId) return ctx.reply(`${them.displayName} isn't in voice.`);
      if (!to || !ctx.channel('channel')) return ctx.reply('Move them where? Like `tz vc move @someone #Lupin Lounge`.');
      const ok = await them.voice.setChannel(to, `moved by ${ctx.displayName}`).then(() => true).catch(() => false);
      return ctx.reply(ok ? { content: `➡️ Moved <@${them.id}> to <#${to.id}>.`, temp: false } : 'I couldn\'t move them there, check I can connect to that room.');
    }

    if (sub === 'moveall') {
      if (!ctx.member?.permissions.has(MOVE)) return ctx.reply('You need the Move Members permission for that.');
      const to = await roomOf(ctx, 'channel');
      const from = await roomOf(ctx, 'from');
      if (!to || !ctx.channel('channel')) return ctx.reply('Move everyone where? Like `tz vc moveall #Watch Party`, from the room you\'re in.');
      if (!from || from.id === to.id) return ctx.reply('Join the room you want to empty first, or name it: `tz vc moveall #to #from`.');
      let n = 0;
      for (const m of from.members.values()) if (await m.voice.setChannel(to, `moved by ${ctx.displayName}`).then(() => true).catch(() => false)) n++;
      return ctx.reply({ content: `➡️ Moved ${n} from <#${from.id}> to <#${to.id}>.`, temp: false });
    }

    if (sub === 'ban') {
      const t = await target(ctx, MOVE);
      if (typeof t === 'string') return ctx.reply(t);
      const them = t.them!;
      // the length is optional, so "tz vc ban @x being loud" reads it all as the reason
      const rawLen = ctx.str('length');
      const ms = parseLength(rawLen);
      const reason = ms ? why : [rawLen, ctx.str('reason')].filter(Boolean).join(' ') || say('noReason');
      const until = ms ? Date.now() + ms : 0;
      store.setKv(banKey(ctx.guildId!, them.id), String(until));
      if (them.voice.channelId) await them.voice.disconnect('banned from voice').catch(() => {});
      await tellThem(them, `🚫 You can't join voice in **${ctx.guild.name}** ${ms ? `for ${human(ms)}` : 'until staff lift it'}: ${reason}`);
      return file(ctx, store, them, 'vcban', 'Banned from voice', '🚫', reason, [{ name: '⏳ Until', value: ms ? `<t:${unix(until)}:R>` : 'lifted by staff', inline: true }]);
    }

    if (sub === 'unban') {
      const t = await target(ctx, MOVE);
      if (typeof t === 'string') return ctx.reply(t);
      if (store.getKv(banKey(ctx.guildId!, t.them!.id)) === null) return ctx.reply(`${t.them!.displayName} isn't banned from voice.`);
      store.setKv(banKey(ctx.guildId!, t.them!.id), null);
      return file(ctx, store, t.them!, 'vcunban', 'Back in voice', '🔊', 'voice ban lifted');
    }

    if (sub === 'lock' || sub === 'unlock') {
      if (!ctx.member?.permissions.has(CHANNELS)) return ctx.reply('You need the Manage Channels permission for that.');
      const room = await roomOf(ctx, 'channel');
      if (!room) return ctx.reply('Which room? Join it, or name it like `tz vc lock #Lupin Lounge`.');
      const lock = sub === 'lock';
      const member = store.getKv(`verifyrole:${ctx.guildId}`);
      // whoever's already inside stays, nobody new gets in, staff still can
      const ids = [ctx.guild.roles.everyone.id, ...(member && ctx.guild.roles.cache.has(member) ? [member] : [])];
      for (const id of ids) await room.permissionOverwrites.edit(id, { Connect: lock ? false : null }, { reason: `${sub}ed by ${ctx.displayName}` }).catch(() => {});
      return ctx.reply({ content: lock ? `🔒 <#${room.id}> is locked. Whoever's inside stays, nobody new gets in. \`tz vc unlock\` opens it.` : `🔓 <#${room.id}> is open again.`, temp: false });
    }

    return ctx.reply('Like this: `tz vc mute @someone`, `tz vc deafen @someone`, `tz vc kick @someone`, `tz vc move @someone #room`, `tz vc moveall #room`, `tz vc ban @someone 1h`, `tz vc lock`. Each has an un- version.');
  },
};

// voice bans are kept here: someone banned is pulled out the moment they join, and an expired one is cleared
export function watchVoiceBans(client: Client, store: Store) {
  client.on('voiceStateUpdate', (before: VoiceState, after: VoiceState) => {
    if (!after.channelId || before.channelId === after.channelId || !after.member || after.member.user.bot) return;
    const key = banKey(after.guild.id, after.member.id);
    const raw = store.getKv(key);
    if (raw === null) return;
    const until = Number(raw);
    if (until && until < Date.now()) { store.setKv(key, null); return; }
    void after.disconnect('banned from voice').catch((e) => report('voice ban', e));
  });
}
