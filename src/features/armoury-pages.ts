import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Store } from '../db.js';
import { refresh, weaponType, type ListedWeapon, type Pet, type Weapon } from '../owo/parse.js';
import { card } from '../theme.js';
import { analyseArmoury, roles } from './armoury.js';

const PER_PAGE = 10;
const rarityRank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, mythic: 4, legendary: 5, fabled: 6 };
const icon: Record<string, string> = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', mythic: '🟡', legendary: '🟠', fabled: '🔴' };

export const filters = {
  all: { label: 'Everything', test: () => true },
  // filled in per call from the analysis, see armouryPage
  junk: { label: 'Safe to dismantle', test: () => true },
  top: { label: 'Mythic and up', test: (w: ListedWeapon) => (rarityRank[w.rarity] ?? 0) >= 4 },
  epic: { label: 'Epic', test: (w: ListedWeapon) => w.rarity === 'epic' },
  rare: { label: 'Rare and below', test: (w: ListedWeapon) => (rarityRank[w.rarity] ?? 0) <= 2 },
  held: { label: 'Equipped', test: (w: ListedWeapon) => !!w.equippedOn },
  free: { label: 'Not equipped', test: (w: ListedWeapon) => !w.equippedOn },
  empowered: { label: 'Empowered', test: (w: ListedWeapon) => w.empowered },
  str: { label: 'STR weapons', test: (w: ListedWeapon) => roles[weaponType(w.name)]?.stat === 'STR' },
  mag: { label: 'MAG weapons', test: (w: ListedWeapon) => roles[weaponType(w.name)]?.stat === 'MAG' },
  support: { label: 'Tank and support', test: (w: ListedWeapon) => ['tank', 'support', 'heal'].includes(roles[weaponType(w.name)]?.role ?? '') },
} as const;
export type Filter = keyof typeof filters;

export const sorts = {
  rarity: { label: 'Rarity', cmp: (a: ListedWeapon, b: ListedWeapon) => (rarityRank[b.rarity] ?? 0) - (rarityRank[a.rarity] ?? 0) || b.quality - a.quality },
  quality: { label: 'Quality', cmp: (a: ListedWeapon, b: ListedWeapon) => b.quality - a.quality },
  type: { label: 'Type', cmp: (a: ListedWeapon, b: ListedWeapon) => weaponType(a.name).localeCompare(weaponType(b.name)) || b.quality - a.quality },
  id: { label: 'Weapon ID', cmp: (a: ListedWeapon, b: ListedWeapon) => b.id.localeCompare(a.id) },
} as const;
export type Sort = keyof typeof sorts;

// everything the buttons need lives in the custom id, so nothing has to be kept in memory
export const armId = (userId: string, page: number, filter: Filter, sort: Sort, what: string) =>
  `arm|${userId}|${page}|${filter}|${sort}|${what}`;

export function parseArmId(id: string) {
  const [tag, userId, page, filter, sort, what] = id.split('|');
  if (tag !== 'arm') return null;
  return { userId, page: Number(page) || 0, filter: (filter in filters ? filter : 'all') as Filter, sort: (sort in sorts ? sort : 'rarity') as Sort, what };
}

export function armouryPage(store: Store, userId: string, page: number, filter: Filter, sort: Sort) {
  const snap = store.snapshot<[string, ListedWeapon][]>(userId, 'armoury');
  const all = (snap?.data ?? []).map(([, w]) => w);
  const team = store.snapshot<Pet[]>(userId, 'team')?.data ?? null;
  const seen = new Map((store.snapshot<[string, Weapon][]>(userId, 'weapons')?.data ?? []).map(([id, w]) => [id, refresh(w)]));
  const shards = store.snapshot<number>(userId, 'shards')?.data ?? null;
  const a = analyseArmoury(all, team, seen);
  const junkIds = new Set(a.junk.map((w) => w.id));
  const test = filter === 'junk' ? (w: ListedWeapon) => junkIds.has(w.id) : filters[filter].test;
  const list = all.filter(test).sort(sorts[sort].cmp);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows = list.slice(p * PER_PAGE, (p + 1) * PER_PAGE).map((w) => {
    const tags = [w.empowered ? '⚡' : '', w.equippedOn ? `🤝 ${w.equippedOn}` : ''].filter(Boolean).join(' ');
    return `${icon[w.rarity] ?? '•'} \`${w.id}\` **${w.name}** · ${w.quality}%${tags ? ` · ${tags}` : ''}`;
  });

  const head = [a.summary, shards !== null ? `🔷 **${shards.toLocaleString()}** shards` : ''].filter(Boolean).join(' · ');
  const fields = [
    { name: `📜 ${filters[filter].label} · ${list.length}`, value: rows.join('\n') || 'Nothing matches that filter.', inline: false },
  ];
  // the summary bits ride along on page one so the list stays short
  if (p === 0 && filter === 'all' && a.picks.length) fields.push({ name: '🎯 Best damage pick per pet', value: a.picks.join('\n'), inline: false });
  if (p === 0 && filter !== 'junk') {
    fields.push({
      name: '🧹 Clean-up',
      value: a.junk.length
        ? `**${a.junk.length}** weaker duplicates nobody holds, about **${a.junkShards}** shards. Pick *Safe to dismantle* below to see them.`
        : 'Nothing to throw away. A tidy arsenal, how unlike me.',
      inline: false,
    });
  }
  if (filter === 'junk' && a.junk.length) fields.push({ name: '🔨 Dismantle', value: `One at a time: \`owo dismantle ${a.junk[0].id}\`\nI keep anything equipped, empowered, epic or better, and the best copy of each type.`, inline: false });
  fields.push({ name: '📄 Page', value: `${p + 1} / ${pages}`, inline: true }, { name: '↕️ Sorted by', value: sorts[sort].label, inline: true });

  const embed = card({ kind: p === 0 && filter === 'all' ? 'armoury' : 'armouryAll', title: 'Armoury', emoji: '⚔️', body: head, fields, at: snap?.at });

  const filterMenu = new StringSelectMenuBuilder()
    .setCustomId(armId(userId, 0, filter, sort, 'filter'))
    .setPlaceholder('Filter')
    .addOptions(Object.entries(filters).map(([value, f]) => ({ label: f.label, value, default: value === filter })));
  const sortMenu = new StringSelectMenuBuilder()
    .setCustomId(armId(userId, 0, filter, sort, 'sort'))
    .setPlaceholder('Sort')
    .addOptions(Object.entries(sorts).map(([value, s]) => ({ label: `Sort by ${s.label}`, value, default: value === sort })));
  const nav = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(armId(userId, 0, filter, sort, 'first')).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder().setCustomId(armId(userId, p - 1, filter, sort, 'prev')).setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(p === 0),
    new ButtonBuilder().setCustomId(armId(userId, p, filter, sort, 'page')).setLabel(`${p + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(armId(userId, p + 1, filter, sort, 'next')).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(p >= pages - 1),
    new ButtonBuilder().setCustomId(armId(userId, pages - 1, filter, sort, 'last')).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1),
  );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(filterMenu),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sortMenu),
      nav,
    ],
  };
}
