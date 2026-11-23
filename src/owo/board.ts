import type { Client, Guild } from 'discord.js';
import type { Store } from '../db.js';
import { report } from '../ops.js';
import { card } from '../theme.js';
import { RANK_ORDER } from './catalog.js';
import { OwoState, weekOf } from './state.js';

const medal = ['🥇', '🥈', '🥉', '4.', '5.'];

// the week's OwO in one server: top hunters, rarest catches, best streaks, luckiest hunters
export async function boardFor(store: Store, guild: Guild, week = weekOf()) {
  const st = new OwoState(store.db);
  const from = Date.parse(`${week}T00:00:00Z`);
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const here = (id: string) => members.has(id);
  const rows = st.week(week).filter((r) => here(r.user_id));
  const fields: { name: string; value: string; inline: boolean }[] = [];
  const top = [...rows].sort((a, b) => b.hunts - a.hunts).slice(0, 5);
  if (top.length) fields.push({ name: '🏹 Hunters', value: top.map((r, i) => `${medal[i]} <@${r.user_id}> · **${r.hunts.toLocaleString()}** hunts`).join('\n'), inline: false });
  const rank = (r: string | null) => (r && RANK_ORDER.includes(r) ? RANK_ORDER.indexOf(r) : -1);
  const rare = st.catchesSince(from).filter((c) => here(c.user_id) && c.rank).sort((a, b) => rank(b.rank) - rank(a.rank) || a.at - b.at).slice(0, 5);
  if (rare.length) fields.push({ name: '✨ Rarest catches', value: rare.map((c) => `**${c.rank}** ${c.animal} · <@${c.user_id}>`).join('\n'), inline: false });
  const streaks = st.bestStreaks(from).filter((r) => here(r.user_id)).sort((a, b) => b.streak - a.streak).slice(0, 5);
  if (streaks.length) fields.push({ name: '🔥 Streaks', value: streaks.map((r, i) => `${medal[i]} <@${r.user_id}> · **${r.streak}**`).join('\n'), inline: false });
  // luck needs enough animals to mean anything
  const luck = rows.filter((r) => r.animals >= 300).map((r) => ({ ...r, per: (r.rare / r.animals) * 1000 })).sort((a, b) => b.per - a.per).slice(0, 3);
  if (luck.length) fields.push({ name: '🍀 Luckiest', value: luck.map((r, i) => `${medal[i]} <@${r.user_id}> · ${r.per.toFixed(1)} epic+ per 1k`).join('\n'), inline: false });
  return card({ kind: 'help', title: `The Den's week · ${new Date(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`, emoji: '🐾', gif: 'off', line: '', body: fields.length ? '' : 'Nothing logged this week.', fields });
}

// where the board goes: the OwO channel picked in /setup, else the den by name
function boardChannel(store: Store, guild: Guild) {
  const set = store.rules(guild.id, 'owo').channels[0];
  return set ?? guild.channels.cache.find((c) => c.isTextBased() && /stray-dogs-den/.test(c.name))?.id ?? null;
}

// Sunday evening UTC, the week that's ending
export function startBoard(client: Client, store: Store) {
  const tick = async () => {
    const d = new Date();
    if (d.getUTCDay() !== 0 || d.getUTCHours() < 16) return;
    for (const guild of client.guilds.cache.values()) {
      if (!store.rules(guild.id, 'owo').enabled) continue;
      const week = weekOf(d.getTime());
      if (!store.firstTime(guild.id, `owo:board:${week}`)) continue;
      const id = boardChannel(store, guild);
      const ch = id ? await client.channels.fetch(id).catch(() => null) : null;
      if (!ch?.isSendable()) continue;
      const e = await boardFor(store, guild, week);
      if (!e.data.fields?.length) continue;
      await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch((err) => report('owo board', err));
    }
  };
  setInterval(() => void tick().catch((e) => report('owo board', e)), 30 * 60_000).unref?.();
}
