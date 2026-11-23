import type { Client } from 'discord.js';
import type { Store } from './db.js';
import { dmOwner, isOffline } from './ops.js';

// Texz reads other bots and sites; when one of them changes and a reader quietly stops working, the owner hears about it once

type Finding = { key: string; broken: boolean; text: string };

const H = 3600_000;

export function findings(store: Store, guildIds: string[], now = Date.now()): Finding[] {
  const out: Finding[] = [];
  const db = store.db;
  for (const g of guildIds) {
    const spawns = db.prepare('SELECT COUNT(*) AS n FROM p2_spawns WHERE guild_id = ? AND at >= ?').get(g, now - 12 * H) as { n: number };
    const catches = db.prepare('SELECT COUNT(*) AS n FROM catches WHERE guild_id = ? AND at >= ?').get(g, now - 12 * H) as { n: number };
    const lastSpawn = Number(store.getKv(`spawnseen:${g}:p2`) ?? 0);
    const lastCatch = (db.prepare('SELECT MAX(at) AS at FROM catches WHERE guild_id = ?').get(g) as { at: number | null }).at ?? 0;
    // people are catching but no spawn has been recognised for hours: Pokétwo changed its spawn message
    out.push({ key: `spawn:${g}`, broken: now - lastCatch < 3 * H && now - lastSpawn > 6 * H, text: 'Pokétwo spawns aren\'t being recognised, catches are still coming in.' });
    // plenty of spawns and not one catch read: Pokétwo changed its catch message
    out.push({ key: `catch:${g}`, broken: spawns.n >= 40 && catches.n === 0, text: `${spawns.n} Pokétwo spawns in 12 hours and no catch read.` });
  }
  for (const site of ['anilist', 'mal'] as const) {
    const r = db.prepare('SELECT COUNT(*) AS n, MAX(synced_at) AS at FROM anime_links WHERE site = ? AND synced_at IS NOT NULL').get(site) as { n: number; at: number | null };
    out.push({ key: `sync:${site}`, broken: r.n > 0 && now - (r.at ?? 0) > 9 * H, text: `${site === 'anilist' ? 'AniList' : 'MyAnimeList'} sync hasn't worked since <t:${Math.floor((r.at ?? 0) / 1000)}:R>.` });
  }
  return out;
}

async function run(client: Client, store: Store) {
  if (!client.isReady() || isOffline()) return;
  const ids = [...client.guilds.cache.keys()].filter((g) => store.rules(g, 'spawns').enabled);
  for (const f of findings(store, ids)) {
    const k = `check:${f.key}`;
    const was = store.getKv(k);
    const label = f.key.startsWith('spawn') || f.key.startsWith('catch') ? `${client.guilds.cache.get(f.key.split(':')[1])?.name ?? 'a server'}: ` : '';
    if (f.broken && (!was || Date.now() - Number(was) > 24 * H)) {
      store.setKv(k, String(Date.now()));
      await dmOwner(`🛠️ ${label}${f.text}`);
    } else if (!f.broken && was && was !== '0') {
      store.setKv(k, '0');
      await dmOwner(`✅ ${label}${f.key.startsWith('sync') ? 'List sync' : 'Pokétwo reader'} is working again.`);
    }
  }
}

export function startChecks(client: Client, store: Store) {
  setTimeout(() => void run(client, store).catch(() => {}), 10 * 60_000).unref?.();
  setInterval(() => void run(client, store).catch(() => {}), 30 * 60_000).unref?.();
}
