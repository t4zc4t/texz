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
  // where each reminder type goes, falls back to delivery when not set
  routes: Partial<Record<string, Delivery>>;
  // seconds before a channel reminder deletes itself, 0 keeps it
  autodelete: number;
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
  routes: {},
  autodelete: 0,
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
  // gif links admins picked for moments like help, levelup or welcome
  gifs: Record<string, string>;
  mod: { logChannel: string | null; invites: boolean; spam: boolean; mentions: boolean };
  welcome: { channel: string | null; message: string | null; goodbyeChannel: string | null; goodbyeMessage: string | null; autorole: string | null };
  levels: { channel: string | null; announce: boolean; rewards: Record<string, string> };
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
      CREATE TABLE IF NOT EXISTS follows (
        user_id TEXT NOT NULL,
        media_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        next_at INTEGER,
        channel_id TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS polls (
        message_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS afk (
        user_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        last_at INTEGER NOT NULL,
        last_channel TEXT,
        messages INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        mod_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS xp (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        last_at INTEGER NOT NULL DEFAULT 0,
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
    return {
      prefix: saved.prefix ?? 'tz',
      modules: saved.modules ?? {},
      gifs: saved.gifs ?? {},
      mod: { logChannel: null, invites: false, spam: false, mentions: false, ...saved.mod },
      welcome: { channel: null, message: null, goodbyeChannel: null, goodbyeMessage: null, autorole: null, ...saved.welcome },
      levels: { channel: null, announce: true, rewards: {}, ...saved.levels },
    };
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

  follow(userId: string, mediaId: number, title: string, nextAt: number | null, channelId: string | null) {
    this.db.prepare(`INSERT INTO follows (user_id, media_id, title, next_at, channel_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, media_id) DO UPDATE SET title = excluded.title, next_at = excluded.next_at`).run(userId, mediaId, title, nextAt, channelId);
  }

  unfollow(userId: string, mediaId: number) {
    this.db.prepare('DELETE FROM follows WHERE user_id = ? AND media_id = ?').run(userId, mediaId);
    this.db.prepare('DELETE FROM reminders WHERE user_id = ? AND kind = ?').run(userId, `ep:${mediaId}`);
  }

  follows(userId?: string): { user_id: string; media_id: number; title: string; next_at: number | null; channel_id: string | null }[] {
    const q = userId ? this.db.prepare('SELECT * FROM follows WHERE user_id = ?').all(userId) : this.db.prepare('SELECT * FROM follows').all();
    return q as unknown as { user_id: string; media_id: number; title: string; next_at: number | null; channel_id: string | null }[];
  }

  poll(messageId: string): { question: string; options: string[]; votes: Record<string, number>; owner: string; closed?: boolean } | null {
    const row = this.db.prepare('SELECT data FROM polls WHERE message_id = ?').get(messageId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  savePoll(messageId: string, data: object) {
    this.db.prepare('INSERT INTO polls (message_id, data) VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET data = excluded.data').run(messageId, JSON.stringify(data));
  }

  setAfk(userId: string, reason: string | null) {
    if (reason === null) this.db.prepare('DELETE FROM afk WHERE user_id = ?').run(userId);
    else this.db.prepare('INSERT INTO afk (user_id, reason, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, at = excluded.at').run(userId, reason, Date.now());
  }

  afk(userId: string): { reason: string; at: number } | null {
    return (this.db.prepare('SELECT reason, at FROM afk WHERE user_id = ?').get(userId) as { reason: string; at: number } | undefined) ?? null;
  }

  // last time someone spoke in a server and how much, for the dossier
  heard(guildId: string, userId: string, channelId: string) {
    this.db.prepare(`INSERT INTO activity (guild_id, user_id, last_at, last_channel, messages) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET last_at = excluded.last_at, last_channel = excluded.last_channel, messages = messages + 1`)
      .run(guildId, userId, Date.now(), channelId);
  }

  activity(guildId: string, userId: string): { last_at: number; last_channel: string | null; messages: number } | null {
    return (this.db.prepare('SELECT last_at, last_channel, messages FROM activity WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as
      { last_at: number; last_channel: string | null; messages: number } | undefined) ?? null;
  }

  warn(guildId: string, userId: string, modId: string, reason: string): number {
    const r = this.db.prepare('INSERT INTO warnings (guild_id, user_id, mod_id, reason, at) VALUES (?, ?, ?, ?, ?)').run(guildId, userId, modId, reason, Date.now());
    return Number(r.lastInsertRowid);
  }

  warnings(guildId: string, userId: string): { id: number; mod_id: string; reason: string; at: number }[] {
    return this.db.prepare('SELECT id, mod_id, reason, at FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY at DESC').all(guildId, userId) as
      { id: number; mod_id: string; reason: string; at: number }[];
  }

  unwarn(guildId: string, id: number): boolean {
    return Number(this.db.prepare('DELETE FROM warnings WHERE guild_id = ? AND id = ?').run(guildId, id).changes) > 0;
  }

  xpOf(guildId: string, userId: string): { xp: number; last_at: number } {
    return (this.db.prepare('SELECT xp, last_at FROM xp WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as { xp: number; last_at: number } | undefined) ?? { xp: 0, last_at: 0 };
  }

  addXp(guildId: string, userId: string, amount: number) {
    this.db.prepare(`INSERT INTO xp (guild_id, user_id, xp, last_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = xp + excluded.xp, last_at = excluded.last_at`).run(guildId, userId, amount, Date.now());
  }

  setXp(guildId: string, userId: string, xp: number) {
    this.db.prepare(`INSERT INTO xp (guild_id, user_id, xp, last_at) VALUES (?, ?, ?, 0)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp`).run(guildId, userId, Math.max(0, xp));
  }

  xpBoard(guildId: string, limit = 10): { user_id: string; xp: number }[] {
    return this.db.prepare('SELECT user_id, xp FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT ?').all(guildId, limit) as { user_id: string; xp: number }[];
  }

  xpPosition(guildId: string, xp: number): number {
    return 1 + (this.db.prepare('SELECT COUNT(*) AS n FROM xp WHERE guild_id = ? AND xp > ?').get(guildId, xp) as { n: number }).n;
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
