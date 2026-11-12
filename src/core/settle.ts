import type { Client, Guild } from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { allModules } from '../modules/core.js';
import { report } from '../ops.js';
import { dropAnimeRoles } from '../modules/bulletins.js';
import { botAccess } from '../features/layout.js';

// the home server keeps everything on, every other server starts with everything off until an admin switches things on
export const isHome = (guild: Guild) => /nyx\s*elysium/i.test(guild.name);

// the home server keeps exactly what it has now, written down so later default changes can't move it
function setAll(store: Store, guild: Guild, home: boolean) {
  const g = store.guild(guild.id);
  for (const m of allModules) if (!m.locked) g.modules[m.name] = { ...defaultRules(m.name), ...g.modules[m.name], enabled: home ? store.rules(guild.id, m.name).enabled : false };
  store.saveGuild(guild.id, g);
}

// a server Texz meets for the first time, on start or when it's added
export function settleGuild(store: Store, guild: Guild) {
  if (store.getKv(`settled:${guild.id}`)) return fillNew(store, guild);
  setAll(store, guild, isHome(guild));
  store.setKv(`settled:${guild.id}`, String(Date.now()));
  console.log(`${guild.name}: features ${isHome(guild) ? 'kept as they are' : 'off until an admin turns them on'}`);
}

// features added later start off in servers that started quiet, and on in the home server
function fillNew(store: Store, guild: Guild) {
  const g = store.guild(guild.id);
  const missing = allModules.filter((m) => !m.locked && !g.modules[m.name]);
  if (!missing.length) return;
  for (const m of missing) g.modules[m.name] = { ...defaultRules(m.name), enabled: isHome(guild) };
  store.saveGuild(guild.id, g);
}

// data from before servers kept their own copies belongs to the home server
function splitOld(store: Store, home: Guild) {
  if (store.getKv('split:done')) return;
  let moved = 0;
  for (const { key, value } of store.kvByPrefix('picks:')) {
    const parts = key.split(':');
    if (parts.length !== 2) continue;
    const user = parts[1];
    const old = store.profile(user);
    const now = `picks:${home.id}:${user}`;
    if (!store.getKv(now)) store.setKv(now, JSON.stringify({ ...(old.favourite ? { anime: old.favourite } : {}), ...(old.bio ? { bio: old.bio } : {}), ...JSON.parse(value) }));
    store.setKv(key, null);
    store.setProfile(user, { bio: null, favourite: null });
    moved++;
  }
  for (const { key, value } of store.kvByPrefix('shoobwish:')) {
    const parts = key.split(':');
    if (parts.length !== 2) continue;
    store.setKv(`shoobwish:${home.id}:${parts[1]}`, value);
    store.setKv(key, null);
    moved++;
  }
  for (const b of store.birthdays()) {
    if (!store.kvByPrefix('bdayin:').some(({ key }) => key.endsWith(`:${b.user_id}`))) { store.setKv(`bdayin:${home.id}:${b.user_id}`, '1'); moved++; }
  }
  store.setKv('split:done', String(Date.now()));
  console.log(`per server data: ${moved} old entries filed under ${home.name}`);
}

export function settleAll(client: Client, store: Store) {
  try {
    const home = client.guilds.cache.find(isHome);
    if (home) splitOld(store, home);
    for (const guild of client.guilds.cache.values()) {
      settleGuild(store, guild);
      void dropAnimeRoles(store, guild).catch((e) => report('anime roles', e));
      void botAccess(store, guild).then((n) => n && console.log(`${guild.name}: bots can see ${n} more rooms`)).catch((e) => report('bot access', e));
    }
  } catch (e) {
    report('settle servers', e);
  }
}
