import type { DatabaseSync } from 'node:sqlite';
import type { Battle, Dex, Reroll, RollSide, Huntbot, ListedWeapon, PetRow, Team, Wallpaper, WeaponCard, Zoo } from './read.js';

// What Texz knows about someone's OwO account, learnt from OwO's own replies. OwO accounts are the
// same in every server, so this is per person, not per server. Nothing is ever wiped because it wasn't
// seen: a weapon only goes when a full sweep of the weapon list no longer has it.

const tables = new WeakSet<DatabaseSync>();
function ready(db: DatabaseSync) {
  if (tables.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS owo_pets (
      user_id TEXT NOT NULL, animal TEXT NOT NULL, name TEXT, level INTEGER, xp INTEGER, xp_need INTEGER,
      hp INTEGER, wp INTEGER, str INTEGER, mag INTEGER, pr INTEGER, mr INTEGER, weapon_id TEXT, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, animal)
    );
    CREATE TABLE IF NOT EXISTS owo_teams (
      user_id TEXT NOT NULL, team INTEGER NOT NULL, name TEXT, animals TEXT NOT NULL, streak INTEGER, best INTEGER, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, team)
    );
    CREATE TABLE IF NOT EXISTS owo_weapons (
      user_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT, rarity TEXT, name TEXT, quality REAL, wear TEXT, empowered INTEGER DEFAULT 0,
      favourite INTEGER DEFAULT 0, kills INTEGER, on_animal TEXT, wp_cost INTEGER, rolls TEXT, passives TEXT, passive_icons TEXT,
      reroll_changes INTEGER, reroll_attempts INTEGER, detailed INTEGER DEFAULT 0, seen_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS owo_zoo (user_id TEXT PRIMARY KEY, animals TEXT NOT NULL, points INTEGER, caught TEXT, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owo_huntbot (user_id TEXT PRIMARY KEY, traits TEXT NOT NULL, essence INTEGER, max_run TEXT, back_at INTEGER, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owo_bits (user_id TEXT NOT NULL, what TEXT NOT NULL, value TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, what));
    CREATE TABLE IF NOT EXISTS owo_battles (user_id TEXT NOT NULL, at INTEGER NOT NULL, result TEXT NOT NULL, turns INTEGER, xp INTEGER, streak INTEGER);
    CREATE TABLE IF NOT EXISTS owo_dex (
      animal TEXT PRIMARY KEY, rank TEXT, hp INTEGER, str INTEGER, pr INTEGER, wp INTEGER, mag INTEGER, mr INTEGER,
      points INTEGER, sell INTEGER, essence INTEGER, aliases TEXT, at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS owo_samples (
      key TEXT PRIMARY KEY, weapon TEXT NOT NULL, rarity TEXT, quality REAL, wear TEXT, wp_cost INTEGER, rolls TEXT, passives TEXT, source TEXT, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS owo_battles_user ON owo_battles (user_id, at);
    CREATE TABLE IF NOT EXISTS owo_catches (user_id TEXT NOT NULL, at INTEGER NOT NULL, animal TEXT NOT NULL, rank TEXT, source TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS owo_catches_user ON owo_catches (user_id, at);
    CREATE TABLE IF NOT EXISTS owo_tally (user_id TEXT NOT NULL, source TEXT NOT NULL, rank TEXT NOT NULL, n INTEGER NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (user_id, source, rank));
    CREATE TABLE IF NOT EXISTS owo_emoji (name TEXT PRIMARY KEY, id TEXT NOT NULL, animated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owo_walls (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER, url TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owo_wall_owned (user_id TEXT NOT NULL, id INTEGER NOT NULL, equipped INTEGER DEFAULT 0, PRIMARY KEY (user_id, id));
  `);
  tables.add(db);
  return db;
}

export class OwoState {
  constructor(private raw: DatabaseSync) {}
  private get db() { return ready(this.raw); }

  // ---------- writes ----------

  saveTeam(userId: string, t: Team, now = Date.now()) {
    const db = this.db;
    db.prepare(`INSERT INTO owo_teams (user_id, team, name, animals, streak, best, at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, team) DO UPDATE SET name = excluded.name, animals = excluded.animals, streak = excluded.streak, best = excluded.best, at = excluded.at`)
      .run(userId, t.page, t.name, JSON.stringify(t.pets.map((p) => p.animal)), t.streak, t.best, now);
    for (const p of t.pets) {
      db.prepare(`INSERT INTO owo_pets (user_id, animal, name, level, xp, xp_need, hp, wp, str, mag, pr, mr, weapon_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, animal) DO UPDATE SET name = excluded.name, level = excluded.level, xp = excluded.xp, xp_need = excluded.xp_need, hp = excluded.hp,
        wp = excluded.wp, str = excluded.str, mag = excluded.mag, pr = excluded.pr, mr = excluded.mr, weapon_id = excluded.weapon_id, at = excluded.at`)
        .run(userId, p.animal, p.name, p.level, p.xp, p.xpNeed, p.hp, p.wp, p.str, p.mag, p.pr, p.mr, p.weapon?.id ?? null, now);
      if (p.weapon) {
        // a weapon can only be on one pet, and a pet holds one weapon
        db.prepare('UPDATE owo_weapons SET on_animal = NULL WHERE user_id = ? AND on_animal = ? AND id != ?').run(userId, p.animal, p.weapon.id);
        db.prepare(`INSERT INTO owo_weapons (user_id, id, type, rarity, quality, passive_icons, on_animal, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, id) DO UPDATE SET type = excluded.type, rarity = excluded.rarity, quality = excluded.quality,
          passive_icons = excluded.passive_icons, on_animal = excluded.on_animal, seen_at = excluded.seen_at`)
          .run(userId, p.weapon.id, p.weapon.type, p.weapon.rarity, p.weapon.quality, JSON.stringify(p.weapon.passives), p.animal, now);
      }
    }
  }

  // the pets list has every pet but no weapons, so weapons on pets stay as the team card left them
  savePets(userId: string, list: PetRow[], now = Date.now()) {
    for (const p of list) {
      this.db.prepare(`INSERT INTO owo_pets (user_id, animal, name, level, xp, xp_need, hp, wp, str, mag, pr, mr, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, animal) DO UPDATE SET name = excluded.name, level = excluded.level, xp = excluded.xp, xp_need = excluded.xp_need, hp = excluded.hp,
        wp = excluded.wp, str = excluded.str, mag = excluded.mag, pr = excluded.pr, mr = excluded.mr, at = excluded.at`)
        .run(userId, p.animal, p.name, p.level, p.xp, p.xpNeed, p.hp, p.wp, p.str, p.mag, p.pr, p.mr, now);
    }
  }

  // base stats are the same for everyone, so one dex card teaches Texz that animal for the whole server
  saveDex(d: Dex, now = Date.now()) {
    this.db.prepare(`INSERT INTO owo_dex (animal, rank, hp, str, pr, wp, mag, mr, points, sell, essence, aliases, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (animal) DO UPDATE SET rank = excluded.rank, hp = excluded.hp, str = excluded.str, pr = excluded.pr, wp = excluded.wp, mag = excluded.mag,
      mr = excluded.mr, points = excluded.points, sell = excluded.sell, essence = COALESCE(excluded.essence, owo_dex.essence), aliases = excluded.aliases, at = excluded.at`)
      .run(d.animal, d.rank, d.hp, d.str, d.pr, d.wp, d.mag, d.mr, d.points, d.sell, d.essence, JSON.stringify(d.aliases), now);
  }

  // every full set of weapon numbers ever seen, from anyone: shop pages, weapon cards and each reroll try.
  // The weapons helper learns each weapon's ranges from these
  saveSample(weapon: string, x: { rarity: string | null; quality: number | null; wear: string | null; wpCost: number | null; rolls: number[]; passives: { name: string; rolls: number[] }[] }, source: string, now = Date.now()) {
    if (x.quality === null) return;
    const key = `${weapon}|${x.quality}|${x.wpCost}|${x.rolls.join(',')}|${x.passives.map((p) => `${p.name}:${p.rolls.join(',')}`).join(';')}`;
    this.db.prepare('INSERT OR IGNORE INTO owo_samples (key, weapon, rarity, quality, wear, wp_cost, rolls, passives, source, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(key, weapon, x.rarity, x.quality, x.wear, x.wpCost, JSON.stringify(x.rolls), JSON.stringify(x.passives.map((p) => ({ name: p.name, rolls: p.rolls }))), source, now);
  }

  samples(weapon?: string) {
    return (this.db.prepare(`SELECT * FROM owo_samples${weapon ? ' WHERE weapon = ?' : ''}`).all(...(weapon ? [weapon] : [])) as Record<string, unknown>[]).map((r) => ({
      weapon: r.weapon as string, rarity: r.rarity as string | null, quality: r.quality as number, wear: r.wear as string | null, wpCost: r.wp_cost as number | null,
      rolls: JSON.parse(r.rolls as string) as number[], passives: JSON.parse(r.passives as string) as { name: string; rolls: number[] }[], source: r.source as string,
    }));
  }

  // how many samples each weapon type has, and when the shop was last read
  sampleStats() {
    const per = this.db.prepare('SELECT weapon, COUNT(*) AS n FROM owo_samples GROUP BY weapon').all() as { weapon: string; n: number }[];
    const shop = this.db.prepare("SELECT MAX(at) AS at FROM owo_samples WHERE source = 'shop'").get() as { at: number | null };
    return { per: new Map(per.map((r) => [r.weapon, r.n])), shopAt: shop.at ?? 0 };
  }

  // a reroll screen: the CURRENT side is the weapon as it is now, confirmed or not
  saveReroll(userId: string, r: Reroll, now = Date.now()) {
    const c: RollSide = r.current;
    this.db.prepare(`INSERT INTO owo_weapons (user_id, id, name, rarity, quality, wear, wp_cost, rolls, passives, reroll_changes, reroll_attempts, detailed, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, rarity = excluded.rarity, quality = excluded.quality, wear = excluded.wear, wp_cost = excluded.wp_cost,
      rolls = excluded.rolls, passives = excluded.passives, reroll_changes = excluded.reroll_changes, reroll_attempts = excluded.reroll_attempts, detailed = 1, seen_at = excluded.seen_at`)
      .run(userId, r.id, r.name, c.rarity, c.quality, c.wear, c.wpCost, JSON.stringify(c.rolls), JSON.stringify(c.passives), r.changes, r.attempts, now);
    if (r.shards !== null) this.setBit(userId, 'shards', r.shards, now);
  }

  dex(animal: string) {
    return this.db.prepare('SELECT * FROM owo_dex WHERE animal = ?').get(animal) as { animal: string; rank: string | null; hp: number; str: number; pr: number; wp: number; mag: number; mr: number } | undefined;
  }

  // by animal name or any of its OwO aliases
  dexFind(q: string) {
    const d = this.dex(q);
    if (d) return d;
    const rows = this.db.prepare('SELECT * FROM owo_dex').all() as (NonNullable<ReturnType<OwoState['dex']>> & { aliases: string | null })[];
    return rows.find((r) => (JSON.parse(r.aliases ?? '[]') as string[]).some((a) => a.toLowerCase() === q)) ?? undefined;
  }

  dexCount() {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM owo_dex').get() as { n: number }).n;
  }

  saveWeaponCard(userId: string, w: WeaponCard, now = Date.now()) {
    if (!w.id) return;
    this.db.prepare(`INSERT INTO owo_weapons (user_id, id, name, rarity, quality, wear, empowered, kills, wp_cost, rolls, passives, reroll_changes, reroll_attempts, detailed, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, rarity = excluded.rarity, quality = excluded.quality, wear = excluded.wear,
      empowered = excluded.empowered, kills = excluded.kills, wp_cost = excluded.wp_cost, rolls = excluded.rolls, passives = excluded.passives,
      reroll_changes = excluded.reroll_changes, reroll_attempts = excluded.reroll_attempts, detailed = 1, seen_at = excluded.seen_at`)
      .run(userId, w.id, w.name, w.rarity, w.quality, w.wear, w.empowered ? 1 : 0, w.kills, w.wpCost, JSON.stringify(w.rolls), JSON.stringify(w.passives),
        w.rerollChanges, w.rerollAttempts, now);
  }

  saveWeaponRows(userId: string, rows: ListedWeapon[], now = Date.now()) {
    const db = this.db;
    for (const w of rows) {
      // a list row is a summary, it never overwrites the numbers from a full card
      db.prepare(`INSERT INTO owo_weapons (user_id, id, type, rarity, name, quality, wear, empowered, favourite, kills, on_animal, passive_icons, seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, id) DO UPDATE SET type = excluded.type, rarity = excluded.rarity, name = excluded.name, quality = excluded.quality,
        wear = excluded.wear, empowered = excluded.empowered, favourite = excluded.favourite, kills = excluded.kills, on_animal = excluded.on_animal,
        passive_icons = excluded.passive_icons, seen_at = excluded.seen_at`)
        .run(userId, w.id, w.type, w.rarity, w.name, w.quality, w.wear, w.empowered ? 1 : 0, w.favourite ? 1 : 0, w.kills, w.on, JSON.stringify(w.passives), now);
    }
  }

  // after every page of an unfiltered list was seen in one go, anything older is gone (dismantled or sold)
  sweepWeapons(userId: string, since: number) {
    return Number(this.db.prepare('DELETE FROM owo_weapons WHERE user_id = ? AND seen_at < ?').run(userId, since).changes);
  }

  dropWeapon(userId: string, id: string) {
    this.db.prepare('DELETE FROM owo_weapons WHERE user_id = ? AND id = ?').run(userId, id);
  }

  saveZoo(userId: string, z: Zoo, now = Date.now()) {
    this.db.prepare(`INSERT INTO owo_zoo (user_id, animals, points, caught, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET animals = excluded.animals, points = excluded.points, caught = excluded.caught, at = excluded.at`)
      .run(userId, JSON.stringify(z.animals), z.points, JSON.stringify(z.caught), now);
  }

  saveHuntbot(userId: string, h: Huntbot, now = Date.now()) {
    const old = this.huntbot(userId);
    this.db.prepare(`INSERT INTO owo_huntbot (user_id, traits, essence, max_run, back_at, at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET traits = excluded.traits, essence = excluded.essence, max_run = excluded.max_run, back_at = excluded.back_at, at = excluded.at`)
      .run(userId, JSON.stringify({ ...(old?.traits ?? {}), ...h.traits }), h.essence ?? old?.essence ?? null, JSON.stringify(h.maxRun ?? old?.maxRun ?? null),
        h.hunting ? now + h.hunting.backInMs : null, now);
  }

  // sent off or still hunting: when it's back. Back with animals: not hunting any more
  setHuntbotBack(userId: string, backAt: number | null) {
    this.db.prepare('UPDATE owo_huntbot SET back_at = ? WHERE user_id = ?').run(backAt, userId);
    if (!this.huntbot(userId)) this.db.prepare('INSERT INTO owo_huntbot (user_id, traits, back_at, at) VALUES (?, ?, ?, ?)').run(userId, '{}', backAt, Date.now());
  }

  setTrait(userId: string, trait: string, level: number, progress: number, need: number) {
    // OwO calls it exp in the upgrade reply and Experience on the card
    if (trait === 'exp' || trait === 'xp') trait = 'experience';
    const h = this.huntbot(userId);
    const traits = { ...(h?.traits ?? {}), [trait]: { ...(h?.traits?.[trait as keyof Huntbot['traits']] ?? { value: '' }), level, progress, need } };
    if (h) this.db.prepare('UPDATE owo_huntbot SET traits = ? WHERE user_id = ?').run(JSON.stringify(traits), userId);
    else this.db.prepare('INSERT INTO owo_huntbot (user_id, traits, at) VALUES (?, ?, ?)').run(userId, JSON.stringify(traits), Date.now());
  }

  // essence moves with upgrades, sacrifices and runs coming home, between looks at the card
  addEssence(userId: string, delta: number) {
    this.db.prepare('UPDATE owo_huntbot SET essence = MAX(0, COALESCE(essence, 0) + ?) WHERE user_id = ?').run(delta, userId);
  }

  // when someone was around using OwO, kept two weeks, for working out how often the HuntBot gets sent
  touch(userId: string, now = Date.now()) {
    const old = (this.bits(userId).get('seen')?.value as number[] | undefined) ?? [];
    if (old.length && now - old[old.length - 1] < 5 * 60_000) return;
    this.setBit(userId, 'seen', [...old.filter((t) => t > now - 14 * 86_400_000), now], now);
  }

  seenTimes(userId: string) {
    const seen = (this.bits(userId).get('seen')?.value as number[] | undefined) ?? [];
    return [...seen, ...this.battles(userId, Date.now() - 14 * 86_400_000).map((b) => b.at)].sort((a, b) => a - b);
  }

  setBit(userId: string, what: string, value: unknown, now = Date.now()) {
    this.db.prepare(`INSERT INTO owo_bits (user_id, what, value, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, what) DO UPDATE SET value = excluded.value, at = excluded.at`).run(userId, what, JSON.stringify(value), now);
  }

  logBattle(userId: string, b: Battle, now = Date.now()) {
    this.db.prepare('INSERT INTO owo_battles (user_id, at, result, turns, xp, streak) VALUES (?, ?, ?, ?, ?, ?)').run(userId, now, b.result, b.turns, b.xp, b.streak);
    // keep the last 500 per person, enough for win rates without growing forever
    this.db.prepare(`DELETE FROM owo_battles WHERE user_id = ? AND at < (SELECT at FROM owo_battles WHERE user_id = ? ORDER BY at DESC LIMIT 1 OFFSET 499)`).run(userId, userId);
  }

  forget(userId: string) {
    for (const t of ['owo_pets', 'owo_teams', 'owo_weapons', 'owo_zoo', 'owo_huntbot', 'owo_bits', 'owo_battles', 'owo_catches', 'owo_tally', 'owo_wall_owned']) this.db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }

  // what came in, rank by rank: hunts and HuntBot counted apart. Rare ones (mythic and up, or anything unusual) also go in the log
  logCatches(userId: string, source: 'hunt' | 'huntbot', byRank: Record<string, number>, rare: { animal: string; rank: string | null }[], now = Date.now()) {
    const up = this.db.prepare(`INSERT INTO owo_tally (user_id, source, rank, n, since) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, source, rank) DO UPDATE SET n = n + excluded.n, since = MIN(since, excluded.since)`);
    for (const [rank, n] of Object.entries(byRank)) if (n > 0) up.run(userId, source, rank, n, now);
    const add = this.db.prepare('INSERT INTO owo_catches (user_id, at, animal, rank, source) VALUES (?, ?, ?, ?, ?)');
    for (const r of rare) add.run(userId, now, r.animal, r.rank, source);
  }

  catches(userId: string | null, limit = 15) {
    return (userId
      ? this.db.prepare('SELECT * FROM owo_catches WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(userId, limit)
      : this.db.prepare('SELECT * FROM owo_catches ORDER BY at DESC LIMIT ?').all(limit)) as { user_id: string; at: number; animal: string; rank: string | null; source: string }[];
  }

  tally(userId: string) {
    return this.db.prepare('SELECT source, rank, n, since FROM owo_tally WHERE user_id = ?').all(userId) as { source: string; rank: string; n: number; since: number }[];
  }

  // every animal's rank Texz has seen, from anyone's zoo and the dex
  rankMap() {
    const out = new Map<string, string>();
    for (const r of this.db.prepare('SELECT animals FROM owo_zoo').all() as { animals: string }[]) {
      for (const a of JSON.parse(r.animals) as Zoo['animals']) out.set(a.animal, a.rank);
    }
    for (const r of this.db.prepare('SELECT animal, rank FROM owo_dex WHERE rank IS NOT NULL').all() as { animal: string; rank: string }[]) if (!out.has(r.animal)) out.set(r.animal, r.rank.toLowerCase());
    return out;
  }

  // OwO's animal pictures are custom emojis: remember each one's id so it can be drawn later
  learnEmojis(text: string) {
    const up = this.db.prepare('INSERT INTO owo_emoji (name, id, animated) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET id = excluded.id, animated = excluded.animated');
    for (const m of text.matchAll(/<(a?):(\w+):(\d{15,20})>/g)) up.run(m[2], m[3], m[1] ? 1 : 0);
  }

  emojiOf(name: string) {
    return this.db.prepare('SELECT id, animated FROM owo_emoji WHERE name = ?').get(name) as { id: string; animated: number } | undefined;
  }

  saveWallpaper(userId: string | null, w: Wallpaper, now = Date.now()) {
    this.db.prepare(`INSERT INTO owo_walls (id, name, price, url, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, price = COALESCE(excluded.price, owo_walls.price), url = excluded.url, at = excluded.at`).run(w.id, w.name, w.price, w.url, now);
    if (!userId || !w.owned) return;
    if (w.equipped) this.db.prepare('UPDATE owo_wall_owned SET equipped = 0 WHERE user_id = ?').run(userId);
    this.db.prepare(`INSERT INTO owo_wall_owned (user_id, id, equipped) VALUES (?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET equipped = MAX(owo_wall_owned.equipped, excluded.equipped)`).run(userId, w.id, w.equipped ? 1 : 0);
  }

  wallpapers(userId: string) {
    return this.db.prepare(`SELECT w.*, o.user_id IS NOT NULL AS owned, COALESCE(o.equipped, 0) AS equipped FROM owo_walls w
      LEFT JOIN owo_wall_owned o ON o.id = w.id AND o.user_id = ? ORDER BY w.id`).all(userId) as { id: number; name: string; price: number | null; url: string; at: number; owned: number; equipped: number }[];
  }

  // ---------- reads ----------

  pets(userId: string) {
    return this.db.prepare('SELECT * FROM owo_pets WHERE user_id = ? ORDER BY level DESC').all(userId) as {
      animal: string; name: string; level: number; xp: number; xp_need: number; hp: number; wp: number; str: number; mag: number; pr: number; mr: number; weapon_id: string | null; at: number;
    }[];
  }

  teams(userId: string) {
    return (this.db.prepare('SELECT * FROM owo_teams WHERE user_id = ? ORDER BY team').all(userId) as { team: number; name: string; animals: string; streak: number | null; best: number | null; at: number }[])
      .map((t) => ({ ...t, animals: JSON.parse(t.animals) as string[] }));
  }

  weapons(userId: string) {
    return (this.db.prepare('SELECT * FROM owo_weapons WHERE user_id = ? ORDER BY quality DESC').all(userId) as Record<string, unknown>[]).map((w) => ({
      id: w.id as string, type: w.type as string | null, rarity: w.rarity as string | null, name: w.name as string | null, quality: w.quality as number | null,
      wear: w.wear as string | null, empowered: !!w.empowered, favourite: !!w.favourite, kills: w.kills as number | null, on: w.on_animal as string | null,
      wpCost: w.wp_cost as number | null, rolls: w.rolls ? JSON.parse(w.rolls as string) as number[] : null,
      passives: w.passives ? JSON.parse(w.passives as string) as WeaponCard['passives'] : null,
      passiveIcons: w.passive_icons ? JSON.parse(w.passive_icons as string) as string[] : [],
      rerollChanges: w.reroll_changes as number | null, rerollAttempts: w.reroll_attempts as number | null, detailed: !!w.detailed, seenAt: w.seen_at as number,
    }));
  }

  zoo(userId: string) {
    const r = this.db.prepare('SELECT * FROM owo_zoo WHERE user_id = ?').get(userId) as { animals: string; points: number | null; caught: string | null; at: number } | undefined;
    return r ? { animals: JSON.parse(r.animals) as Zoo['animals'], points: r.points, caught: JSON.parse(r.caught ?? '{}') as Record<string, number>, at: r.at } : null;
  }

  huntbot(userId: string) {
    const r = this.db.prepare('SELECT * FROM owo_huntbot WHERE user_id = ?').get(userId) as { traits: string; essence: number | null; max_run: string | null; back_at: number | null; at: number } | undefined;
    return r ? { traits: JSON.parse(r.traits) as Huntbot['traits'], essence: r.essence, maxRun: JSON.parse(r.max_run ?? 'null') as Huntbot['maxRun'], backAt: r.back_at, at: r.at } : null;
  }

  bits(userId: string) {
    const rows = this.db.prepare('SELECT what, value, at FROM owo_bits WHERE user_id = ?').all(userId) as { what: string; value: string; at: number }[];
    return new Map(rows.map((r) => [r.what, { value: JSON.parse(r.value) as unknown, at: r.at }]));
  }

  battles(userId: string, since = 0) {
    return this.db.prepare('SELECT result, turns, xp, streak, at FROM owo_battles WHERE user_id = ? AND at >= ? ORDER BY at DESC').all(userId, since) as { result: string; turns: number; xp: number; streak: number | null; at: number }[];
  }

  // anyone with a huntbot due back, for the reminder loop
  huntbotsDue(until: number) {
    return this.db.prepare('SELECT user_id, back_at FROM owo_huntbot WHERE back_at IS NOT NULL AND back_at <= ?').all(until) as { user_id: string; back_at: number }[];
  }
}
