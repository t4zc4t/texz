import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';
import { fetchAvatar, profileCard } from '../features/rankcard.js';
import { levelOf, rankFor } from './levels.js';
import { fmtDate } from './birthdays.js';
import { searchMedia, titleOf } from '../anime/anilist.js';

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

export const f1Teams: Record<string, string> = {
  'Red Bull': '#3671c6', Ferrari: '#e8002d', Mercedes: '#27f4d2', McLaren: '#ff8000', 'Aston Martin': '#229971', Alpine: '#ff87bc',
  Williams: '#64c4ff', Haas: '#b6babd', Audi: '#bb0a30', 'Racing Bulls': '#6692ff', Cadillac: '#c9a227',
};

// what can go on the card, everything personal starts hidden
const parts = {
  club: 'Football club', team: 'F1 team', anime: 'Favourite anime', manga: 'Favourite manga',
  level: 'Level and rank', yen: 'Yen', birthday: 'Birthday', done: 'Anime finished',
} as const;
type Part = keyof typeof parts;
interface Picks { club?: string; team?: string; anime?: string; manga?: string; color?: string; show: Part[]; ping?: boolean }

export function picksOf(store: Store, userId: string): Picks {
  const saved = JSON.parse(store.getKv(`picks:${userId}`) ?? '{}') as Partial<Picks>;
  // the old favourite anime moves over on its own
  const old = store.profile(userId).favourite;
  return { anime: old ?? undefined, ...saved, show: saved.show ?? ['level', 'birthday'] };
}
export const savePicks = (store: Store, userId: string, p: Picks) => store.setKv(`picks:${userId}`, JSON.stringify(p));

function editPanel(store: Store, userId: string) {
  const p = picksOf(store, userId);
  const bio = store.profile(userId).bio;
  const val = (k: Part) => ({ club: p.club, team: p.team, anime: p.anime, manga: p.manga } as Record<string, string | undefined>)[k];
  const lines = (Object.keys(parts) as Part[]).map((k) => `${p.show.includes(k) ? '👁️' : '🙈'} **${parts[k]}**${val(k) !== undefined ? ` · ${val(k) ?? ''}` : ''}${['club', 'team', 'anime', 'manga'].includes(k) && !val(k) ? ' · *not picked*' : ''}`);
  const e = card({ kind: 'profile', title: 'Your personnel file', emoji: '🗂️', gif: 'off',
    body: `${bio ? `> ${bio}\n\n` : ''}${lines.join('\n')}\n\nAccent: ${p.color ?? 'Agency sand'}\n-# Pick what shows in the menu, 👁️ shown and 🙈 hidden.` });
  const id = (a: string) => `pfe|${userId}|${a}`;
  return {
    embeds: [e],
    components: [
      row(new StringSelectMenuBuilder().setCustomId(id('show')).setPlaceholder('👁️ What shows on my card').setMinValues(0).setMaxValues(8)
        .addOptions((Object.keys(parts) as Part[]).map((k) => ({ label: parts[k], value: k, default: p.show.includes(k) })))),
      row(new StringSelectMenuBuilder().setCustomId(id('team')).setPlaceholder('🏎️ My F1 team').addOptions(
        { label: 'None', value: '-' }, ...Object.keys(f1Teams).map((t) => ({ label: t, value: t, default: p.team === t })))),
      row(
        new ButtonBuilder().setCustomId(id('club')).setLabel('Club').setEmoji('⚽').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('anime')).setLabel('Anime').setEmoji('📺').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('manga')).setLabel('Manga').setEmoji('📖').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('bio')).setLabel('Bio').setEmoji('🖋️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('color')).setLabel('Accent').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
      ),
      row(
        new ButtonBuilder().setCustomId(id('preview')).setLabel('Preview my card').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id('ping')).setLabel(`Pings for my club: ${p.ping === false ? 'off' : 'on'}`).setEmoji('🔔').setStyle(p.ping === false ? ButtonStyle.Secondary : ButtonStyle.Success),
      ),
    ],
  };
}

export async function drawProfile(store: Store, id: string, guildId: string | null, m: { displayName: string; user: { username: string }; displayAvatarURL: (o: object) => string } | null) {
  const p = picksOf(store, id);
  const show = new Set(p.show);
  const chips: { label: string; value: string; color?: string }[] = [];
  let title = 'Agency visitor';
  if (guildId && store.rules(guildId, 'levels').enabled) {
    const l = levelOf(store.xpOf(guildId, id).xp).level;
    title = rankFor(l).name;
    if (show.has('level')) chips.push({ label: 'Level', value: String(l) });
  }
  if (show.has('yen') && guildId && store.rules(guildId, 'economy').enabled) chips.push({ label: 'Yen', value: `¥${store.wallet(guildId, id).yen.toLocaleString()}` });
  const b = store.birthday(id);
  if (show.has('birthday') && b) chips.push({ label: 'Birthday', value: fmtDate(b.month, b.day) });
  if (show.has('team') && p.team) chips.push({ label: 'F1 team', value: p.team, color: f1Teams[p.team] });
  if (show.has('club') && p.club) chips.push({ label: 'Club', value: p.club });
  if (show.has('anime') && p.anime) chips.push({ label: 'Anime', value: p.anime });
  if (show.has('manga') && p.manga) chips.push({ label: 'Manga', value: p.manga });
  const done = store.watchlist(id, 'completed').length;
  if (show.has('done') && done) chips.push({ label: 'Anime done', value: String(done) });
  return profileCard({
    name: m?.displayName ?? 'Agent', handle: m?.user.username ?? id, title, bio: store.profile(id).bio, chips, accent: p.color,
    avatar: m ? await fetchAvatar(m.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 })) : null,
  });
}

