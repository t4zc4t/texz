import { report } from './ops.js';
import { AttachmentBuilder, MessageType, Events, PermissionFlagsBits, type Client, type EmbedBuilder, type Message } from 'discord.js';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Store } from './db.js';
import { log } from './modules/moderation.js';
import { giveXp } from './modules/levels.js';
import { chatPay } from './modules/economy.js';
import { onBoost, onJoin, onLeave } from './modules/welcome.js';
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

const logOn = (store: Store, guildId: string | null) => !!guildId && store.rules(guildId, 'moderation').enabled && !!(store.guild(guildId).mod.logChannel ?? store.getKv(`serverlog:${guildId}`));

export function wireEvents(client: Client, store: Store) {
  client.on(Events.MessageCreate, (m) => {
    // Discord's own "just boosted" message, for when the member wasn't cached
    if ([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3].includes(m.type) && m.member && store.rules(m.member.guild.id, 'welcome').enabled) void onBoost(store, m.member).catch((e) => report('boost', e));
    void automod(store, m).catch((e) => report('automod', e));
    void giveXp(store, m).catch((e) => report('xp', e));
    chatPay(store, m);
  });

  client.on(Events.GuildMemberAdd, (m) => {
    if (store.rules(m.guild.id, 'welcome').enabled) void onJoin(store, m).catch((e) => report('welcome', e));
    if (logOn(store, m.guild.id)) {
      void log(client, store, m.guild.id, card({
        kind: 'logs', title: 'Member joined', emoji: '📥', gif: 'off',
        fields: [{ name: '👤 Who', value: `<@${m.id}> · ${m.user.username}`, inline: true }, { name: '🎂 Account', value: `<t:${unix(m.user.createdTimestamp)}:R>`, inline: true }],
      }), 'server');
    }
  });

  // a member who wasn't boosting and now is
  client.on(Events.GuildMemberUpdate, (old, m) => {
    if (!old.partial && !old.premiumSince && m.premiumSince && store.rules(m.guild.id, 'welcome').enabled) void onBoost(store, m).catch((e) => report('boost', e));
  });

  client.on(Events.GuildMemberRemove, (m) => {
    if (store.rules(m.guild.id, 'welcome').enabled) void onLeave(store, m).catch((e) => report('goodbye', e));
    if (logOn(store, m.guild.id)) {
      void log(client, store, m.guild.id, card({ kind: 'logs', title: 'Member left', emoji: '📤', gif: 'off', fields: [{ name: '👤 Who', value: `<@${m.id}> · ${m.user?.username ?? '?'}`, inline: true }] }), 'server');
    }
  });

  // who came, went and hopped between voice rooms, for the surveillance room
  client.on(Events.VoiceStateUpdate, (before, after) => {
    const m = after.member ?? before.member;
    if (!m || m.user.bot || before.channelId === after.channelId || !logOn(store, m.guild.id)) return;
    const [title, emoji, where] = !before.channelId ? ['Joined voice', '🎙️', `<#${after.channelId}>`]
      : !after.channelId ? ['Left voice', '📴', `<#${before.channelId}>`]
      : ['Switched voice', '🔀', `<#${before.channelId}> → <#${after.channelId}>`];
    void log(client, store, m.guild.id, card({ kind: 'logs', title, emoji, gif: 'off', fields: [{ name: '👤 Who', value: `<@${m.id}> · ${m.user.username}`, inline: true }, { name: '📍 Room', value: where, inline: true }] }), 'server');
  });

  // messages are kept for three days on disk, pictures and files too, so a restart or a deleted upload still gets logged
  client.on(Events.MessageCreate, (m) => {
    if (!m.guildId || m.author.bot || (!m.content && !m.attachments.size) || !logOn(store, m.guildId)) return;
    store.keepMessage(m.id, m.guildId, m.channelId, m.author.id, m.content ?? '');
    if (m.attachments.size) void keepFiles(m.id, [...m.attachments.values()]).then((files) => { if (files.length) store.keepMessage(m.id, m.guildId!, m.channelId, m.author.id, m.content ?? '', files); });
  });
  setInterval(() => { store.dropOldMessages(3); dropOldFiles(3); }, 3_600_000).unref();

  const filesOf = (kept: { files: { name: string; path: string }[] } | undefined) => (kept?.files ?? []).filter((f) => existsSync(f.path)).map((f) => new AttachmentBuilder(f.path, { name: f.name }));

  client.on(Events.MessageDelete, (m) => {
    const kept = store.recallMessage(m.id);
    store.forgetMessage(m.id);
    const guildId = m.guildId ?? kept?.guild_id ?? null;
    const content = m.content || kept?.content || '';
    const author = m.author?.id ?? kept?.author_id;
    const files = filesOf(kept);
    if (!logOn(store, guildId) || m.author?.bot || (!content && !files.length) || !author) return;
    const e = card({
      kind: 'logs', title: files.length && !content ? 'Upload deleted' : 'Message deleted', emoji: '', gif: 'off',
      fields: [
        { name: 'Author', value: `<@${author}>`, inline: true }, { name: 'Where', value: `<#${m.channelId}>`, inline: true }, { name: 'Sent', value: kept ? `<t:${Math.floor(kept.at / 1000)}:R>` : 'recently', inline: true },
        ...(content ? [{ name: 'It said', value: content.slice(0, 1000), inline: false }] : []),
        ...(files.length ? [{ name: files.length === 1 ? 'Attached' : `Attached · ${files.length}`, value: (kept?.files ?? []).map((f) => f.name).join('\n').slice(0, 1000), inline: false }] : []),
      ],
    });
    void logWithFiles(client, store, guildId!, e, files);
  });

  client.on(Events.MessageBulkDelete, (msgs, ch) => {
    const lines: string[] = [];
    for (const m of msgs.values()) {
      const kept = store.recallMessage(m.id);
      store.forgetMessage(m.id);
      const content = m.content || kept?.content;
      const author = m.author?.id ?? kept?.author_id;
      const n = kept?.files.length ?? m.attachments.size;
      if ((content || n) && author && !m.author?.bot) lines.push(`<@${author}>: ${(content ?? '').replace(/\n/g, ' ').slice(0, 120)}${n ? ` · ${n} file${n === 1 ? '' : 's'}` : ''}`);
    }
    if (!lines.length || !logOn(store, ch.guildId)) return;
    void log(client, store, ch.guildId, card({ kind: 'logs', title: `${msgs.size} messages swept`, emoji: '', gif: 'off', body: `In <#${ch.id}>\n${lines.slice(0, 25).join('\n').slice(0, 3800)}${lines.length > 25 ? `\n-# and ${lines.length - 25} more` : ''}` }), 'server');
  });

  client.on(Events.MessageUpdate, (old, m) => {
    const kept = store.recallMessage(m.id);
    const before = old.content || kept?.content || '';
    const guildId = m.guildId ?? kept?.guild_id ?? null;
    if (!guildId || m.author?.bot) return;
    // files taken off in the edit: anything kept that the message no longer has
    const now = new Set([...m.attachments.values()].map((a) => a.name));
    const gone = (kept?.files ?? []).filter((f) => !now.has(f.name));
    store.keepMessage(m.id, guildId, m.channelId, m.author?.id ?? kept?.author_id ?? '', m.content ?? '', (kept?.files ?? []).filter((f) => now.has(f.name)));
    const textChanged = !!before && before !== (m.content ?? '');
    if (!logOn(store, guildId) || (!textChanged && !gone.length)) return;
    const e = card({
      kind: 'logs', title: textChanged ? 'Message edited' : 'Upload removed in an edit', emoji: '', gif: 'off',
      fields: [
        { name: 'Author', value: `<@${m.author?.id ?? kept?.author_id}>`, inline: true }, { name: 'Where', value: `[jump](${m.url})`, inline: true },
        ...(textChanged ? [{ name: 'Before', value: before.slice(0, 1000), inline: false }, { name: 'After', value: (m.content ?? '').slice(0, 1000) || '*empty*', inline: false }] : []),
        ...(gone.length ? [{ name: 'Taken off', value: gone.map((f) => f.name).join('\n').slice(0, 1000), inline: false }] : []),
      ],
    });
    void logWithFiles(client, store, guildId, e, gone.filter((f) => existsSync(f.path)).map((f) => new AttachmentBuilder(f.path, { name: f.name })));
  });

  client.on(Events.GuildBanAdd, (b) => {
    if (logOn(store, b.guild.id)) void log(client, store, b.guild.id, card({ kind: 'ban', title: 'Banned', emoji: '🔨', gif: 'off', color: RED, fields: [{ name: '👤 Who', value: `${b.user.username} (\`${b.user.id}\`)`, inline: true }] }));
  });
  client.on(Events.GuildBanRemove, (b) => {
    if (logOn(store, b.guild.id)) void log(client, store, b.guild.id, card({ kind: 'unban', title: 'Unbanned', emoji: '🕊️', gif: 'off', fields: [{ name: '👤 Who', value: `${b.user.username} (\`${b.user.id}\`)`, inline: true }] }));
  });
}

// copies of what people upload, kept three days so a deleted picture can still be shown in the log
const fileDir = fileURLToPath(new URL('../cache/uploads/', import.meta.url));
const MAX_FILE = 8 * 1024 * 1024;
async function keepFiles(id: string, list: { url: string; name: string; size: number }[]) {
  mkdirSync(fileDir, { recursive: true });
  const out: { name: string; path: string }[] = [];
  for (const [i, a] of list.slice(0, 4).entries()) {
    if (a.size > MAX_FILE) continue;
    const res = await fetch(a.url).catch(() => null);
    if (!res?.ok) continue;
    const path = `${fileDir}${id}-${i}-${a.name.replace(/[^\w.-]/g, '_').slice(-60)}`;
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    out.push({ name: a.name, path });
  }
  return out;
}
function dropOldFiles(days: number) {
  if (!existsSync(fileDir)) return;
  const cutoff = Date.now() - days * 86_400_000;
  for (const f of readdirSync(fileDir)) { try { if (statSync(`${fileDir}${f}`).mtimeMs < cutoff) unlinkSync(`${fileDir}${f}`); } catch { /* gone already */ } }
}
// the log entry with the kept files attached, the first picture shown in the card itself
async function logWithFiles(client: Client, store: Store, guildId: string, e: EmbedBuilder, files: AttachmentBuilder[]) {
  if (!files.length) return log(client, store, guildId, e, 'server');
  const id = store.getKv(`serverlog:${guildId}`) ?? store.guild(guildId).mod.logChannel;
  const ch = id ? await client.channels.fetch(id).catch(() => null) : null;
  if (!ch?.isSendable()) return;
  const pic = files.find((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? ''));
  if (pic) e.setImage(`attachment://${pic.name}`);
  await ch.send({ embeds: [e], files, allowedMentions: { parse: [] } }).catch(() => {});
}
