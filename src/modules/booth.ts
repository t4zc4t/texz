import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type Client, type GuildMember, type VoiceChannel, type VoiceState } from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { report } from '../ops.js';

// join "Open a private booth" and Texz builds you a voice room of your own, yours to run, gone when you leave

export const HUB = '➕ Open a private booth';
const owner = (store: Store, ch: string) => store.getKv(`booth:${ch}`);

async function open(store: Store, m: GuildMember, hub: VoiceChannel) {
  const g = m.guild;
  const memberRole = store.getKv(`verifyrole:${g.id}`);
  const who = memberRole && g.roles.cache.has(memberRole) ? memberRole : g.roles.everyone.id;
  const room = await g.channels.create({
    name: `🎙️ ${m.displayName}'s booth`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: hub.parentId ?? undefined,
    reason: `private booth for ${m.user.username}`,
    permissionOverwrites: [
      // everyone sees it, nobody walks in uninvited
      { id: g.roles.everyone.id, deny: [PermissionFlagsBits.Connect, ...(who !== g.roles.everyone.id ? [PermissionFlagsBits.ViewChannel] : [])] },
      ...(who !== g.roles.everyone.id ? [{ id: who, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] }] : []),
      // the owner runs it: rename, limit, invite, move, mute, and set its permissions
      { id: m.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.PrioritySpeaker, PermissionFlagsBits.UseSoundboard] },
      { id: g.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
    ],
  }).catch((e) => { report('booth', e); return null; });
  if (!room) return;
  store.setKv(`booth:${room.id}`, m.id);
  await m.voice.setChannel(room, 'into their booth').catch(() => {});
  await room.send(`🎙️ <@${m.id}>, this booth is yours. Nobody gets in unless you let them.\n\`tz booth invite @someone\` lets a friend or a music bot in · \`tz booth kick @someone\` · \`tz booth open\` or \`lock\` · \`tz booth name Late night\` · \`tz booth limit 4\`\n-# It closes the moment you leave.`).catch(() => {});
}

async function close(store: Store, ch: VoiceChannel) {
  store.setKv(`booth:${ch.id}`, null);
  await ch.delete('the owner left their booth').catch(() => {});
}

export function watchBooths(client: Client, store: Store) {
  client.on('voiceStateUpdate', (before: VoiceState, after: VoiceState) => {
    void (async () => {
      const m = after.member ?? before.member;
      if (!m || m.user.bot) return;
      const hubId = store.getKv(`boothhub:${m.guild.id}`);
      // walked into the hub
      if (after.channelId && after.channelId === hubId && store.rules(m.guild.id, 'utility').enabled) {
        const hub = after.channel as VoiceChannel;
        await open(store, m, hub);
      }
      // left a booth: the owner leaving closes it, anyone leaving an empty one closes it too
      if (before.channelId && before.channelId !== after.channelId && owner(store, before.channelId)) {
        const ch = before.channel as VoiceChannel | null;
        if (ch && (owner(store, ch.id) === m.id || ch.members.size === 0)) await close(store, ch);
      }
    })().catch((e) => report('booth voice', e));
  });
}

// booths left over from a restart, empty ones go
export function cleanBooths(client: Client, store: Store) {
  for (const { key } of store.kvByPrefix('booth:')) {
    const id = key.slice(6);
    const ch = client.channels.cache.get(id) as VoiceChannel | undefined;
    if (!ch) store.setKv(key, null);
    else if (ch.members.size === 0) void close(store, ch);
  }
}

// the owner's controls, typed from anywhere while they sit in their booth
export const booth: Command = {
  name: 'booth',
  data: new SlashCommandBuilder().setName('booth').setDescription('Run your private voice booth: invite, kick, lock, rename, limit')
    .addStringOption((o) => o.setName('do').setDescription('What to do').setRequired(true).addChoices(
      { name: 'invite someone', value: 'invite' }, { name: 'kick someone', value: 'kick' }, { name: 'open to everyone', value: 'open' },
      { name: 'lock it again', value: 'lock' }, { name: 'rename', value: 'name' }, { name: 'user limit', value: 'limit' }))
    .addUserOption((o) => o.setName('user').setDescription('Who, for invite and kick'))
    .addStringOption((o) => o.setName('value').setDescription('The new name, or the limit').setMaxLength(90)).toJSON(),
  text: { aliases: ['vc', 'room'], args: ['do', 'user', 'value'] },
  hint: '`{p} booth invite @someone` · `/misc view:booth`\n-# join ➕ Open a private booth to get one · also kick @someone, open, lock, name Late night, limit 4',
  run: async (ctx, store) => {
    const m = ctx.member;
    const ch = m?.voice.channel as VoiceChannel | null | undefined;
    if (!m || !ch || owner(store, ch.id) !== m.id) return ctx.reply({ content: `You need to be sitting in your own booth. Join **${HUB}** to get one.`, temp: true });
    const what = (ctx.str('do') ?? '').toLowerCase();
    let value = ctx.str('value');
    let target = ctx.user('user');
    // typed "tz booth name Late night" puts the words where the user would go
    if (ctx.viaText && !target && ctx.str('user')) value = [ctx.str('user'), value].filter(Boolean).join(' ');
    if (what === 'name' && !value) value = ctx.str('user');
    const memberRole = store.getKv(`verifyrole:${ch.guild.id}`) ?? ch.guild.roles.everyone.id;
    if (what === 'invite' && target) { await ch.permissionOverwrites.edit(target, { ViewChannel: true, Connect: true, Speak: true }); return ctx.reply({ content: `🎟️ <@${target}> can walk in now.`, ping: [target] }); }
    if (what === 'kick' && target) {
      target = target === m.id ? null : target;
      if (!target) return ctx.reply({ content: 'You can\'t kick yourself out of your own booth. Just leave and it closes.', temp: true });
      await ch.permissionOverwrites.edit(target, { Connect: false });
      await ch.members.get(target)?.voice.disconnect('kicked from a booth').catch(() => {});
      return ctx.reply({ content: `🚪 <@${target}> is out and can't come back unless invited.`, temp: true });
    }
    if (what === 'open') { await ch.permissionOverwrites.edit(memberRole, { Connect: true }); return ctx.reply({ content: '🔓 Anyone can join now.', temp: true }); }
    if (what === 'lock') { await ch.permissionOverwrites.edit(memberRole, { Connect: false }); return ctx.reply({ content: '🔒 Locked, invites only.', temp: true }); }
    if (what === 'name' && value) { await ch.setName(`🎙️ ${value}`.slice(0, 100)); return ctx.reply({ content: '✏️ Renamed.', temp: true }); }
    if (what === 'limit') {
      const n = Number.parseInt(value ?? '', 10);
      if (!(n >= 0 && n <= 99)) return ctx.reply({ content: 'A number from 0 to 99, 0 means no limit.', temp: true });
      await ch.setUserLimit(n);
      return ctx.reply({ content: n ? `👥 Up to ${n} people.` : '👥 No limit.', temp: true });
    }
    return ctx.reply({ content: 'Like this: `tz booth invite @someone`, `tz booth kick @someone`, `tz booth open`, `tz booth lock`, `tz booth name Late night`, `tz booth limit 4`.', temp: true });
  },
};
