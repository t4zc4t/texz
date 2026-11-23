import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { searchMedia, titleOf } from '../anime/anilist.js';
import { Links, anilistLoginUrl, anilistUserExists, malReady, malUserExists, saveEntry, syncOne, viewerOf } from '../anime/linked.js';
import { report } from '../ops.js';
import { card } from '../theme.js';

const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

export const link: Command = {
  name: 'animelink',
  as: 'link',
  group: 'anime',
  data: new SlashCommandBuilder().setName('animelink').setDescription('Link your AniList or MyAnimeList, your list and episode alerts follow it')
    .addStringOption((o) => o.setName('site').setDescription('Where your list is').setRequired(true).addChoices({ name: 'AniList', value: 'anilist' }, { name: 'MyAnimeList', value: 'mal' }, { name: 'Unlink', value: 'off' }))
    .addStringOption((o) => o.setName('username').setDescription('Your username there').setMaxLength(40)).toJSON(),
  text: { aliases: ['alink'], args: ['site', 'username'] },
  run: async (ctx, store) => {
    const links = new Links(store.db);
    const site = ctx.str('site')?.toLowerCase().replace('myanimelist', 'mal');
    const name = ctx.str('username')?.trim();
    if (site === 'off' || site === 'unlink') { links.drop(ctx.userId); return ctx.reply('🔗 Unlinked. Your Texz list stays as it is.'); }
    if (site !== 'anilist' && site !== 'mal') {
      const l = links.get(ctx.userId);
      return ctx.reply(l ? `🔗 Linked to **${l.username}** on ${l.site === 'mal' ? 'MyAnimeList' : 'AniList'}${l.synced_at ? ` · synced <t:${Math.floor(l.synced_at / 1000)}:R>` : ''}${l.token ? ' · can update your list' : ''}` : '`tz anime link anilist <name>` or `tz anime link mal <name>`');
    }
    if (!name) return ctx.reply('Add your username.');
    if (site === 'mal' && !malReady()) return ctx.reply('MyAnimeList isn\'t set up on this bot yet.');
    await ctx.defer?.();
    const real = site === 'anilist' ? await anilistUserExists(name) : await malUserExists(name).catch(() => null);
    if (!real) return ctx.reply(`No public list for **${name}** there.`);
    links.set(ctx.userId, site, real);
    const list = await syncOne(store, ctx.userId).catch((e) => { report('anime link', e); return null; });
    if (!list) return ctx.reply(`🔗 Linked to **${real}**. The first sync will run shortly.`);
    const watching = list.filter((e) => e.status === 'watching' && e.kind === 'ANIME').length;
    return ctx.reply(`🔗 Linked to **${real}** · ${list.length} entries · episode alerts on for ${watching} show${watching === 1 ? '' : 's'}.`);
  },
};

export const login: Command = {
  name: 'animelogin',
  as: 'login',
  group: 'anime',
  data: new SlashCommandBuilder().setName('animelogin').setDescription('Let Texz update your AniList list when you change it here').toJSON(),
  text: { aliases: ['alogin'] },
  run: (ctx, store) => {
    const url = anilistLoginUrl();
    if (!url) return ctx.reply('AniList login isn\'t set up on this bot yet.');
    const l = new Links(store.db).get(ctx.userId);
    if (!l || l.site !== 'anilist') return ctx.reply('Link your AniList first: `tz anime link anilist <name>`');
    return ctx.reply({
      private: true,
      content: '1. Approve Texz on AniList\n2. Copy the code it shows\n3. Paste it here',
      components: [row(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Open AniList'),
        new ButtonBuilder().setCustomId(`allogin|${ctx.userId}`).setStyle(ButtonStyle.Primary).setLabel('Paste code'),
      )] as never,
    });
  },
};

