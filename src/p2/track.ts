import { Events, type Client, type Message, type PartialMessage } from 'discord.js';
import type { Store } from '../db.js';
import { TYPES, idOf, nameIn, regionOf, typesOf } from '../features/pokedex.js';
import { report } from '../ops.js';

// Pokétwo's shiny hunt and personal Pokédex, read from Pokétwo's own replies. Texz never plays for anyone.
// Odds from Pokétwo's code: 1/4096, ×1.2 with a shiny charm, ×(1 + √chain / 7) on the hunted species.

export const P2_ID = '716390085896962058';
const baseOf = (name: string) => nameIn(name) ?? name.trim();

export function shinyChance(chain: number, charm = false) {
  return (1 / 4096) * (charm ? 1.2 : 1) * (1 + Math.sqrt(Math.max(0, chain)) / 7);
}
// chance of at least one shiny in the next n catches of the hunted pokémon, the chain growing as it goes
export function shinyWithin(chain: number, n: number, charm = false) {
  let miss = 1;
  for (let i = 0; i < n; i++) miss *= 1 - shinyChance(chain + i, charm);
  return 1 - miss;
}

export const REGIONS: [string, number, number][] = [
  ['Kanto', 1, 151], ['Johto', 152, 251], ['Hoenn', 252, 386], ['Sinnoh', 387, 493], ['Unova', 494, 649],
  ['Kalos', 650, 721], ['Alola', 722, 809], ['Galar', 810, 905], ['Paldea', 906, 1025],
];

