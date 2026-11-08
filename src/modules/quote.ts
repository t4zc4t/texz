import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Message, type MessageContextMenuCommandInteraction } from 'discord.js';
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
  return { payload, hall: ch?.isSendable() ? ch : null };
}

export async function onQuote(store: Store, i: MessageContextMenuCommandInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const q = await framed(store, i.targetMessage, i.user.displayName);
  if (!q) return i.editReply('There\'s nothing in that message I can frame.');
  if (q.hall) {
    await q.hall.send(q.payload).catch((err) => report('quote', err));
    return i.editReply(`🖼️ Framed and hung in <#${q.hall.id}>.`);
  }
  await i.editReply('🖼️ Here it is.');
  return i.followUp(q.payload);
}

// "tz quote" as a reply to a message, or "/fun view:quote" with a message link
export const quote: Command = {
  name: 'quote',
  group: 'fun',
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
    if (q.hall && q.hall.id !== ctx.channelId) {
      await q.hall.send(q.payload).catch((err) => report('quote', err));
      return ctx.reply({ content: `🖼️ Framed and hung in <#${q.hall.id}>.`, temp: true });
    }
    return ctx.reply({ ...q.payload, public: true });
  },
};
