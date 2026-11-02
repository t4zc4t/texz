import { Events, PermissionFlagsBits, type Client, type Message } from 'discord.js';
import type { Store } from './db.js';
import { log } from './modules/moderation.js';
import { giveXp } from './modules/levels.js';
import { onJoin, onLeave } from './modules/welcome.js';
import { RED, card } from './theme.js';

const unix = (ms: number) => Math.floor(ms / 1000);
const recent = new Map<string, number[]>();

// light automod, each rule is off until an admin turns it on with /modsetup
async function automod(store: Store, m: Message) {
  if (!m.guild || !m.member || m.author.bot) return;
  if (!store.rules(m.guild.id, 'moderation').enabled) return;
  const rules = store.guild(m.guild.id).mod;
  if (!rules.invites && !rules.spam && !rules.mentions) return;
  if (m.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  let why: string | null = null;
  if (rules.invites && /(discord\.gg|discord(app)?\.com\/invite)\/\w+/i.test(m.content)) why = 'invite link';
  if (!why && rules.mentions && m.mentions.users.size >= 6) why = 'mass mention';
  if (!why && rules.spam) {
    const key = `${m.guild.id}:${m.author.id}`;
    const times = (recent.get(key) ?? []).filter((t) => Date.now() - t < 5000);
    times.push(Date.now());
    recent.set(key, times);
    if (times.length >= 6) {
      why = 'spam';
      recent.delete(key);
      await m.member.timeout(5 * 60_000, 'automod: spam').catch(() => {});
    }
  }
  if (!why) return;
  await m.delete().catch(() => {});
  const ch = m.channel;
  const note = ch.isSendable()
    ? await ch.send({ content: `<@${m.author.id}>`, embeds: [card({ kind: 'automod', title: `Removed · ${why}`, emoji: '🧹', gif: 'off', color: RED })], allowedMentions: { users: [m.author.id] } }).catch(() => null)
    : null;
  if (note) setTimeout(() => void note.delete().catch(() => {}), 8000);
  await log(m.client, store, m.guild.id, card({
    kind: 'automod', title: `Automod · ${why}`, emoji: '🧹', color: RED, gif: 'off',
    fields: [{ name: '👤 Who', value: `<@${m.author.id}>`, inline: true }, { name: '📍 Where', value: `<#${m.channelId}>`, inline: true }, { name: '💬 Message', value: m.content.slice(0, 1000) || '*empty*', inline: false }],
  }));
}

const logOn = (store: Store, guildId: string | null) => !!guildId && store.rules(guildId, 'moderation').enabled && !!store.guild(guildId).mod.logChannel;

export function wireEvents(client: Client, store: Store) {
  client.on(Events.MessageCreate, (m) => {
    void automod(store, m).catch((e) => console.error('automod', e));
    void giveXp(store, m).catch((e) => console.error('xp', e));
  });

  client.on(Events.GuildMemberAdd, (m) => {
    if (store.rules(m.guild.id, 'welcome').enabled) void onJoin(store, m).catch((e) => console.error('welcome', e));
    if (logOn(store, m.guild.id)) {
      void log(client, store, m.guild.id, card({
        kind: 'logs', title: 'Member joined', emoji: '📥', gif: 'off',
        fields: [{ name: '👤 Who', value: `<@${m.id}> · ${m.user.username}`, inline: true }, { name: '🎂 Account', value: `<t:${unix(m.user.createdTimestamp)}:R>`, inline: true }],
      }));
    }
  });

  client.on(Events.GuildMemberRemove, (m) => {
    if (store.rules(m.guild.id, 'welcome').enabled) void onLeave(store, m).catch((e) => console.error('goodbye', e));
    if (logOn(store, m.guild.id)) {
      void log(client, store, m.guild.id, card({ kind: 'logs', title: 'Member left', emoji: '📤', gif: 'off', fields: [{ name: '👤 Who', value: `<@${m.id}> · ${m.user?.username ?? '?'}`, inline: true }] }));
    }
  });

  client.on(Events.MessageDelete, (m) => {
    if (!logOn(store, m.guildId) || m.author?.bot || !m.content) return;
    void log(client, store, m.guildId!, card({
      kind: 'logs', title: 'Message deleted', emoji: '🗑️', gif: 'off',
      fields: [{ name: '👤 Author', value: `<@${m.author?.id}>`, inline: true }, { name: '📍 Where', value: `<#${m.channelId}>`, inline: true }, { name: '💬 It said', value: m.content.slice(0, 1000), inline: false }],
    }));
  });

  client.on(Events.MessageUpdate, (old, m) => {
    if (!logOn(store, m.guildId) || m.author?.bot || !old.content || old.content === m.content) return;
    void log(client, store, m.guildId!, card({
      kind: 'logs', title: 'Message edited', emoji: '✏️', gif: 'off',
      fields: [
        { name: '👤 Author', value: `<@${m.author?.id}>`, inline: true }, { name: '📍 Where', value: `[jump](${m.url})`, inline: true },
        { name: '⬅️ Before', value: old.content.slice(0, 1000), inline: false }, { name: '➡️ After', value: (m.content ?? '').slice(0, 1000) || '*empty*', inline: false },
      ],
    }));
  });

  client.on(Events.GuildBanAdd, (b) => {
    if (logOn(store, b.guild.id)) void log(client, store, b.guild.id, card({ kind: 'ban', title: 'Banned', emoji: '🔨', gif: 'off', color: RED, fields: [{ name: '👤 Who', value: `${b.user.username} (\`${b.user.id}\`)`, inline: true }] }));
  });
  client.on(Events.GuildBanRemove, (b) => {
    if (logOn(store, b.guild.id)) void log(client, store, b.guild.id, card({ kind: 'unban', title: 'Unbanned', emoji: '🕊️', gif: 'off', fields: [{ name: '👤 Who', value: `${b.user.username} (\`${b.user.id}\`)`, inline: true }] }));
  });
}
