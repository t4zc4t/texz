import type { Client } from 'discord.js';
import type { Store } from '../db.js';
import { report } from '../ops.js';
import { card } from '../theme.js';
import { weaponOf } from './catalog.js';
import { OwoState } from './state.js';

// Once a day Texz asks for a handful of OwO commands that fill the biggest gaps in what it knows,
// posted to the staff channel for the server owner. Never more than five, and nothing when nothing's missing.

const DAY = 86_400_000;
export interface Order { cmd: string; why: string }

export function ordersFor(st: OwoState, userId: string, now = Date.now()): Order[] {
  const out: Order[] = [];
  const stats = st.sampleStats();
  const today = Math.floor(now / DAY) * DAY;
  if (stats.shopAt < today) out.push({ cmd: 'w shop weapon, then flip all 10 pages', why: 'every page is a weapon with exact numbers, it teaches the ranges' });

  // weapons of a kind Texz has barely seen, ones you own but haven't opened
  const weapons = st.weapons(userId);
  const name = (w: (typeof weapons)[number]) => w.name ?? (w.type ? weaponOf(w.type).name : '?');
  const thin = weapons.filter((w) => !w.detailed && (stats.per.get(name(w)) ?? 0) < 6)
    .sort((a, b) => (stats.per.get(name(a)) ?? 0) - (stats.per.get(name(b)) ?? 0) || (b.quality ?? 0) - (a.quality ?? 0));
  const seen = new Set<string>();
  for (const w of thin) {
    if (seen.has(name(w)) || seen.size >= 2) continue;
    seen.add(name(w));
    out.push({ cmd: `w w ${w.id}`, why: `only ${stats.per.get(name(w)) ?? 0} ${name(w)}${(stats.per.get(name(w)) ?? 0) === 1 ? '' : 's'} seen in full so far` });
  }

  const pets = st.pets(userId);
  const missing = pets.filter((p) => !st.dex(p.animal)).sort((a, b) => b.level - a.level);
  if (missing.length) out.push({ cmd: `w dex ${missing[0].animal}`, why: 'its base stats let the team helper judge it fairly, whatever its level' });

  const teams = st.teams(userId);
  const newest = (list: { at: number }[]) => list.reduce((m, x) => Math.max(m, x.at), 0);
  if (now - newest(teams) > 3 * DAY) out.push({ cmd: 'w team, and flip to every team', why: 'your team has changed since I last looked, probably' });
  if (now - newest(pets) > 7 * DAY) out.push({ cmd: 'w pets', why: 'levels move every day, this keeps them current' });
  if (now - weapons.reduce((m, w) => Math.max(m, w.seenAt), 0) > 7 * DAY) out.push({ cmd: 'w weapon, and flip every page once', why: 'catches new weapons and ones you dismantled' });
  const hb = st.huntbot(userId);
  if (!hb || now - hb.at > 3 * DAY) out.push({ cmd: 'w hb', why: 'HuntBot levels and essence for the upgrade advice' });
  const zoo = st.zoo(userId);
  if (!zoo || now - zoo.at > 7 * DAY) out.push({ cmd: 'w zoo', why: 'what you can sell or sacrifice' });
  return out.slice(0, 5);
}

async function post(client: Client, store: Store) {
  const now = new Date();
  // around 14:30 UTC, once a day
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < 14 * 60 + 30) return;
  const day = now.toISOString().slice(0, 10);
  const st = new OwoState(store.db);
  for (const guild of client.guilds.cache.values()) {
    if (!store.rules(guild.id, 'owo').enabled || store.getKv(`owo:orders:${guild.id}`) === day) continue;
    const ch = store.guild(guild.id).mod.logChannel;
    if (!ch) continue;
    store.setKv(`owo:orders:${guild.id}`, day);
    const owner = guild.ownerId;
    // only for someone Texz has already learnt something about
    if (!st.teams(owner).length && !st.weapons(owner).length) continue;
    const orders = ordersFor(st, owner);
    if (!orders.length) continue;
    const room = await guild.channels.fetch(ch).catch(() => null);
    if (!room?.isSendable()) continue;
    await room.send({
      content: `<@${owner}>`,
      embeds: [card({
        kind: 'help', title: 'Executive orders · OwO', emoji: '📋', gif: 'off', line: '',
        body: `A few minutes of OwO today makes the advice sharper:\n\n${orders.map((o, i) => `**${i + 1}.** \`${o.cmd}\`\n-# ${o.why}`).join('\n')}`,
      }).setFooter({ text: 'Just run them in your OwO channel, I read the replies myself' })],
      allowedMentions: { users: [owner] },
    }).catch(() => {});
  }
}

export function startOrders(client: Client, store: Store) {
  setInterval(() => void post(client, store).catch((e) => report('owo orders', e)), 10 * 60_000);
}
