import { ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration, type Client, type Message } from 'discord.js';
import type { Store } from '../db.js';
import { staffRoles } from '../core/staff.js';
import { track } from './missions.js';

// the evidence board: pictures, clips and links for everyone, comments in a thread under each post,
// and Texz brings something of its own every day: the picture of the day and two meme drops

const UA = { 'User-Agent': 'texz-discord-bot (evidence board)' };
const boardOf = (store: Store, g: string) => store.getKv(`mediach:${g}`);

// anyone can post files and links here, whatever their rank
export async function openBoards(client: Client, store: Store) {
  for (const guild of client.guilds.cache.values()) {
    const id = boardOf(store, guild.id);
    if (!id) continue;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) continue;
    const now = ch.permissionOverwrites.cache.get(guild.id);
    if (now?.allow.has(PermissionFlagsBits.AttachFiles) && now.allow.has(PermissionFlagsBits.EmbedLinks)) continue;
    await ch.permissionOverwrites.edit(guild.id, { AttachFiles: true, EmbedLinks: true }, { reason: 'the evidence board is open to everyone' }).catch((e) => console.log(`evidence board perms: ${(e as Error).message}`));
  }
}

const hasMedia = (m: Message) => m.attachments.size > 0 || m.stickers.size > 0 || /https?:\/\/\S+/i.test(m.content);

export async function onEvidence(store: Store, m: Message) {
  if (!m.guildId || m.author.bot || m.channelId !== boardOf(store, m.guildId) || !store.rules(m.guildId, 'community').enabled) return;
  const g = m.guildId;
  if (!hasMedia(m)) {
    const prefix = store.guild(g).prefix.toLowerCase();
    const staff = m.member?.permissions.has(PermissionFlagsBits.ManageMessages) || staffRoles(store, g).some((r) => m.member?.roles.cache.has(r));
    if (staff || m.content.toLowerCase().startsWith(`${prefix} `)) return;
    await m.delete().catch(() => {});
    const key = `evnudge:${g}:${m.author.id}`;
    if (Date.now() - Number(store.getKv(key) ?? 0) > 120_000 && m.channel.isSendable()) {
      store.setKv(key, String(Date.now()));
      const n = await m.channel.send({ content: `📸 <@${m.author.id}> only pictures, clips and links go on the evidence board. Talk about a post in the thread under it.`, allowedMentions: { users: [m.author.id] } }).catch(() => null);
      if (n) setTimeout(() => void n.delete().catch(() => {}), 7000);
    }
    return;
  }
  // a thread under the post for the comments
  const name = m.member?.displayName ?? m.author.username;
  const thread = await m.startThread({ name: `💬 ${name}'s evidence`.slice(0, 90), autoArchiveDuration: ThreadAutoArchiveDuration.OneDay }).catch(() => null);
  // it counts for quests and medals once a minute at most, so a burst of uploads isn't a farm
  const at = `evlast:${g}:${m.author.id}`;
  if (Date.now() - Number(store.getKv(at) ?? 0) < 60_000) return;
  store.setKv(at, String(Date.now()));
  const lines = track(store, g, m.author.id, 'evidence');
  if (lines.length && thread) await thread.send({ content: lines.join('\n'), allowedMentions: { users: [m.author.id] } }).catch(() => {});
}