// the paste box, and what's in it checked against AniList before it's kept
export async function onAnimeLink(store: Store, i: Interaction): Promise<boolean> {
  if (!('customId' in i) || !i.customId.startsWith('allogin|')) return false;
  const [, owner] = i.customId.split('|');
  if (i.user.id !== owner) { if (i.isRepliable()) await i.reply({ content: 'That one isn\'t yours.', flags: MessageFlags.Ephemeral }); return true; }
  if (i.isButton()) {
    await i.showModal(new ModalBuilder().setCustomId(`allogin|${owner}`).setTitle('AniList code').addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('t').setLabel('Paste the code from AniList').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)),
    ));
    return true;
  }
  if (i.isModalSubmit()) {
    const token = i.fields.getTextInputValue('t').trim();
    const links = new Links(store.db);
    const l = links.get(owner);
    const who = await viewerOf(token).catch(() => null);
    if (!who) { await i.reply({ content: 'That code didn\'t work. Get a fresh one and try again.', flags: MessageFlags.Ephemeral }); return true; }
    if (!l || who.toLowerCase() !== l.username.toLowerCase()) { await i.reply({ content: `That code is for **${who}**, not your linked account.`, flags: MessageFlags.Ephemeral }); return true; }
    links.token(owner, token);
    await i.reply({ content: '✅ Done. Changes you make in Texz now go to your AniList too.', flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

// a change made in Texz, sent on to AniList when the member logged in
export function pushToAniList(store: Store, userId: string, mediaId: number) {
  const l = new Links(store.db).get(userId);
  const e = store.watchEntry(userId, mediaId);
  if (!l?.token || l.site !== 'anilist' || !e) return;
  void saveEntry(l.token, mediaId, e.status, e.progress).catch((err) => {
    // a token AniList no longer accepts is dropped, they can log in again
    if (/invalid token|unauthor/i.test(String(err))) new Links(store.db).token(userId, null);
    else report('anilist update', err);
  });
}

export const who: Command = {
  name: 'animewho',
  as: 'who',
  group: 'anime',
  data: new SlashCommandBuilder().setName('animewho').setDescription('Who in the server is watching or has watched a show')
    .addStringOption((o) => o.setName('title').setDescription('Show title').setRequired(true).setMaxLength(100)).toJSON(),
  text: { aliases: ['awho'], args: ['title'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Only in a server.');
    const title = ctx.str('title');
    if (!title) return ctx.reply('Which show?');
    const m = (await searchMedia(title, 'ANIME').catch(() => null))?.[0];
    if (!m) return ctx.reply(`Nothing called "${title}".`);
    const rows = store.db.prepare('SELECT user_id, status, progress, total FROM watchlist WHERE media_id = ?').all(m.id) as { user_id: string; status: string; progress: number; total: number | null }[];
    const members = await ctx.guild.members.fetch().catch(() => ctx.guild!.members.cache);
    const here = rows.filter((r) => members.has(r.user_id));
    const by = (s: string) => here.filter((r) => r.status === s);
    const fields = [['▶️ Watching', 'watching'], ['✅ Done', 'completed'], ['🗓️ Planning', 'planning'], ['⏸️ Paused', 'paused']]
      .map(([name, s]) => ({ name, value: by(s).slice(0, 15).map((r) => `<@${r.user_id}>${s === 'watching' && r.progress ? ` · ep ${r.progress}` : ''}`).join('\n'), inline: true }))
      .filter((f) => f.value);
    const e = card({ kind: 'help', title: titleOf(m), emoji: '📺', gif: 'off', line: '', body: fields.length ? '' : 'Nobody here has it on their list.', fields });
    if (m.coverImage.large) e.setThumbnail(m.coverImage.large);
    return ctx.reply({ embeds: [e] });
  },
};

export const compare: Command = {
  name: 'animecompare',
  as: 'compare',
  group: 'anime',
  data: new SlashCommandBuilder().setName('animecompare').setDescription('Your list next to someone else\'s')
    .addUserOption((o) => o.setName('user').setDescription('Who to compare with').setRequired(true)).toJSON(),
  text: { aliases: ['acompare'], args: ['user'] },
  run: (ctx, store) => {
    const other = ctx.user('user');
    if (!other || other === ctx.userId) return ctx.reply('Pick someone else.');
    const mine = store.watchlist(ctx.userId).filter((e) => e.kind === 'ANIME');
    const theirs = store.watchlist(other).filter((e) => e.kind === 'ANIME');
    if (!mine.length || !theirs.length) return ctx.reply('Both lists need some anime on them.');
    const have = new Map(mine.map((e) => [e.media_id, e]));
    const both = theirs.filter((e) => have.has(e.media_id) && e.status !== 'planning' && have.get(e.media_id)!.status !== 'planning');
    const yourNext = theirs.filter((e) => e.status === 'completed' && !have.has(e.media_id)).slice(0, 10);
    const seen = new Set(theirs.map((e) => e.media_id));
    const theirNext = mine.filter((e) => e.status === 'completed' && !seen.has(e.media_id)).slice(0, 10);
    const pct = Math.round((both.length / Math.min(mine.length, theirs.length)) * 100);
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'List match', emoji: '🤝', gif: 'off', line: '',
      body: `<@${ctx.userId}> × <@${other}> · **${both.length}** in common (${pct}%)`,
      fields: [
        { name: 'Both watched', value: both.slice(0, 10).map((e) => e.title).join('\n') || 'None', inline: false },
        { name: 'They finished, you haven\'t', value: yourNext.map((e) => e.title).join('\n') || 'None', inline: true },
        { name: 'You finished, they haven\'t', value: theirNext.map((e) => e.title).join('\n') || 'None', inline: true },
      ],
    })] });
  },
};