export class P2State {
  constructor(private db: Store['db']) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS p2_hunt (user_id TEXT PRIMARY KEY, species TEXT, chain INTEGER NOT NULL DEFAULT 0, charm_until INTEGER, started INTEGER, at INTEGER NOT NULL, ping INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS p2_shinies (user_id TEXT NOT NULL, species TEXT NOT NULL, chain INTEGER, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS p2_dex (user_id TEXT NOT NULL, dex INTEGER NOT NULL, caught INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, dex));
      CREATE TABLE IF NOT EXISTS p2_dextotal (user_id TEXT PRIMARY KEY, caught INTEGER NOT NULL, total INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS p2_spawns (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, at INTEGER NOT NULL, name TEXT, caught_by TEXT);
      CREATE INDEX IF NOT EXISTS p2_spawns_guild ON p2_spawns (guild_id, at);
      CREATE TABLE IF NOT EXISTS p2_quests (user_id TEXT NOT NULL, src TEXT NOT NULL, n INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, progress INTEGER NOT NULL, goal INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, src, n));
    `);
  }
  hunt(userId: string) {
    return this.db.prepare('SELECT * FROM p2_hunt WHERE user_id = ?').get(userId) as { user_id: string; species: string | null; chain: number; charm_until: number | null; started: number | null; at: number; ping: number } | undefined;
  }
  setHunt(userId: string, species: string | null, chain: number, at = Date.now(), fresh = false) {
    const old = this.hunt(userId);
    const started = fresh || !old || old.species?.toLowerCase() !== species?.toLowerCase() ? at : old.started;
    this.db.prepare(`INSERT INTO p2_hunt (user_id, species, chain, started, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET species = excluded.species, chain = excluded.chain, started = excluded.started, at = excluded.at`).run(userId, species, chain, started, at);
  }
  setCharm(userId: string, until: number | null) { this.db.prepare('UPDATE p2_hunt SET charm_until = ? WHERE user_id = ?').run(until, userId); }
  setPing(userId: string, on: boolean) { this.db.prepare('UPDATE p2_hunt SET ping = ? WHERE user_id = ?').run(on ? 1 : 0, userId); }
  hunters(species: string) {
    return this.db.prepare('SELECT user_id FROM p2_hunt WHERE lower(species) = lower(?) AND ping = 1').all(species) as { user_id: string }[];
  }
  addShiny(userId: string, species: string, chain: number | null, at = Date.now()) {
    this.db.prepare('INSERT INTO p2_shinies (user_id, species, chain, at) VALUES (?, ?, ?, ?)').run(userId, species, chain, at);
  }
  shinies(userId: string) {
    return this.db.prepare('SELECT * FROM p2_shinies WHERE user_id = ? ORDER BY at DESC').all(userId) as { species: string; chain: number | null; at: number }[];
  }
  saveDex(userId: string, rows: { dex: number; caught: number }[], total: { caught: number; total: number } | null, at = Date.now()) {
    const up = this.db.prepare('INSERT INTO p2_dex (user_id, dex, caught, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, dex) DO UPDATE SET caught = excluded.caught, at = excluded.at');
    for (const r of rows) up.run(userId, r.dex, r.caught, at);
    if (total) this.db.prepare('INSERT INTO p2_dextotal (user_id, caught, total, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET caught = excluded.caught, total = excluded.total, at = excluded.at').run(userId, total.caught, total.total, at);
  }
  // a catch adds to the dex as it happens, so it stays right between looks at the dex
  caughtOne(userId: string, dex: number, at = Date.now()) {
    this.db.prepare('INSERT INTO p2_dex (user_id, dex, caught, at) VALUES (?, ?, 1, ?) ON CONFLICT (user_id, dex) DO UPDATE SET caught = caught + 1').run(userId, dex, at);
  }
  dex(userId: string) {
    return this.db.prepare('SELECT dex, caught, at FROM p2_dex WHERE user_id = ?').all(userId) as { dex: number; caught: number; at: number }[];
  }
  // quests read off the quests page or the event page; a fresh read replaces that page's list
  saveQuests(userId: string, src: string, list: Quest[], at = Date.now()) {
    this.db.prepare('DELETE FROM p2_quests WHERE user_id = ? AND src = ?').run(userId, src);
    const add = this.db.prepare('INSERT INTO p2_quests (user_id, src, n, kind, key, progress, goal, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    list.forEach((q, n) => add.run(userId, src, n, q.kind, q.key, q.progress, q.goal, at));
  }
  // event quests go stale once the event is over, so they count for two weeks after the last look
  quests(userId: string, now = Date.now()) {
    return this.db.prepare(`SELECT src, kind, key, progress, goal FROM p2_quests WHERE user_id = ? AND progress < goal AND (src = 'q' OR at > ?) ORDER BY progress * 1.0 / goal DESC`).all(userId, now - 14 * 864e5) as unknown as (Quest & { src: string })[];
  }
  questCatch(userId: string, types: string[], region: string | null) {
    const ph = types.map(() => '?').join(',') || "''";
    this.db.prepare(`UPDATE p2_quests SET progress = progress + 1 WHERE user_id = ? AND progress < goal AND ((kind = 'type' AND key IN (${ph})) OR (kind = 'region' AND key = ?))`).run(userId, ...types, region ?? '');
  }
  // who has an open quest this spawn helps, pings switched on
  questers(types: string[], region: string | null, now = Date.now()) {
    const ph = types.map(() => '?').join(',') || "''";
    return (this.db.prepare(`SELECT DISTINCT user_id FROM p2_quests WHERE progress < goal AND (src = 'q' OR at > ?) AND ((kind = 'type' AND key IN (${ph})) OR (kind = 'region' AND key = ?))`).all(now - 14 * 864e5, ...types, region ?? '') as { user_id: string }[]).map((r) => r.user_id);
  }
  // every spawn here, named once it's known and marked when someone catches it
  spawned(id: string, guild: string, at = Date.now()) { this.db.prepare('INSERT OR IGNORE INTO p2_spawns (id, guild_id, at) VALUES (?, ?, ?)').run(id, guild, at); }
  spawnName(id: string, name: string) { this.db.prepare('UPDATE p2_spawns SET name = ? WHERE id = ?').run(name, id); }
  spawnCaught(id: string, name: string, user: string) { this.db.prepare('UPDATE p2_spawns SET name = ?, caught_by = ? WHERE id = ?').run(name, user, id); }
  spawnsSince(guild: string, since: number) {
    return this.db.prepare('SELECT at, name, caught_by FROM p2_spawns WHERE guild_id = ? AND at >= ? ORDER BY at').all(guild, since) as { at: number; name: string | null; caught_by: string | null }[];
  }
  dexTotal(userId: string) {
    return this.db.prepare('SELECT * FROM p2_dextotal WHERE user_id = ?').get(userId) as { caught: number; total: number; at: number } | undefined;
  }
}

export type Quest = { kind: 'type' | 'region'; key: string; progress: number; goal: number };

// ---------- reading Pokétwo ----------

type Said = { content: string; embeds: { title: string | null; description: string | null; fields: { name: string; value: string }[]; footer: string | null }[] };
export const saidOf = (m: Message | PartialMessage): Said => ({
  content: m.content ?? '',
  embeds: m.embeds.map((e) => ({ title: e.title, description: e.description, fields: e.fields.map((f) => ({ name: f.name, value: f.value })), footer: e.footer?.text ?? null })),
});

// "+1 Shiny chain! (**4**)" after a catch, or "Shiny streak reset. (**312**)" when the shiny came
export function chainLine(s: Said) {
  const m = /shiny (chain|streak reset)[^(]*\(\**(\d+)\**\)/i.exec(s.content);
  return m ? { reset: /reset/i.test(m[1]), chain: Number(m[2]) } : null;
}

// the shinyhunt page, asked with nothing after it
export function huntCard(s: Said) {
  const e = s.embeds.find((x) => /^Shiny Hunt/i.test(x.title ?? ''));
  if (!e) return null;
  const cur = e.fields.find((f) => /Currently Hunting/i.test(f.name))?.value ?? '';
  const chain = Number(e.fields.find((f) => /^Chain/i.test(f.name))?.value ?? 0);
  const species = /shinyhunt <pok/i.test(cur) ? null : nameIn(cur) ?? (cur.trim() || null);
  const charm = /shiny charm active that expires in (.+)\./i.exec(e.footer ?? '')?.[1] ?? null;
  return { species, chain, charm };
}

// "1 week, 2 days and 3 hours" into milliseconds
export function spanOf(text: string) {
  const unit: Record<string, number> = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  let ms = 0;
  for (const m of text.matchAll(/([\d.]+)\s*(second|minute|hour|day|week|month|year)s?/gi)) ms += Number(m[1]) * unit[m[2].toLowerCase()];
  return ms;
}

// a page of the pokedex: "Bulbasaur #1" → "✅ 3 caught!" or "Not caught yet!"
export function dexPage(s: Said) {
  const e = s.embeds.find((x) => /^Your pok[ée]dex/i.test(x.title ?? ''));
  if (!e) return null;
  const t = /caught ([\d,]+) out of ([\d,]+)/i.exec(e.description ?? '');
  const rows: { dex: number; caught: number }[] = [];
  for (const f of e.fields) {
    const id = /#(\d+)\s*$/.exec(f.name.trim());
    if (!id) continue;
    const n = /(\d[\d,]*) caught/i.exec(f.value);
    rows.push({ dex: Number(id[1]), caught: n ? Number(n[1].replace(/,/g, '')) : 0 });
  }
  return { rows, total: t ? { caught: Number(t[1].replace(/,/g, '')), total: Number(t[2].replace(/,/g, '')) } : null };
}

// the quests page and the event task list: "Catch 50 pokémon originally found in the Kanto region" with `12/50`,
// or "Catch 5 <:Fire:…> Fire-type pokémon `2/5`". Only type and region quests, the rest no spawn ping can help with.
const REGION_NAMES = REGIONS.map(([r]) => r);
export function questsOf(s: Said): { src: string; list: Quest[] } | null {
  const e = s.embeds.find((x) => /quests?|tasks?/i.test(`${x.title ?? ''} ${x.description ?? ''}`) && /catch\s+[\d,]+/i.test([x.description, ...x.fields.flatMap((f) => [f.name, f.value])].join('\n')));
  if (!e) return null;
  const bits = [...(e.description ?? '').split('\n'), ...e.fields.map((f) => `${f.name} ${f.value}`)];
  const list: Quest[] = [];
  for (const raw of bits) {
    const t = raw.replace(/<a?:\w+:\d+>/g, ' ').replace(/[*_]/g, '');
    const m = /catch\s+([\d,]+)\s+(.+?)`\s*([\d,]+)\s*\/\s*([\d,]+)\s*`/i.exec(t);
    if (!m) continue;
    const goal = Number(m[4].replace(/,/g, ''));
    const progress = Math.min(goal, Number(m[3].replace(/,/g, '')));
    const type = TYPES.find((x) => new RegExp(`\\b${x}-type`, 'i').test(m[2]));
    const region = REGION_NAMES.find((x) => new RegExp(`\\b${x}\\s+region`, 'i').test(m[2]));
    if (type) list.push({ kind: 'type', key: type, progress, goal });
    else if (region) list.push({ kind: 'region', key: region, progress, goal });
  }
  return { src: /^quests$/i.test((e.title ?? '').trim()) ? 'q' : 'ev', list };
}

// ---------- who a reply is for ----------

const asked = new Map<string, { userId: string; at: number }>();
const owners = new Map<string, string>();
// Pokétwo only answers a mention now, with any of its aliases
const P2_CMD = new RegExp(`^<@!?${P2_ID}>\\s*(sh|shinyhunt|d|dex|pokedex|q|quests|ev|event)\\b`, 'i');

async function apply(store: Store, m: Message | PartialMessage) {
  const st = new P2State(store.db);
  const s = saidOf(m);
  const catcher = /congratulations <@!?(\d+)>/i.exec(s.content)?.[1];
  // a catch: the chain goes up, or a shiny lands and it resets
  if (catcher && /you caught a/i.test(s.content)) {
    const name = /you caught a (?:level|lvl\.?)\s*\d+\s+(.+?)(?=\s*(?:[♂♀⚲❔?!(]|$))/i.exec(s.content)?.[1] ?? null;
    const base = name ? baseOf(name.replace(/^✨\s*/, '')) : null;
    const dexId = base ? idOf(base) : null;
    if (dexId) st.caughtOne(catcher, dexId);
    if (base) st.questCatch(catcher, typesOf(base), regionOf(name!.replace(/^✨\s*/, '')));
    const c = chainLine(s);
    if (c && base) {
      if (c.reset) { st.addShiny(catcher, base, c.chain); st.setHunt(catcher, base, 0, Date.now(), true); }
      else st.setHunt(catcher, base, c.chain);
    } else if (base && /these colors seem unusual|✨/i.test(s.content)) st.addShiny(catcher, base, null);
    return;
  }
  const userId = m.interactionMetadata?.user?.id ?? owners.get(m.id) ?? (() => {
    const a = asked.get(m.channelId);
    return a && Date.now() - a.at < 30_000 ? a.userId : undefined;
  })();
  if (!userId) return;
  owners.set(m.id, userId);
  if (owners.size > 500) owners.delete(owners.keys().next().value!);
  const started = /you are now shiny hunting \*\*(.+?)\*\*/i.exec(s.content);
  if (started) { st.setHunt(userId, baseOf(started[1]), 0, Date.now(), true); return; }
  const h = huntCard(s);
  if (h) {
    st.setHunt(userId, h.species, h.chain);
    st.setCharm(userId, h.charm ? Date.now() + spanOf(h.charm) : null);
    return;
  }
  const d = dexPage(s);
  if (d) { st.saveDex(userId, d.rows, d.total); return; }
  const q = questsOf(s);
  // an event page with no catch tasks on it (inventory, shop) says nothing about the quests
  if (q && (q.list.length || q.src === 'q')) st.saveQuests(userId, q.src, q.list);
}

export function watchPoketwo(client: Client, store: Store) {
  new P2State(store.db);
  client.on(Events.MessageCreate, (m) => {
    if (!m.guildId) return;
    if (m.author.id === P2_ID) return void apply(store, m).catch((e) => report('p2 read', e));
    if (!m.author.bot && P2_CMD.test(m.content.trim())) asked.set(m.channelId, { userId: m.author.id, at: Date.now() });
  });
  // dex pages flip by editing the same message
  client.on(Events.MessageUpdate, (_o, m) => {
    if (m.author?.id === P2_ID && owners.has(m.id)) void apply(store, m).catch((e) => report('p2 read', e));
  });
}