// ---------- what Texz brings

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, '\'').replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// Wikimedia's picture of the day: a different freely licensed photo every day, with its credit
async function pictureOfDay(day: string) {
  const [y, mo, d] = day.split('-');
  const r = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${y}/${mo}/${d}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const j = await r.json() as { image?: { title: string; file_page: string; thumbnail?: { source: string }; image?: { source: string; width: number }; description?: { text?: string }; artist?: { text?: string }; license?: { type?: string } } };
  const im = j.image;
  if (!im) return null;
  const src = im.image && im.image.width <= 2400 ? im.image.source : im.thumbnail?.source ?? im.image?.source;
  if (!src) return null;
  return {
    embeds: [{
      title: '📸 Picture of the day',
      url: im.file_page,
      description: cut(strip(im.description?.text ?? im.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')), 350),
      image: { url: src },
      color: 0xc2a46e,
      footer: { text: cut(`${strip(im.artist?.text ?? 'Unknown')} · ${im.license?.type ?? 'free licence'} · Wikimedia Commons`, 200) },
    }],
  };
}

// a meme from a rotating set of boards, the best liked one nobody here has seen yet
const MEME_BOARDS = [['BungouStrayDogs', 'Animemes'], ['Animemes', 'wholesomeanimemes'], ['wholesomememes', 'Animemes']];
async function memeFor(store: Store, g: string, boards: string[]) {
  const seen: string[] = JSON.parse(store.getKv(`evseen:${g}`) ?? '[]');
  for (const board of boards) {
    const r = await fetch(`https://meme-api.com/gimme/${board}/25`, { headers: UA, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json() as { memes?: { postLink: string; subreddit: string; title: string; url: string; nsfw: boolean; spoiler: boolean; author: string; ups: number }[] };
    const ok = (j.memes ?? []).filter((x) => !x.nsfw && !x.spoiler && /\.(png|jpe?g|gif|webp)$/i.test(x.url) && !seen.includes(x.postLink)).sort((a, b) => b.ups - a.ups);
    const pick = ok[0];
    if (!pick) continue;
    store.setKv(`evseen:${g}`, JSON.stringify([...seen, pick.postLink].slice(-400)));
    return {
      embeds: [{
        title: cut(pick.title, 240),
        url: pick.postLink,
        image: { url: pick.url },
        color: 0x8a70e0,
        footer: { text: `r/${pick.subreddit} · u/${pick.author}` },
      }],
    };
  }
  return null;
}

// what Texz brings goes in a thread of its own per kind, so people's posts on the board don't get buried
const THREADS = { potd: '📸 Picture of the day', meme: '😂 Meme drops' } as const;
async function threadFor(store: Store, board: import('discord.js').TextChannel, kind: keyof typeof THREADS) {
  const key = `evthread:${board.guildId}:${kind}`;
  const id = store.getKv(key);
  if (id) {
    const t = await board.threads.fetch(id).catch(() => null);
    if (t) {
      if (t.archived) await t.setArchived(false).catch(() => {});
      return t;
    }
  }
  const t = await board.threads.create({ name: THREADS[kind], autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, reason: 'a home for the daily drops' }).catch(() => null);
  if (t) store.setKv(key, t.id);
  return t;
}

// once a day each: the picture in the morning and a meme in the afternoon and at night, India time
const DROPS: { key: string; at: number; what: 'potd' | 'meme' }[] = [
  { key: 'potd', at: 3 * 60 + 30, what: 'potd' },
  { key: 'meme1', at: 8 * 60 + 30, what: 'meme' },
  { key: 'meme2', at: 15 * 60 + 30, what: 'meme' },
];
export function startEvidenceDrops(client: Client, store: Store) {
  const tick = async () => {
    const now = new Date();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const day = now.toISOString().slice(0, 10);
    for (const guild of client.guilds.cache.values()) {
      const id = boardOf(store, guild.id);
      if (!id || !store.rules(guild.id, 'community').enabled || store.getKv(`evdrops:${guild.id}`) === 'off') continue;
      for (const [n, d] of DROPS.entries()) {
        // a drop only goes out in its own slot, so a restart at night doesn't post the morning one late
        const next = DROPS[n + 1]?.at ?? 24 * 60;
        if (mins < d.at || mins >= next || !store.firstTime(guild.id, `ev${d.key}:${day}`)) continue;
        const board = await guild.channels.fetch(id).catch(() => null);
        if (!board || board.type !== ChannelType.GuildText) continue;
        const ch = await threadFor(store, board, d.what);
        if (!ch) continue;
        const day0 = Math.floor(Date.parse(day) / 86_400_000);
        const out = d.what === 'potd'
          ? await pictureOfDay(day).catch(() => null)
          : await memeFor(store, guild.id, MEME_BOARDS[(day0 + n) % MEME_BOARDS.length]).catch(() => null);
        if (out) await ch.send(out).catch((e) => console.log(`evidence drop: ${(e as Error).message}`));
      }
    }
  };
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), 10 * 60_000);
}
