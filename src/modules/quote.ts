import { track } from './missions.js';
import { type Client, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Message, type MessageContextMenuCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { COLOR } from '../theme.js';
import { classicQuote, fetchAvatar, quoteCard } from '../features/rankcard.js';
import { report } from '../ops.js';

export const QUOTE_MENU = 'Make it a Quote';
export const quoteCommand = { type: 3, name: QUOTE_MENU, integration_types: [0, 1], contexts: [0, 1, 2] };

// mentions and custom emojis read as words in the picture
function cleanText(m: Message) {
  return m.content
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${m.mentions.users.get(id)?.displayName ?? 'someone'}`)
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${m.mentions.roles.get(id)?.name ?? 'role'}`)
    .replace(/<#(\d+)>/g, (_, id: string) => `#${(m.mentions.channels.get(id) as { name?: string } | undefined)?.name ?? 'channel'}`)
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/\*\*|__|~~|`/g, '')
    .trim();
}

// the picture inside the quote: an image, a gif's first frame, a video thumbnail, an embed picture or a sticker
function mediaOf(m: Message): { still: string | null; moving: string | null } {
  const a = m.attachments.find((x) => x.contentType?.startsWith('image/') || x.contentType?.startsWith('video/'));
  if (a) {
    const moving = a.contentType === 'image/gif' || a.contentType?.startsWith('video/') ? a.url : null;
    return { still: a.contentType?.startsWith('video/') ? `${a.proxyURL}?format=png` : a.url, moving };
  }
  const e = m.embeds.find((x) => x.image || x.thumbnail || x.video);
  if (e) return { still: e.image?.proxyURL ?? e.thumbnail?.proxyURL ?? null, moving: e.video ? e.url ?? null : null };
  const s = m.stickers.first();
  if (s && s.format !== 3) return { still: s.url, moving: null };
  return { still: null, moving: null };
}

async function grab(url: string | null) {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
}

// the framed picture of a message, shared by the right click menu, a typed reply and the slash command
export async function framed(store: Store, m: Message, by: string) {
  const text = cleanText(m);
  const media = mediaOf(m);
  if (!text && !media.still) return null;
  const name = m.member?.displayName ?? m.author.displayName;
  const avatar = await fetchAvatar((m.member ?? m.author).displayAvatarURL({ extension: 'png', forceStatic: true, size: 512 }));
  // words only get the classic black and white one, a message with a picture keeps the card that can show it
  const words = text.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').replace(/:\w+:/g, '').replace(/\s+/g, ' ').trim();
  const png = !media.still && words
    ? await classicQuote({ name, handle: m.author.username, text: words, avatar, at: m.createdTimestamp })
    : await quoteCard({
      name, text, at: m.createdTimestamp, where: m.guild ? `#${'name' in m.channel ? m.channel.name : 'chat'}` : 'DM',
      avatar, image: await grab(media.still),
    });
  const file = new AttachmentBuilder(png, { name: 'quote.png' });
  const e = new EmbedBuilder().setColor(COLOR).setImage('attachment://quote.png').setFooter({ text: `quoted by ${by}` }).setTimestamp(m.createdTimestamp);
  const jump = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(m.url).setLabel('Jump to the message'));
  const payload = { content: media.moving ?? undefined, embeds: [e], files: [file], components: [jump], allowedMentions: { parse: [] as never[] } };
  // a quotes channel picked in /setup gets it, otherwise it goes right where it was asked for
  const chId = m.guildId ? store.guild(m.guildId).quotes.channel : null;
  const ch = chId ? await m.client.channels.fetch(chId).catch(() => null) : null;
  // the hall copy needs its own file, a sent attachment can't be reused
  const copy = () => ({ ...payload, files: [new AttachmentBuilder(png, { name: 'quote.png' })] });
  return { payload, copy, hall: ch?.isSendable() ? ch : null, author: m.author.id };
}

export async function onQuote(store: Store, i: MessageContextMenuCommandInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const q = await framed(store, i.targetMessage, i.user.displayName);
  if (!q) return i.editReply('There\'s nothing in that message I can frame.');
  // it shows up where it was made, and a copy goes to the quotes channel if there is one
  await i.editReply(q.hall && q.hall.id !== i.channelId ? `🖼️ Framed, a copy is hanging in <#${q.hall.id}> too.` : '🖼️ Here it is.');
  const here = await i.followUp(q.payload).catch(() => null);
  const extra = track(store, i.guildId, i.user.id, 'quote');
  if (extra.length) await i.followUp({ content: extra.join('\n'), allowedMentions: { users: [i.user.id] } });
  const hung = q.hall && q.hall.id !== i.channelId ? await q.hall.send(q.copy()).catch((err) => { report('quote', err); return null; }) : null;
  if (i.guildId) remember(store, i.guildId, hung ?? here, q.author);
}

