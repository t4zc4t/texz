import { ChannelType, ThreadAutoArchiveDuration, type CategoryChannel, type Guild, type GuildBasedChannel, type TextChannel, type ThreadChannel } from 'discord.js';
import type { Store } from '../db.js';
import { confessIntro } from '../modules/community.js';
import { report } from '../ops.js';
import { card } from '../theme.js';

// the confessional as a thread under the office, made once and kept
export async function confessThread(store: Store, guild: Guild, office: TextChannel): Promise<ThreadChannel> {
  const saved = store.getKv(`confessch:${guild.id}`);
  const had = saved ? await guild.channels.fetch(saved).catch(() => null) : null;
  if (had?.isThread() && had.parentId === office.id) {
    if (had.archived) await had.setArchived(false).catch(() => {});
    return had;
  }
  const t = await office.threads.create({ name: '🕯️┃midnight-confessions', autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, reason: 'the confessional moves into the office' });
  await t.send(confessIntro()).then((m) => m.pin().catch(() => {})).catch(() => {});
  store.setKv(`confessch:${guild.id}`, t.id);
  return t;
}

const ARCHIVE = '🗄️ Closed Case Files';

// rooms nobody uses go to a hidden category instead of being deleted
async function archive(store: Store, guild: Guild) {
  const id = store.getKv(`floor:${guild.id}:closed`);
  let cat = id ? guild.channels.cache.get(id) as CategoryChannel | undefined : undefined;
  cat ??= guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE) as CategoryChannel | undefined;
  cat ??= await guild.channels.create({ name: ARCHIVE, type: ChannelType.GuildCategory, reason: 'closed rooms, kept but hidden' });
  await cat.permissionOverwrites.set([{ id: guild.roles.everyone.id, deny: ['ViewChannel'] }, { id: guild.members.me!.id, allow: ['ViewChannel', 'ManageChannels'] }]).catch(() => {});
  store.setKv(`floor:${guild.id}:closed`, cat.id);
  // last of all the categories
  await cat.setPosition(guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size).catch(() => {});
  return cat;
}

async function close(cat: CategoryChannel, c: GuildBasedChannel | undefined, note: string | null) {
  if (!c || c.parentId === cat.id) return false;
  if (note && c.isSendable()) await c.send({ embeds: [card({ kind: 'bulletin', title: '📁 Case closed', emoji: '', gif: 'off', line: '', body: note })] }).catch(() => {});
  if (!('setParent' in c)) return false;
  await c.setParent(cat.id, { lockPermissions: true, reason: 'merged into another room' }).catch((e) => report('close room', e));
  return true;
}

// once per server: yen and Shoob move into the den, ranks into the rules, confessions into an office thread,
// the late voice room goes; every Texz setting that pointed at a closed room points at its new home
export async function closeCases(store: Store, guild: Guild) {
  if (!store.getKv(`floor:${guild.id}:bar`) || store.getKv(`tidy:v1:${guild.id}`)) return null;
  await guild.channels.fetch().catch(() => null);
  const find = (kv: string | null, re: RegExp) => (kv ? guild.channels.cache.get(kv) : undefined) ?? guild.channels.cache.find((c) => re.test(c.name));
  const den = find(store.getKv(`dench:${guild.id}:owo`), /stray-dogs-den/);
  const office = find(store.getKv(`generalch:${guild.id}`), /agency-office/) as TextChannel | undefined;
  const rules = find(store.getKv(`rulesch:${guild.id}`), /agency-rules/);
  if (!den || !office || !rules) return null;
  const yen = find(store.rules(guild.id, 'economy').channels[0] ?? null, /the-yen-counter/);
  const cards = find(store.getKv(`dench:${guild.id}:shoob`), /card-vault/);
  const ranks = find(store.getKv(`ranksch:${guild.id}`), /ranks-and-perks/);
  const confess = find(store.getKv(`confessch:${guild.id}`), /midnight-confessions/);
  const night = guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && /Late Night Shift/i.test(c.name));

  // every setting and saved id that named a closed room now names its new home
  const moves = new Map<string, string>();
  if (yen && yen.id !== den.id) moves.set(yen.id, den.id);
  if (cards && cards.id !== den.id) moves.set(cards.id, den.id);
  if (ranks && ranks.id !== rules.id) moves.set(ranks.id, rules.id);
  const thread = await confessThread(store, guild, office);
  if (confess && !confess.isThread()) moves.set(confess.id, thread.id);
  let json = JSON.stringify(store.guild(guild.id));
  for (const [a, b] of moves) json = json.split(a).join(b);
  store.saveGuild(guild.id, JSON.parse(json));
  for (const r of store.db.prepare('SELECT key, value FROM kv WHERE key LIKE ?').all(`%${guild.id}%`) as { key: string; value: string }[]) {
    if (moves.has(r.value)) store.setKv(r.key, moves.get(r.value)!);
  }
  store.setKv(`dench:${guild.id}:shoob`, den.id);
  store.setKv(`ranksch:${guild.id}`, null);
  // the ranks card goes up in the rules room, kept in place from now on
  const { ranksView } = await import('./layout.js');
  if (rules.isSendable()) {
    const sent = await rules.send(ranksView(store, guild, store.getKv(`rolesch:${guild.id}`) ?? rules.id, store.getKv(`boostch:${guild.id}`) ?? rules.id, den.id)).catch(() => null);
    if (sent) store.setKv(`ranksmsg:${guild.id}`, sent.id);
  }
  if ('setTopic' in den) await (den as TextChannel).setTopic('OwO, Shoob, yen and Texz games. Every bot game in one den.').catch(() => {});

  const cat = await archive(store, guild);
  const closed: string[] = [];
  if (yen && moves.has(yen.id) && await close(cat, yen, `Yen moved to <#${den.id}>.`)) closed.push(yen.name);
  if (cards && moves.has(cards.id) && await close(cat, cards, `Shoob drops moved to <#${den.id}>.`)) closed.push(cards.name);
  if (ranks && moves.has(ranks.id) && await close(cat, ranks, `Ranks and perks moved to <#${rules.id}>.`)) closed.push(ranks.name);
  if (confess && moves.has(confess.id) && await close(cat, confess, `Confessions moved to <#${thread.id}>.`)) closed.push(confess.name);
  if (night && await close(cat, night, null)) closed.push(night.name);
  store.setKv(`tidy:v1:${guild.id}`, String(Date.now()));
  return { closed, den: den.id, rules: rules.id, thread: thread.id };
}
