import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type Interaction, type MessageActionRowComponentBuilder } from 'discord.js';

// an offer one person makes another: a proposal, an adoption, a duel. Nothing starts until they accept,
// they can decline, the one who asked can take it back, and it runs out on its own

export interface Offer<T = unknown> {
  key: string;
  kind: string;
  from: string;
  to: string;
  guild: string;
  at: number;
  data: T;
}
interface Kind {
  // what the card says while it waits
  title: string;
  color: number;
  accept: string;
  decline: string;
  // runs when they accept, it owns the message from here on
  onAccept: (i: ButtonInteraction, o: Offer) => Promise<void>;
  onDecline?: (o: Offer) => string;
  minutes?: number;
}

const kinds = new Map<string, Kind>();
const open = new Map<string, Offer>();

export function offerKind(kind: string, k: Kind) { kinds.set(kind, k); }

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// the waiting card, with the people pinged in the content so the one asked gets the notification
export function makeOffer<T>(kind: string, from: string, to: string, guild: string, body: string, data: T) {
  const k = kinds.get(kind)!;
  const key = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  open.set(key, { key, kind, from, to, guild, at: Date.now(), data });
  if (open.size > 300) open.delete(open.keys().next().value!);
  const mins = k.minutes ?? 5;
  const ends = Math.floor((Date.now() + mins * 60_000) / 1000);
  const e = new EmbedBuilder().setColor(k.color).setTitle(k.title).setDescription(`${body}\n\n-# <@${to}> has until <t:${ends}:t> to answer`);
  return {
    content: `<@${to}>`,
    embeds: [e],
    components: [row(
      new ButtonBuilder().setCustomId(`ofr|${key}|yes`).setLabel(k.accept).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ofr|${key}|no`).setLabel(k.decline).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`ofr|${key}|back`).setLabel('Take it back').setStyle(ButtonStyle.Secondary),
    )],
    ping: [to],
  };
}

const closed = (text: string, color = 0x5c5f66) => ({ content: '', embeds: [new EmbedBuilder().setColor(color).setDescription(text)], components: [] });

export async function onOffer(i: Interaction): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('ofr|')) return false;
  const [, key, what] = i.customId.split('|');
  const o = open.get(key);
  const k = o ? kinds.get(o.kind) : null;
  if (!o || !k) { await i.update(closed('This one isn\'t open any more.')).catch(() => {}); return true; }
  if (Date.now() - o.at > (k.minutes ?? 5) * 60_000) {
    open.delete(key);
    await i.update(closed(`<@${o.to}> didn't answer in time. Ask again whenever.`)).catch(() => {});
    return true;
  }
  if (what === 'back') {
    if (i.user.id !== o.from) { await i.reply({ content: 'Only the one who asked can take it back.', flags: MessageFlags.Ephemeral }); return true; }
    open.delete(key);
    await i.update(closed(`<@${o.from}> took it back.`)).catch(() => {});
    return true;
  }
  if (i.user.id !== o.to) { await i.reply({ content: `That's for <@${o.to}> to answer.`, flags: MessageFlags.Ephemeral }); return true; }
  open.delete(key);
  if (what === 'no') {
    await i.update(closed(k.onDecline?.(o) ?? `<@${o.to}> said no.`, 0x8a3b3b)).catch(() => {});
    return true;
  }
  await k.onAccept(i, o);
  return true;
}