// "tz quote" as a reply to a message, or "/fun view:quote" with a message link
export const quote: Command = {
  name: 'quote',
  group: 'games',
  data: new SlashCommandBuilder().setName('quote').setDescription('Make it a quote: frame a message as a picture')
    .addStringOption((o) => o.setName('link').setDescription('Link to the message (or reply to it with tz quote)')).toJSON(),
  text: { aliases: ['frame', 'miq', 'makeitaquote'], args: ['link'] },
  run: async (ctx, store) => {
    const link = ctx.str('link') ?? '';
    const ids = /channels\/(?:\d+|@me)\/(\d+)\/(\d+)/.exec(link);
    let target: Message | null = null;
    if (ids) {
      const ch = await ctx.client.channels.fetch(ids[1]).catch(() => null);
      target = ch && 'messages' in ch ? await ch.messages.fetch(ids[2]).catch(() => null) : null;
    } else if (ctx.replyTo) target = await ctx.replyTo().catch(() => null);
    if (!target) return ctx.reply({ content: `🖼️ Reply to a message with \`tz quote\`, paste a message link, or right click a message → Apps → **${QUOTE_MENU}**.`, temp: true });
    const q = await framed(store, target, ctx.displayName ?? 'someone');
    if (!q) return ctx.reply({ content: 'There\'s nothing in that message I can frame.', temp: true });
    const here = await ctx.reply({ ...q.payload, public: true }) as Message | null;
    const extra = track(store, ctx.guildId, ctx.userId, 'quote');
    if (extra.length) await ctx.reply({ content: extra.join('\n'), public: true });
    const hung = q.hall && q.hall.id !== ctx.channelId ? await q.hall.send(q.copy()).catch((err) => { report('quote', err); return null; }) : null;
    if (ctx.guildId) remember(store, ctx.guildId, hung ?? (here && 'id' in here ? here : null), q.author);
  },
};

// every quote of the week is kept, the one with the most reactions gets featured on Sunday
function remember(store: Store, guild: string, m: { id: string; channelId: string } | null, author: string) {
  if (!m) return;
  const list = (JSON.parse(store.getKv(`quotes:${guild}`) ?? '[]') as { id: string; ch: string; author: string; at: number }[])
    .filter((q) => q.at > Date.now() - 8 * 86_400_000);
  list.push({ id: m.id, ch: m.channelId, author, at: Date.now() });
  store.setKv(`quotes:${guild}`, JSON.stringify(list.slice(-300)));
}

export function startQuoteOfWeek(client: Client, store: Store) {
  const tick = async () => {
    const d = new Date();
    if (d.getUTCDay() !== 0 || d.getUTCHours() < 14) return;
    for (const guild of client.guilds.cache.values()) {
      if (!store.firstTime(guild.id, `qotw:${d.toISOString().slice(0, 10)}`)) continue;
      const list = (JSON.parse(store.getKv(`quotes:${guild.id}`) ?? '[]') as { id: string; ch: string; author: string; at: number }[]).filter((q) => q.at > Date.now() - 7 * 86_400_000);
      let best: { msg: Message; author: string; n: number } | null = null;
      for (const q of list) {
        const ch = await client.channels.fetch(q.ch).catch(() => null);
        const msg = ch && 'messages' in ch ? await ch.messages.fetch(q.id).catch(() => null) : null;
        if (!msg) continue;
        const n = msg.reactions.cache.reduce((sum, r) => sum + r.count, 0);
        if (n > 0 && (!best || n > best.n)) best = { msg, author: q.author, n };
      }
      if (!best) continue;
      const extra = track(store, guild.id, best.author, 'quoteOfWeek');
      await best.msg.reply({ content: [`🏆 **Quote of the week**, ${best.n} reaction${best.n === 1 ? '' : 's'}. Words by <@${best.author}>.`, ...extra].join('\n'), allowedMentions: { users: [best.author] } }).catch(() => {});
    }
  };
  setInterval(() => void tick().catch((e) => report('quote of the week', e)), 3600_000).unref?.();
}