const modal = (userId: string, what: string, label: string, value: string, max: number, hint: string) =>
  new ModalBuilder().setCustomId(`pfm|${userId}|${what}`).setTitle('Your personnel file').addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('v').setLabel(label)
      .setStyle(what === 'bio' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(max).setValue(value).setPlaceholder(hint)));

export async function onProfileEdit(store: Store, i: Interaction): Promise<boolean> {
  if (!('customId' in i) || typeof i.customId !== 'string') return false;
  const [tag, owner, what] = i.customId.split('|');
  if (tag !== 'pfe' && tag !== 'pfm') return false;
  if (owner !== i.user.id) { if (i.isRepliable()) await i.reply({ content: 'That\'s someone else\'s file. `tz profile edit` opens yours.', flags: MessageFlags.Ephemeral }); return true; }
  const p = picksOf(store, owner);
  if (tag === 'pfe') {
    if (i.isStringSelectMenu() && what === 'show') { p.show = i.values as Part[]; savePicks(store, owner, p); await i.update(editPanel(store, owner)); return true; }
    if (i.isStringSelectMenu() && what === 'team') { p.team = i.values[0] === '-' ? undefined : i.values[0]; if (p.team && !p.show.includes('team')) p.show.push('team'); savePicks(store, owner, p); await i.update(editPanel(store, owner)); return true; }
    if (!i.isButton()) return true;
    if (what === 'ping') { p.ping = p.ping === false; savePicks(store, owner, p); await i.update(editPanel(store, owner)); return true; }
    if (what === 'preview') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const m = i.guild ? await i.guild.members.fetch(owner).catch(() => null) : null;
      const png = await drawProfile(store, owner, i.guildId, m ?? { displayName: i.user.displayName, user: i.user, displayAvatarURL: (o) => i.user.displayAvatarURL(o) });
      await i.editReply({ files: [new AttachmentBuilder(png, { name: 'profile.png' })] });
      return true;
    }
    const current = what === 'bio' ? store.profile(owner).bio ?? '' : (p as unknown as Record<string, string | undefined>)[what] ?? '';
    const labels: Record<string, [string, number, string]> = {
      club: ['Football club (empty removes it)', 40, 'Real Madrid'], anime: ['Anime title, I\'ll look it up', 100, 'Bungo Stray Dogs'],
      manga: ['Manga title, I\'ll look it up', 100, 'Chainsaw Man'], bio: ['About you (empty removes it)', 180, 'A line or two'],
      color: ['Accent colour like #c2a46e (empty = default)', 7, '#c2a46e'],
    };
    const l = labels[what];
    if (l) await i.showModal(modal(owner, what, l[0], current.slice(0, l[1]), l[1], l[2]));
    return true;
  }
  if (!i.isModalSubmit()) return true;
  const v = i.fields.getTextInputValue('v').trim();
  let note = '';
  if (what === 'bio') store.setProfile(owner, { bio: v || null });
  if (what === 'club') { p.club = v || undefined; if (v && !p.show.includes('club')) p.show.push('club'); }
  if (what === 'color') {
    if (v && !/^#?[0-9a-f]{6}$/i.test(v)) note = 'That isn\'t a colour like #c2a46e, kept the old one.';
    else p.color = v ? `#${v.replace('#', '')}` : undefined;
  }
  if (what === 'anime' || what === 'manga') {
    if (!v) p[what] = undefined;
    else {
      const [hit] = await searchMedia(v, what === 'anime' ? 'ANIME' : 'MANGA').catch(() => []);
      p[what] = hit ? titleOf(hit).slice(0, 40) : v.slice(0, 40);
      if (!p.show.includes(what)) p.show.push(what);
    }
  }
  savePicks(store, owner, p);
  if (i.isFromMessage()) await i.update(editPanel(store, owner));
  else await i.reply({ ...editPanel(store, owner), flags: MessageFlags.Ephemeral });
  if (note) await i.followUp({ content: note, flags: MessageFlags.Ephemeral });
  return true;
}

export const profile: Command = {
  name: 'profile',
  group: 'info',
  data: new SlashCommandBuilder().setName('profile').setDescription('Your personnel file as a picture, with what you choose to show')
    .addSubcommand((s) => s.setName('view').setDescription('Show a profile card')
      .addUserOption((o) => o.setName('user').setDescription('Whose, yours if empty')))
    .addSubcommand((s) => s.setName('edit').setDescription('Pick your club, F1 team, anime, manga, bio, colour and what shows')).toJSON(),
  // tz profile, tz profile @user, tz profile edit
  text: { aliases: ['pf', 'card'], sub: true, subArgs: { view: ['user'] } },
  run: async (ctx, store) => {
    let sub = ctx.sub() ?? 'view';
    let who = ctx.user('user');
    if (ctx.viaText && /^<@!?\d+>$/.test(sub)) { who = sub.replace(/\D/g, ''); sub = 'view'; }
    if (['edit', 'settings', 'set', 'bio', 'fav', 'favourite', 'club', 'team'].includes(sub)) return ctx.reply(editPanel(store, ctx.userId));
    const id = who ?? ctx.userId;
    const m = ctx.guild ? await ctx.guild.members.fetch(id).catch(() => null) : null;
    const png = await drawProfile(store, id, ctx.guildId, m);
    return ctx.reply({ files: [new AttachmentBuilder(png, { name: 'profile.png' })] });
  },
};
