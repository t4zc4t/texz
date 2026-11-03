import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store, WatchEntry } from '../db.js';
import type { Command } from '../core/module.js';
import { mediaById, searchMedia, titleOf, type Media } from '../anime/anilist.js';
import { card } from '../theme.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

export const statuses = ['watching', 'planning', 'completed', 'paused', 'dropped'] as const;
type Status = (typeof statuses)[number];
const icon: Record<Status, string> = { watching: '▶️', planning: '🗓️', completed: '✅', paused: '⏸️', dropped: '🗑️' };
// manga gets "reading" instead of "watching"
const label = (s: string, kind: string) => (s === 'watching' && kind === 'MANGA' ? 'Reading' : s[0].toUpperCase() + s.slice(1));
const isStatus = (s: string | null | undefined): s is Status => !!s && (statuses as readonly string[]).includes(s);

// the menu that sits under every anime and manga card, it works for whoever presses it
export function listMenu(m: Media) {
  return new StringSelectMenuBuilder().setCustomId(`wls|${m.id}`).setPlaceholder('📋 Put it on my list as...')
    .addOptions(
      ...statuses.map((s) => ({ label: label(s, m.type), value: s, emoji: icon[s] })),
      { label: 'Take it off my list', value: 'remove', emoji: '✖️' },
    );
}

function save(store: Store, userId: string, m: Media, status: Status, old: WatchEntry | null) {
  const total = (m.type === 'ANIME' ? m.episodes : m.chapters) ?? null;
  // finishing something fills the progress bar, starting it again keeps where you were
  const progress = status === 'completed' && total ? total : old?.progress ?? 0;
  store.watch({ user_id: userId, media_id: m.id, title: titleOf(m), kind: m.type, status, progress, total });
}

const PER = 10;

export function listPage(store: Store, viewer: string, who: string, status: string, page: number) {
  const all = store.watchlist(who, status === 'all' ? undefined : status);
  const pages = Math.max(1, Math.ceil(all.length / PER));
  page = Math.min(Math.max(page, 0), pages - 1);
  const shown = all.slice(page * PER, page * PER + PER);
  const counts = statuses.map((s) => [s, store.watchlist(who, s).length] as const).filter(([, n]) => n);
  const body = shown.length
    ? shown.map((e) => {
        const p = e.total ? `${e.progress}/${e.total}` : e.progress ? `${e.progress}` : '';
        return `${icon[e.status as Status] ?? '▫️'} **[${e.title}](https://anilist.co/${e.kind.toLowerCase()}/${e.media_id})**${p ? ` · ${e.kind === 'MANGA' ? 'ch' : 'ep'} ${p}` : ''}`;
      }).join('\n')
    : who === viewer ? 'Empty. Look something up with `tz anime <title>` and use the 📋 menu under it.' : 'Nothing on their list yet.';
  const e = card({
    kind: 'watchlist', title: who === viewer ? 'My list' : 'Their list', emoji: '📋', gif: 'off',
    body: `${who === viewer ? '' : `<@${who}>'s file\n\n`}${body}`,
    fields: counts.length ? [{ name: 'Totals', value: counts.map(([s, n]) => `${icon[s]} ${n} ${s}`).join(' · '), inline: false }] : [],
  });
  e.setFooter({ text: `Page ${page + 1}/${pages}${status === 'all' ? '' : ` · ${status}`}` });
  const rows: Row[] = [
    row(new StringSelectMenuBuilder().setCustomId(`wlf|${viewer}|${who}`).setPlaceholder('🗂️ Show...').addOptions(
      { label: 'Everything', value: 'all', default: status === 'all' },
      ...statuses.map((s) => ({ label: label(s, 'ANIME'), value: s, emoji: icon[s], default: status === s })),
    )),
  ];
  if (who === viewer && shown.length) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`wle|${viewer}`).setPlaceholder('✏️ Update one of these')
      .addOptions(shown.map((x) => ({ label: x.title.slice(0, 100), value: String(x.media_id), emoji: icon[x.status as Status] ?? '▫️' })))));
  }
  if (pages > 1) {
    const nav = (p: number, text: string, emoji: string) => new ButtonBuilder().setCustomId(`wl|${viewer}|${who}|${status}|${p}`)
      .setLabel(text).setEmoji(emoji).setStyle(ButtonStyle.Secondary).setDisabled(p < 0 || p >= pages);
    rows.push(row(nav(page - 1, 'Prev', '◀️'), nav(page + 1, 'Next', '▶️')));
  }
  return { embeds: [e], components: rows };
}

