import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Message, type MessageContextMenuCommandInteraction } from 'discord.js';
import type { Store } from '../db.js';
import { COLOR } from '../theme.js';
import { fetchAvatar, quoteCard } from '../features/rankcard.js';
import { report } from '../ops.js';

export const quoteCommand = { type: 3, name: 'Quote', integration_types: [0, 1], contexts: [0, 1, 2] };

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

export async function onQuote(store: Store, i: MessageContextMenuCommandInteraction) {
  const m = i.targetMessage;
  const text = cleanText(m);
  const media = mediaOf(m);
  if (!text && !media.still) return i.reply({ content: 'There\'s nothing in that message I can frame.', flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const name = m.member?.displayName ?? m.author.displayName;
  const png = await quoteCard({
    name, text, at: m.createdTimestamp, where: m.guild ? `#${'name' in m.channel ? m.channel.name : 'chat'}` : 'DM',
    avatar: await fetchAvatar((m.member ?? m.author).displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 })),
    image: await grab(media.still),
  });
  const file = new AttachmentBuilder(png, { name: 'quote.png' });
  const e = new EmbedBuilder().setColor(COLOR).setImage('attachment://quote.png')
    .setFooter({ text: `quoted by ${i.user.displayName}` }).setTimestamp(m.createdTimestamp);
  const jump = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(m.url).setLabel('Jump to the message'));
  const payload = { content: media.moving ?? undefined, embeds: [e], files: [file], components: [jump], allowedMentions: { parse: [] } };
  // a quotes channel picked in /setup gets it, otherwise it goes right where it was asked for
  const chId = i.guildId && i.guild ? store.guild(i.guildId).quotes.channel : null;
  const ch = chId ? await i.client.channels.fetch(chId).catch(() => null) : null;
  if (ch?.isSendable()) {
    await ch.send(payload).catch((err) => report('quote', err));
    return i.editReply(`🖼️ Framed and hung in <#${ch.id}>.`);
  }
  await i.editReply('🖼️ Here it is.');
  return i.followUp(payload);
}
