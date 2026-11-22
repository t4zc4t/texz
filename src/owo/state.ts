import type { DatabaseSync } from 'node:sqlite';
import type { Battle, Huntbot, ListedWeapon, Team, WeaponCard, Zoo } from './read.js';

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
    CREATE INDEX IF NOT EXISTS owo_battles_user ON owo_battles (user_id, at);
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
    const h = this.huntbot(userId);
    const traits = { ...(h?.traits ?? {}), [trait]: { ...(h?.traits?.[trait as keyof Huntbot['traits']] ?? { value: '' }), level, progress, need } };
    if (h) this.db.prepare('UPDATE owo_huntbot SET traits = ? WHERE user_id = ?').run(JSON.stringify(traits), userId);
    else this.db.prepare('INSERT INTO owo_huntbot (user_id, traits, at) VALUES (?, ?, ?)').run(userId, JSON.stringify(traits), Date.now());
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
    for (const t of ['owo_pets', 'owo_teams', 'owo_weapons', 'owo_zoo', 'owo_huntbot', 'owo_bits', 'owo_battles']) this.db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
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
