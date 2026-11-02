import { DatabaseSync } from 'node:sqlite';

export type Delivery = 'dm' | 'channel';

export interface Settings {
  delivery: Delivery;
  timezone: string;
  quiet: string | null;
  // reminder switches, all on except the 15s hunt/battle one which gets noisy fast
  huntbot: boolean;
  pray: boolean;
  daily: boolean;
  vote: boolean;
  minigames: boolean;
  huntbattle: boolean;
  lastcall: boolean;
}

export const defaultSettings: Settings = {
  delivery: 'dm',
  timezone: 'Asia/Kolkata',
  quiet: null,
  huntbot: true,
  pray: true,
  daily: true,
  vote: true,
  minigames: true,
  huntbattle: false,
  lastcall: true,
};

export interface Reminder {
  id: number;
  user_id: string;
  kind: string;
  note: string;
  due_at: number;
  channel_id: string | null;
}

export interface ModuleRules {
  enabled: boolean;
  channels: string[];
  roles: string[];
}

export interface GuildSettings {
  prefix: string;
  modules: Record<string, ModuleRules>;
}

export const defaultRules = (): ModuleRules => ({ enabled: true, channels: [], roles: [] });

export class Store {
  db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        settings TEXT NOT NULL,
        last_channel TEXT
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        due_at INTEGER NOT NULL,
        channel_id TEXT
      );
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders (due_at);
      CREATE TABLE IF NOT EXISTS snapshots (
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (user_id, kind)
      );
      CREATE TABLE IF NOT EXISTS done (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        what TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (user_id, day, what)
      );
      CREATE TABLE IF NOT EXISTS counts (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        what TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day, what)
      );
      CREATE TABLE IF NOT EXISTS members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS buddies (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        settings TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cooldowns (
        user_id TEXT NOT NULL,
        what TEXT NOT NULL,
        ready_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, what)
      );
    `);
  }

  settings(userId: string): Settings {
    const row = this.db.prepare('SELECT settings FROM users WHERE id = ?').get(userId) as
      | { settings: string }
      | undefined;
    return { ...defaultSettings, ...(row ? JSON.parse(row.settings) : {}) };
  }

  saveSettings(userId: string, s: Settings) {
    this.db
      .prepare(
        'INSERT INTO users (id, settings) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET settings = excluded.settings',
      )
      .run(userId, JSON.stringify(s));
  }

  guild(guildId: string): GuildSettings {
    const row = this.db.prepare('SELECT settings FROM guilds WHERE id = ?').get(guildId) as { settings: string } | undefined;
    const saved = row ? (JSON.parse(row.settings) as Partial<GuildSettings>) : {};
    return { prefix: saved.prefix ?? 'tz', modules: saved.modules ?? {} };
  }

  rules(guildId: string | null, module: string): ModuleRules {
    if (!guildId) return defaultRules();
    return { ...defaultRules(), ...this.guild(guildId).modules[module] };
  }

  saveGuild(guildId: string, s: GuildSettings) {
    this.db
      .prepare('INSERT INTO guilds (id, settings) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET settings = excluded.settings')
      .run(guildId, JSON.stringify(s));
  }

  seenIn(guildId: string, userId: string) {
    this.db.prepare('INSERT OR IGNORE INTO members (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
  }

  // hunts and battles per member of a server since a day
  board(guildId: string, fromDay: string): { user_id: string; hunts: number; battles: number }[] {
    return this.db.prepare(`
      SELECT m.user_id,
        COALESCE(SUM(CASE WHEN c.what = 'hunt' THEN c.n END), 0) AS hunts,
        COALESCE(SUM(CASE WHEN c.what = 'battle' THEN c.n END), 0) AS battles
      FROM members m JOIN counts c ON c.user_id = m.user_id AND c.day >= ?
      WHERE m.guild_id = ?
      GROUP BY m.user_id
      ORDER BY hunts + battles DESC
      LIMIT 10`).all(fromDay, guildId) as { user_id: string; hunts: number; battles: number }[];
  }

  setBuddy(guildId: string, userId: string, on: boolean) {
    if (on) this.db.prepare('INSERT OR IGNORE INTO buddies (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
    else this.db.prepare('DELETE FROM buddies WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  buddies(guildId: string): string[] {
    return (this.db.prepare('SELECT user_id FROM buddies WHERE guild_id = ?').all(guildId) as { user_id: string }[]).map((r) => r.user_id);
  }

  touch(userId: string, channelId: string) {
    this.db
      .prepare(
        `INSERT INTO users (id, settings, last_channel) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_channel = excluded.last_channel`,
      )
      .run(userId, JSON.stringify(defaultSettings), channelId);
  }

  lastChannel(userId: string): string | null {
    const row = this.db.prepare('SELECT last_channel FROM users WHERE id = ?').get(userId) as
      | { last_channel: string | null }
      | undefined;
    return row?.last_channel ?? null;
  }

  users(): string[] {
    return (this.db.prepare('SELECT id FROM users').all() as { id: string }[]).map((r) => r.id);
  }

  // one pending reminder per kind, a newer one replaces the old
  setReminder(userId: string, kind: string, dueAt: Date, note = '', channelId: string | null = null) {
    this.db.prepare('DELETE FROM reminders WHERE user_id = ? AND kind = ?').run(userId, kind);
    this.addReminder(userId, kind, dueAt, note, channelId);
  }

  addReminder(userId: string, kind: string, dueAt: Date, note = '', channelId: string | null = null): number {
    const r = this.db
      .prepare('INSERT INTO reminders (user_id, kind, note, due_at, channel_id) VALUES (?, ?, ?, ?, ?)')
      .run(userId, kind, note, dueAt.getTime(), channelId);
    return Number(r.lastInsertRowid);
  }

  dueReminders(now: number): Reminder[] {
    return this.db.prepare('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at').all(now) as unknown as Reminder[];
  }

  userReminders(userId: string): Reminder[] {
    return this.db
      .prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at')
      .all(userId) as unknown as Reminder[];
  }

  reminderOf(userId: string, kind: string): Reminder | undefined {
    return this.db.prepare('SELECT * FROM reminders WHERE user_id = ? AND kind = ?').get(userId, kind) as
      | Reminder
      | undefined;
  }

  deleteReminder(id: number, userId?: string): boolean {
    const r = userId
      ? this.db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId)
      : this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    return Number(r.changes) > 0;
  }

  saveSnapshot(userId: string, kind: string, data: unknown) {
    this.db
      .prepare(
        `INSERT INTO snapshots (user_id, kind, data, at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, kind) DO UPDATE SET data = excluded.data, at = excluded.at`,
      )
      .run(userId, kind, JSON.stringify(data), Date.now());
  }

  snapshot<T>(userId: string, kind: string): { data: T; at: number } | null {
    const row = this.db.prepare('SELECT data, at FROM snapshots WHERE user_id = ? AND kind = ?').get(userId, kind) as
      | { data: string; at: number }
      | undefined;
    return row ? { data: JSON.parse(row.data) as T, at: row.at } : null;
  }

  markDone(userId: string, day: string, what: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO done (user_id, day, what, at) VALUES (?, ?, ?, ?)')
      .run(userId, day, what, Date.now());
  }

  doneOn(userId: string, day: string): Set<string> {
    const rows = this.db.prepare('SELECT what FROM done WHERE user_id = ? AND day = ?').all(userId, day) as {
      what: string;
    }[];
    return new Set(rows.map((r) => r.what));
  }

  // which of these the user has done at least once since a given day
  usedSince(userId: string, fromDay: string, whats: readonly string[]): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT what FROM done WHERE user_id = ? AND day >= ?')
      .all(userId, fromDay) as { what: string }[];
    const seen = new Set(rows.map((r) => r.what));
    return whats.filter((w) => seen.has(w));
  }

  bump(userId: string, day: string, what: string) {
    this.db
      .prepare(
        `INSERT INTO counts (user_id, day, what, n) VALUES (?, ?, ?, 1)
         ON CONFLICT(user_id, day, what) DO UPDATE SET n = n + 1`,
      )
      .run(userId, day, what);
  }

  countsSince(userId: string, fromDay: string): { day: string; what: string; n: number }[] {
    return this.db
      .prepare('SELECT day, what, n FROM counts WHERE user_id = ? AND day >= ? ORDER BY day')
      .all(userId, fromDay) as { day: string; what: string; n: number }[];
  }

  setCooldown(userId: string, what: string, readyAt: Date) {
    this.db
      .prepare(
        `INSERT INTO cooldowns (user_id, what, ready_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, what) DO UPDATE SET ready_at = excluded.ready_at`,
      )
      .run(userId, what, readyAt.getTime());
  }

  cooldowns(userId: string): Map<string, number> {
    const rows = this.db.prepare('SELECT what, ready_at FROM cooldowns WHERE user_id = ?').all(userId) as {
      what: string;
      ready_at: number;
    }[];
    return new Map(rows.map((r) => [r.what, r.ready_at]));
  }
}