// a small private panel for one show: status, +1, exact progress, remove
function entryPanel(e: WatchEntry) {
  const unit = e.kind === 'MANGA' ? 'chapter' : 'episode';
  const em = card({
    kind: 'watchlist', title: e.title, emoji: icon[e.status as Status] ?? '📋', gif: 'off',
    body: `${label(e.status, e.kind)} · ${unit} ${e.progress}${e.total ? ` of ${e.total}` : ''}`,
  });
  return {
    embeds: [em],
    components: [
      row(new StringSelectMenuBuilder().setCustomId(`wlcs|${e.media_id}`).setPlaceholder('Change status').addOptions(
        statuses.map((s) => ({ label: label(s, e.kind), value: s, emoji: icon[s], default: e.status === s })))),
      row(
        new ButtonBuilder().setCustomId(`wlc|${e.media_id}|plus`).setLabel(`+1 ${unit}`).setEmoji('➕').setStyle(ButtonStyle.Success).setDisabled(!!e.total && e.progress >= e.total),
        new ButtonBuilder().setCustomId(`wlc|${e.media_id}|set`).setLabel('Set progress').setEmoji('🔢').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`wlc|${e.media_id}|del`).setLabel('Remove').setEmoji('✖️').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

export async function onWatchlist(store: Store, i: Interaction): Promise<boolean> {
  if (!('customId' in i) || typeof i.customId !== 'string') return false;
  const [tag, a, b, c, d] = i.customId.split('|');
  if (!['wls', 'wl', 'wlf', 'wle', 'wlcs', 'wlc', 'wlm'].includes(tag)) return false;
  const me = i.user.id;

  if (tag === 'wls' && i.isStringSelectMenu()) {
    const choice = i.values[0];
    const id = Number(a);
    if (choice === 'remove') {
      const gone = store.unwatch(me, id);
      await i.reply({ content: gone ? '✖️ Off your list.' : 'It wasn\'t on your list.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const m = await mediaById(id).catch(() => null);
    if (!m || !isStatus(choice)) { await i.reply({ content: 'AniList didn\'t answer, try again.', flags: MessageFlags.Ephemeral }); return true; }
    save(store, me, m, choice, store.watchEntry(me, id));
    await i.reply({ content: `${icon[choice]} **${titleOf(m)}** is on your list as *${label(choice, m.type).toLowerCase()}*. \`tz wl\` shows the whole file.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // the list itself only turns pages for whoever opened it
  if ((tag === 'wl' || tag === 'wlf' || tag === 'wle') && a !== me) {
    await i.reply({ content: 'Open your own with `/watchlist`.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (tag === 'wl' && i.isButton()) { await i.update(listPage(store, a, b, c, Number(d))); return true; }
  if (tag === 'wlf' && i.isStringSelectMenu()) { await i.update(listPage(store, a, b, i.values[0], 0)); return true; }
  if (tag === 'wle' && i.isStringSelectMenu()) {
    const e = store.watchEntry(me, Number(i.values[0]));
    if (!e) { await i.reply({ content: 'That one isn\'t on your list anymore.', flags: MessageFlags.Ephemeral }); return true; }
    await i.reply({ ...entryPanel(e), flags: MessageFlags.Ephemeral });
    return true;
  }

  // the private panel, always the presser's own entry
  const e = store.watchEntry(me, Number(a));
  if (!e) { await i.reply({ content: 'That one isn\'t on your list anymore.', flags: MessageFlags.Ephemeral }); return true; }
  if (tag === 'wlcs' && i.isStringSelectMenu() && isStatus(i.values[0])) {
    const status = i.values[0];
    store.watch({ ...e, status, progress: status === 'completed' && e.total ? e.total : e.progress });
  }
  if (tag === 'wlc' && i.isButton()) {
    if (b === 'set') {
      await i.showModal(new ModalBuilder().setCustomId(`wlm|${e.media_id}`).setTitle(e.title.slice(0, 45)).addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('n')
          .setLabel(`${e.kind === 'MANGA' ? 'Chapter' : 'Episode'} you're on${e.total ? ` (of ${e.total})` : ''}`)
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(String(e.progress))),
      ));
      return true;
    }
    if (b === 'del') {
      store.unwatch(me, e.media_id);
      await i.update({ content: `✖️ **${e.title}** is off your list.`, embeds: [], components: [] });
      return true;
    }
    if (b === 'plus') {
      const progress = e.total ? Math.min(e.total, e.progress + 1) : e.progress + 1;
      // the last episode closes the case on its own
      const status = e.total && progress >= e.total ? 'completed' : e.status === 'planning' ? 'watching' : e.status;
      store.watch({ ...e, progress, status });
    }
  }
  if (tag === 'wlm' && i.isModalSubmit()) {
    const n = Number.parseInt(i.fields.getTextInputValue('n'), 10);
    if (!(n >= 0) || (e.total && n > e.total)) { await i.reply({ content: `Pick a number from 0 to ${e.total ?? 'whatever you\'re on'}.`, flags: MessageFlags.Ephemeral }); return true; }
    store.watch({ ...e, progress: n, status: e.total && n >= e.total ? 'completed' : n > 0 && e.status === 'planning' ? 'watching' : e.status });
    const fresh = store.watchEntry(me, e.media_id)!;
    if (i.isFromMessage()) await i.update(entryPanel(fresh));
    else await i.reply({ ...entryPanel(fresh), flags: MessageFlags.Ephemeral });
    return true;
  }
  if (i.isMessageComponent()) await i.update(entryPanel(store.watchEntry(me, e.media_id)!));
  return true;
}

export const watchlist: Command = {
  name: 'watchlist',
  data: new SlashCommandBuilder().setName('watchlist').setDescription('Your anime and manga list, with a status for each')
    .addSubcommand((s) => s.setName('view').setDescription('Open a list')
      .addStringOption((o) => o.setName('status').setDescription('Only one status').addChoices(...statuses.map((x) => ({ name: x, value: x }))))
      .addUserOption((o) => o.setName('user').setDescription('Someone else\'s list')))
    .addSubcommand((s) => s.setName('add').setDescription('Add or move a show on your list')
      .addStringOption((o) => o.setName('title').setDescription('Title to search').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('status').setDescription('Planning if empty').addChoices(...statuses.map((x) => ({ name: x, value: x }))))
      .addStringOption((o) => o.setName('type').setDescription('Anime unless you say manga').addChoices({ name: 'anime', value: 'ANIME' }, { name: 'manga', value: 'MANGA' })))
    .toJSON(),
  // tz wl, tz wl completed, tz wl @user, tz wl add watching frieren
  text: { aliases: ['wl', 'mylist'], sub: true, subArgs: { add: ['status', 'title'] } },
  run: async (ctx, store) => {
    let sub = ctx.sub() ?? 'view';
    let status: string = ctx.str('status') ?? 'all';
    let who = ctx.user('user') ?? ctx.userId;
    if (ctx.viaText && sub !== 'add' && sub !== 'view') {
      if (isStatus(sub)) status = sub;
      else if (/^<@!?\d+>$/.test(sub)) who = sub.replace(/\D/g, '');
      sub = 'view';
    }
    if (sub === 'view') return ctx.reply({ ...listPage(store, ctx.userId, who, status, 0), private: false });

    // add: the text form lets the status go first and be skipped, "tz wl add frieren" means planning
    let title = ctx.str('title');
    let st = ctx.str('status');
    if (ctx.viaText && st && !isStatus(st)) { title = `${st} ${title ?? ''}`.trim(); st = null; }
    if (!title) return ctx.reply('Which one? `tz wl add watching frieren`');
    let type = (ctx.str('type') as 'ANIME' | 'MANGA' | null) ?? 'ANIME';
    if (ctx.viaText && /^manga\s/i.test(title)) { type = 'MANGA'; title = title.replace(/^manga\s+/i, ''); }
    const found = await searchMedia(title, type).catch(() => null);
    if (!found) return ctx.reply('AniList didn\'t answer, try again in a moment.');
    if (!found.length) return ctx.reply(`Nothing called "${title}" on AniList.`);
    const m = found[0];
    const s: Status = isStatus(st) ? st : 'planning';
    save(store, ctx.userId, m, s, store.watchEntry(ctx.userId, m.id));
    return ctx.reply(`${icon[s]} **${titleOf(m)}** filed as *${label(s, m.type).toLowerCase()}*. Wrong one? Look it up with \`tz ${m.type === 'MANGA' ? 'manga' : 'anime'}\` and pick from the 📋 menu.`);
  },
};
