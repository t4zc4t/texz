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
  // alert when a gem type is about to run out
  gems: boolean;
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
  gems: true,
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
  levels: LevelRules;
  birthdays: { channel: string | null; role: string | null; message: string | null };
  // seconds before quick typed answers clean themselves up, 0 keeps them
  autoclean: number;
  starboard: { channel: string | null; emoji: string; min: number; self: boolean };
  tickets: { category: string | null; staff: string | null; log: string | null };
  // channel for the character of the day
  daily: { channel: string | null };
  bulletins: Bulletins;
  quotes: { channel: string | null };
}

export interface Feed { on: boolean; channel: string | null; role: string | null }
export interface Bulletins {
  category: string | null;
  f1: Feed & { facts: boolean };
  football: Feed & { favs: string[]; big: boolean };
  anime: Feed & { shows: { id: number; title: string }[]; popular: boolean };
}
export const defaultBulletins = (): Bulletins => ({
  category: null,
  f1: { on: true, channel: null, role: null, facts: true },
  football: { on: true, channel: null, role: null, favs: [], big: true },
  anime: { on: true, channel: null, role: null, shows: [], popular: true },
});

export interface LevelRules {
  channel: string | null;
  announce: boolean;
  // level → role id
  rewards: Record<string, string>;
  // xp per counted message and the gap between counted messages, in seconds
  min: number;
  max: number;
  cooldown: number;
  // keep every reward role, or only the highest one reached
  stack: boolean;
  // custom level-up line, null uses Texz's own
  message: string | null;
  // a timed event, like 2x for the weekend of a server anniversary
  boost: { x: number; from: number; until: number; name: string } | null;
  // standing multiplier on Saturdays and Sundays (UTC), 1 means off
  weekend: number;
  roleBoosts: Record<string, number>;
  channelBoosts: Record<string, number>;
  noXpChannels: string[];
  noXpRoles: string[];
}

export const defaultLevels = (): LevelRules => ({
  channel: null, announce: true, rewards: {}, min: 15, max: 25, cooldown: 60, stack: true, message: null,
  boost: null, weekend: 1, roleBoosts: {}, channelBoosts: {}, noXpChannels: [], noXpRoles: [],
});

// features a server has to switch on itself, levels posting in every chat isn't something to spring on people
export interface Schedule {
  id: number;
  guild_id: string;
  channel_id: string;
  text: string;
  next_at: number;
  every_ms: number;
  by_id: string;
}

export interface Case {
  guild_id: string;
  num: number;
  type: string;
  user_id: string;
  user_name: string | null;
  mod_id: string;
  reason: string;
  at: number;
  until: number | null;
  open: number;
}

export interface Giveaway {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  host_id: string;
  prize: string;
  winners: number;
  ends_at: number;
  // json of GiveawayRules
  rules: string;
  ended: number;
  picked: string | null;
}

export interface WatchEntry {
  user_id: string;
  media_id: number;
  title: string;
  kind: string;
  status: string;
  progress: number;
  total: number | null;
  updated_at: number;
}

export const offByDefault = new Set(['levels']);
export const defaultRules = (module = ''): ModuleRules => ({ enabled: !offByDefault.has(module), channels: [], roles: [] });

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
      CREATE TABLE IF NOT EXISTS xp (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        last_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS cases (
        guild_id TEXT NOT NULL,
        num INTEGER NOT NULL,
        type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        mod_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        at INTEGER NOT NULL,
        until INTEGER,
        open INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, num)
      );
      CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        host_id TEXT NOT NULL,
        prize TEXT NOT NULL,
        winners INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        rules TEXT NOT NULL,
        ended INTEGER NOT NULL DEFAULT 0,
        picked TEXT
      );
      CREATE TABLE IF NOT EXISTS entries (
        giveaway_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (giveaway_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS watchlist (
        user_id TEXT NOT NULL,
        media_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        total INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS birthdays (
        user_id TEXT PRIMARY KEY,
        month INTEGER NOT NULL,
        day INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS birthday_done (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        role_until INTEGER,
        PRIMARY KEY (guild_id, user_id, year)
      );
      CREATE TABLE IF NOT EXISTS pending_deletes (
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS stars (
        guild_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        board_id TEXT,
        count INTEGER NOT NULL,
        PRIMARY KEY (guild_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS tickets (
        channel_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        num INTEGER NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        text TEXT NOT NULL,
        next_at INTEGER NOT NULL,
        every_ms INTEGER NOT NULL DEFAULT 0,
        by_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daystats (
        guild_id TEXT NOT NULL,
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, day, kind, key)
      );
      CREATE TABLE IF NOT EXISTS wallets (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        yen INTEGER NOT NULL DEFAULT 0,
        daily_day TEXT,
        streak INTEGER NOT NULL DEFAULT 0,
        chat_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        price INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY,
        bio TEXT,
        favourite TEXT
      );
      CREATE TABLE IF NOT EXISTS catches (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS catches_guild ON catches (guild_id, at);
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
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
    // warnings used to live in their own table, they're cases now
    const old = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'warnings'").get();
    if (old) {
      this.db.exec(`
        INSERT OR IGNORE INTO cases (guild_id, num, type, user_id, mod_id, reason, at)
          SELECT guild_id, (SELECT COALESCE(MAX(num), 0) FROM cases c WHERE c.guild_id = w.guild_id) + ROW_NUMBER() OVER (PARTITION BY guild_id ORDER BY at), 'warn', user_id, mod_id, reason, at
          FROM warnings w;
        DROP TABLE warnings;
      `);
    }
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
      levels: { ...defaultLevels(), ...saved.levels },
      birthdays: { channel: null, role: null, message: null, ...saved.birthdays },
      autoclean: saved.autoclean ?? 30,
      starboard: { channel: null, emoji: '⭐', min: 3, self: false, ...saved.starboard },
      tickets: { category: null, staff: null, log: null, ...saved.tickets },
      daily: { channel: null, ...saved.daily },
      quotes: { channel: null, ...saved.quotes },
      bulletins: (() => {
        const d = defaultBulletins();
        const b: Partial<Bulletins> = saved.bulletins ?? {};
        return { category: b.category ?? null, f1: { ...d.f1, ...b.f1 }, football: { ...d.football, ...b.football }, anime: { ...d.anime, ...b.anime } };
      })(),
    };
  }

  rules(guildId: string | null, module: string): ModuleRules {
    if (!guildId) return defaultRules(module);
    return { ...defaultRules(module), ...this.guild(guildId).modules[module] };
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
    this.countDay(guildId, 'msg', channelId);
    this.countDay(guildId, 'user', userId);
    this.db.prepare(`INSERT INTO activity (guild_id, user_id, last_at, last_channel, messages) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET last_at = excluded.last_at, last_channel = excluded.last_channel, messages = messages + 1`)
      .run(guildId, userId, Date.now(), channelId);
  }

  activity(guildId: string, userId: string): { last_at: number; last_channel: string | null; messages: number } | null {
    return (this.db.prepare('SELECT last_at, last_channel, messages FROM activity WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as
      { last_at: number; last_channel: string | null; messages: number } | undefined) ?? null;
  }

  // bot-wide odds and ends, like where error reports go
  // every value under a key prefix, like all the Shoob wishlists
  kvByPrefix(prefix: string): { key: string; value: string }[] {
    return this.db.prepare("SELECT key, value FROM kv WHERE key LIKE ? ESCAPE '\\'").all(`${prefix.replace(/[\\%_]/g, '\\$&')}%`) as { key: string; value: string }[];
  }

  // Pokétwo catches seen in the server, for the Pokédex and the weekly race
  addCatch(guild: string, user: string, name: string) {
    this.db.prepare('INSERT INTO catches (guild_id, user_id, name, at) VALUES (?, ?, ?, ?)').run(guild, user, name, Date.now());
  }
  caughtNames(guild: string): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT lower(name) AS n FROM catches WHERE guild_id = ?').all(guild) as { n: string }[];
    return new Set(rows.map((r) => r.n));
  }
  catchBoard(guild: string, since: number, limit = 10): { user_id: string; n: number }[] {
    return this.db.prepare('SELECT user_id, COUNT(*) AS n FROM catches WHERE guild_id = ? AND at >= ? GROUP BY user_id ORDER BY n DESC LIMIT ?').all(guild, since, limit) as { user_id: string; n: number }[];
  }
  catchCount(guild: string, user?: string): number {
    const row = (user
      ? this.db.prepare('SELECT COUNT(*) AS n FROM catches WHERE guild_id = ? AND user_id = ?').get(guild, user)
      : this.db.prepare('SELECT COUNT(*) AS n FROM catches WHERE guild_id = ?').get(guild)) as { n: number };
    return row.n;
  }

  getKv(key: string): string | null {
    return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  setKv(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---------- bulletins ----------

  // people who follow a show, from episode alerts or their list
  watchersOf(mediaId: number): string[] {
    const rows = this.db.prepare(`SELECT user_id FROM follows WHERE media_id = ?
      UNION SELECT user_id FROM watchlist WHERE media_id = ? AND status = 'watching'`).all(mediaId, mediaId) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  // everyone's personal picks, for club pings
  allPicks(): { user: string; club?: string; ping?: boolean }[] {
    return (this.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'picks:%'").all() as { key: string; value: string }[])
      .map((r) => ({ user: r.key.slice(6), ...(JSON.parse(r.value) as { club?: string; ping?: boolean }) }));
  }

  // true the first time a key is seen, so each alert goes out once per server
  firstTime(guildId: string, key: string): boolean {
    const k = `sent:${guildId}:${key}`;
    if (this.getKv(k)) return false;
    this.setKv(k, String(Date.now()));
    return true;
  }

  forgetOldSent(before: number) {
    this.db.prepare("DELETE FROM kv WHERE key LIKE 'sent:%' AND CAST(value AS INTEGER) < ?").run(before);
  }

  // ---------- economy ----------

  wallet(guildId: string, userId: string): { yen: number; daily_day: string | null; streak: number; chat_at: number } {
    return (this.db.prepare('SELECT yen, daily_day, streak, chat_at FROM wallets WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as never)
      ?? { yen: 0, daily_day: null, streak: 0, chat_at: 0 };
  }

  // adds (or takes, with a negative amount) yen, refusing to go below zero
  pay(guildId: string, userId: string, amount: number, patch: { daily_day?: string; streak?: number; chat_at?: number } = {}): boolean {
    const w = this.wallet(guildId, userId);
    if (w.yen + amount < 0) return false;
    this.db.prepare(`INSERT INTO wallets (guild_id, user_id, yen, daily_day, streak, chat_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET yen = excluded.yen, daily_day = excluded.daily_day, streak = excluded.streak, chat_at = excluded.chat_at`)
      .run(guildId, userId, w.yen + amount, patch.daily_day ?? w.daily_day, patch.streak ?? w.streak, patch.chat_at ?? w.chat_at);
    return true;
  }

  richest(guildId: string, limit = 10): { user_id: string; yen: number }[] {
    return this.db.prepare('SELECT user_id, yen FROM wallets WHERE guild_id = ? AND yen > 0 ORDER BY yen DESC LIMIT ?').all(guildId, limit) as { user_id: string; yen: number }[];
  }

  shopItems(guildId: string): { id: number; role_id: string; price: number }[] {
    return this.db.prepare('SELECT id, role_id, price FROM shop_items WHERE guild_id = ? ORDER BY price').all(guildId) as { id: number; role_id: string; price: number }[];
  }

  addShopItem(guildId: string, roleId: string, price: number): number {
    this.db.prepare('DELETE FROM shop_items WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
    return Number(this.db.prepare('INSERT INTO shop_items (guild_id, role_id, price) VALUES (?, ?, ?)').run(guildId, roleId, price).lastInsertRowid);
  }

  removeShopItem(guildId: string, id: number): boolean {
    return Number(this.db.prepare('DELETE FROM shop_items WHERE guild_id = ? AND id = ?').run(guildId, id).changes) > 0;
  }

  // ---------- profiles ----------

  profile(userId: string): { bio: string | null; favourite: string | null } {
    return (this.db.prepare('SELECT bio, favourite FROM profiles WHERE user_id = ?').get(userId) as never) ?? { bio: null, favourite: null };
  }

  setProfile(userId: string, p: { bio?: string | null; favourite?: string | null }) {
    const old = this.profile(userId);
    this.db.prepare('INSERT INTO profiles (user_id, bio, favourite) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, favourite = excluded.favourite')
      .run(userId, p.bio === undefined ? old.bio : p.bio, p.favourite === undefined ? old.favourite : p.favourite);
  }

  // ---------- starboard ----------

  star(guildId: string, messageId: string): { board_id: string | null; count: number } | null {
    return (this.db.prepare('SELECT board_id, count FROM stars WHERE guild_id = ? AND message_id = ?').get(guildId, messageId) as { board_id: string | null; count: number } | undefined) ?? null;
  }

  setStar(guildId: string, messageId: string, boardId: string | null, count: number) {
    this.db.prepare(`INSERT INTO stars (guild_id, message_id, board_id, count) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, message_id) DO UPDATE SET board_id = excluded.board_id, count = excluded.count`).run(guildId, messageId, boardId, count);
  }

  // ---------- tickets ----------

  openTicket(guildId: string, userId: string): { channel_id: string } | null {
    return (this.db.prepare('SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND closed_at IS NULL').get(guildId, userId) as { channel_id: string } | undefined) ?? null;
  }

  addTicket(guildId: string, userId: string, channelId: string): number {
    const num = (this.db.prepare('SELECT COUNT(*) + 1 AS n FROM tickets WHERE guild_id = ?').get(guildId) as { n: number }).n;
    this.db.prepare('INSERT INTO tickets (channel_id, guild_id, user_id, num, opened_at) VALUES (?, ?, ?, ?, ?)').run(channelId, guildId, userId, num, Date.now());
    return num;
  }

  ticket(channelId: string): { guild_id: string; user_id: string; num: number; opened_at: number; closed_at: number | null } | null {
    return (this.db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as never) ?? null;
  }

  closeTicket(channelId: string) {
    this.db.prepare('UPDATE tickets SET closed_at = ? WHERE channel_id = ?').run(Date.now(), channelId);
  }

  // ---------- scheduled posts ----------

  addSchedule(s: { guild_id: string; channel_id: string; text: string; next_at: number; every_ms: number; by_id: string }): number {
    return Number(this.db.prepare('INSERT INTO schedules (guild_id, channel_id, text, next_at, every_ms, by_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(s.guild_id, s.channel_id, s.text, s.next_at, s.every_ms, s.by_id).lastInsertRowid);
  }

  schedules(guildId: string): Schedule[] {
    return this.db.prepare('SELECT * FROM schedules WHERE guild_id = ? ORDER BY next_at').all(guildId) as unknown as Schedule[];
  }

  dueSchedules(now: number): Schedule[] {
    return this.db.prepare('SELECT * FROM schedules WHERE next_at <= ?').all(now) as unknown as Schedule[];
  }

  moveSchedule(id: number, nextAt: number | null) {
    if (nextAt === null) this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    else this.db.prepare('UPDATE schedules SET next_at = ? WHERE id = ?').run(nextAt, id);
  }

  deleteSchedule(guildId: string, id: number): boolean {
    return Number(this.db.prepare('DELETE FROM schedules WHERE guild_id = ? AND id = ?').run(guildId, id).changes) > 0;
  }

  // ---------- server stats ----------

  countDay(guildId: string, kind: string, key: string, by = 1, day = new Date().toISOString().slice(0, 10)) {
    this.db.prepare(`INSERT INTO daystats (guild_id, day, kind, key, n) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, day, kind, key) DO UPDATE SET n = n + excluded.n`).run(guildId, day, kind, key, by);
  }

  // totals per day, or per key over a range of days
  dayTotals(guildId: string, kind: string, since: string): { day: string; n: number }[] {
    return this.db.prepare('SELECT day, SUM(n) AS n FROM daystats WHERE guild_id = ? AND kind = ? AND day >= ? GROUP BY day ORDER BY day').all(guildId, kind, since) as { day: string; n: number }[];
  }

  keyTotals(guildId: string, kind: string, since: string, limit = 5): { key: string; n: number }[] {
    return this.db.prepare('SELECT key, SUM(n) AS n FROM daystats WHERE guild_id = ? AND kind = ? AND day >= ? GROUP BY key ORDER BY n DESC LIMIT ?').all(guildId, kind, since, limit) as { key: string; n: number }[];
  }

  // ---------- moderation cases ----------

  addCase(c: Omit<Case, 'num' | 'at' | 'open' | 'until' | 'user_name'> & { open?: boolean; until?: number | null; user_name?: string | null }): number {
    const num = (this.db.prepare('SELECT COALESCE(MAX(num), 0) + 1 AS n FROM cases WHERE guild_id = ?').get(c.guild_id) as { n: number }).n;
    this.db.prepare('INSERT INTO cases (guild_id, num, type, user_id, user_name, mod_id, reason, at, until, open) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.guild_id, num, c.type, c.user_id, c.user_name ?? null, c.mod_id, c.reason, Date.now(), c.until ?? null, c.open ? 1 : 0);
    return num;
  }

  getCase(guildId: string, num: number): Case | null {
    return (this.db.prepare('SELECT * FROM cases WHERE guild_id = ? AND num = ?').get(guildId, num) as Case | undefined) ?? null;
  }

  findCases(guildId: string, f: { user?: string; mod?: string; type?: string; text?: string }, limit = 10, offset = 0): { rows: Case[]; total: number } {
    const where = ['guild_id = ?'];
    const args: (string | number)[] = [guildId];
    if (f.user) { where.push('user_id = ?'); args.push(f.user); }
    if (f.mod) { where.push('mod_id = ?'); args.push(f.mod); }
    if (f.type) { where.push('type = ?'); args.push(f.type); }
    if (f.text) { where.push("(reason LIKE ? ESCAPE '\\' OR user_name LIKE ? ESCAPE '\\')"); const t = `%${f.text.replace(/[\\%_]/g, '\\$&')}%`; args.push(t, t); }
    const w = where.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM cases WHERE ${w}`).get(...args) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM cases WHERE ${w} ORDER BY num DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as Case[];
    return { rows, total };
  }

  editCase(guildId: string, num: number, reason: string): boolean {
    return Number(this.db.prepare('UPDATE cases SET reason = ? WHERE guild_id = ? AND num = ?').run(reason, guildId, num).changes) > 0;
  }

  deleteCase(guildId: string, num: number): boolean {
    return Number(this.db.prepare('DELETE FROM cases WHERE guild_id = ? AND num = ?').run(guildId, num).changes) > 0;
  }

  // temp bans whose time is up
  dueCases(now: number): Case[] {
    return this.db.prepare("SELECT * FROM cases WHERE open = 1 AND type = 'tempban' AND until <= ?").all(now) as unknown as Case[];
  }

  closeCases(guildId: string, userId: string, type: string) {
    this.db.prepare('UPDATE cases SET open = 0 WHERE guild_id = ? AND user_id = ? AND type = ?').run(guildId, userId, type);
  }

  // ---------- giveaways ----------

  addGiveaway(g: Omit<Giveaway, 'id' | 'ended' | 'picked' | 'message_id'>): number {
    return Number(this.db.prepare('INSERT INTO giveaways (guild_id, channel_id, host_id, prize, winners, ends_at, rules) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(g.guild_id, g.channel_id, g.host_id, g.prize, g.winners, g.ends_at, g.rules).lastInsertRowid);
  }

  giveaway(id: number): Giveaway | null {
    return (this.db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) as Giveaway | undefined) ?? null;
  }

  updateGiveaway(id: number, patch: Partial<Pick<Giveaway, 'message_id' | 'ended' | 'picked' | 'ends_at'>>) {
    for (const [k, v] of Object.entries(patch)) this.db.prepare(`UPDATE giveaways SET ${k} = ? WHERE id = ?`).run(v as string | number | null, id);
  }

  activeGiveaways(guildId: string): Giveaway[] {
    return this.db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at').all(guildId) as unknown as Giveaway[];
  }

  dueGiveaways(now: number): Giveaway[] {
    return this.db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(now) as unknown as Giveaway[];
  }

  toggleEntry(id: number, userId: string): boolean {
    const had = Number(this.db.prepare('DELETE FROM entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId).changes) > 0;
    if (!had) this.db.prepare('INSERT INTO entries (giveaway_id, user_id) VALUES (?, ?)').run(id, userId);
    return !had;
  }

  entries(id: number): string[] {
    return (this.db.prepare('SELECT user_id FROM entries WHERE giveaway_id = ?').all(id) as { user_id: string }[]).map((r) => r.user_id);
  }

  // ---------- watchlist ----------

  watch(e: Omit<WatchEntry, 'updated_at'>) {
    this.db.prepare(`INSERT INTO watchlist (user_id, media_id, title, kind, status, progress, total, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, media_id) DO UPDATE SET status = excluded.status, progress = excluded.progress, total = excluded.total, title = excluded.title, updated_at = excluded.updated_at`)
      .run(e.user_id, e.media_id, e.title, e.kind, e.status, e.progress, e.total ?? null, Date.now());
  }

  watchEntry(userId: string, mediaId: number): WatchEntry | null {
    return (this.db.prepare('SELECT * FROM watchlist WHERE user_id = ? AND media_id = ?').get(userId, mediaId) as WatchEntry | undefined) ?? null;
  }

  watchlist(userId: string, status?: string): WatchEntry[] {
    return (status
      ? this.db.prepare('SELECT * FROM watchlist WHERE user_id = ? AND status = ? ORDER BY updated_at DESC').all(userId, status)
      : this.db.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY updated_at DESC').all(userId)) as unknown as WatchEntry[];
  }

  unwatch(userId: string, mediaId: number): boolean {
    return Number(this.db.prepare('DELETE FROM watchlist WHERE user_id = ? AND media_id = ?').run(userId, mediaId).changes) > 0;
  }

  // ---------- birthdays ----------

  setBirthday(userId: string, month: number, day: number) {
    this.db.prepare('INSERT INTO birthdays (user_id, month, day) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET month = excluded.month, day = excluded.day').run(userId, month, day);
  }

  birthday(userId: string): { month: number; day: number } | null {
    return (this.db.prepare('SELECT month, day FROM birthdays WHERE user_id = ?').get(userId) as { month: number; day: number } | undefined) ?? null;
  }

  removeBirthday(userId: string): boolean {
    return Number(this.db.prepare('DELETE FROM birthdays WHERE user_id = ?').run(userId).changes) > 0;
  }

  birthdays(): { user_id: string; month: number; day: number }[] {
    return this.db.prepare('SELECT user_id, month, day FROM birthdays').all() as { user_id: string; month: number; day: number }[];
  }

  birthdayDone(guildId: string, userId: string, year: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM birthday_done WHERE guild_id = ? AND user_id = ? AND year = ?').get(guildId, userId, year);
  }

  markBirthday(guildId: string, userId: string, year: number, roleUntil: number | null) {
    this.db.prepare('INSERT OR IGNORE INTO birthday_done (guild_id, user_id, year, role_until) VALUES (?, ?, ?, ?)').run(guildId, userId, year, roleUntil);
  }

  // birthday roles that have had their day
  dueBirthdayRoles(now: number): { guild_id: string; user_id: string; year: number }[] {
    const rows = this.db.prepare('SELECT guild_id, user_id, year FROM birthday_done WHERE role_until IS NOT NULL AND role_until <= ?').all(now) as { guild_id: string; user_id: string; year: number }[];
    this.db.prepare('UPDATE birthday_done SET role_until = NULL WHERE role_until IS NOT NULL AND role_until <= ?').run(now);
    return rows;
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

  resetXp(guildId: string, userId?: string) {
    if (userId) this.db.prepare('DELETE FROM xp WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    else this.db.prepare('DELETE FROM xp WHERE guild_id = ?').run(guildId);
  }

  xpBoard(guildId: string, limit = 10): { user_id: string; xp: number }[] {
    return this.db.prepare('SELECT user_id, xp FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT ?').all(guildId, limit) as { user_id: string; xp: number }[];
  }

  xpPosition(guildId: string, xp: number): number {
    return 1 + (this.db.prepare('SELECT COUNT(*) AS n FROM xp WHERE guild_id = ? AND xp > ?').get(guildId, xp) as { n: number }).n;
  }

  // channel pings that should vanish later, kept here so a restart doesn't forget them
  deleteLater(channelId: string, messageId: string, at: number) {
    this.db.prepare('INSERT OR REPLACE INTO pending_deletes (channel_id, message_id, at) VALUES (?, ?, ?)').run(channelId, messageId, at);
  }

  dueDeletes(now: number): { channel_id: string; message_id: string }[] {
    const rows = this.db.prepare('SELECT channel_id, message_id FROM pending_deletes WHERE at <= ?').all(now) as { channel_id: string; message_id: string }[];
    this.db.prepare('DELETE FROM pending_deletes WHERE at <= ?').run(now);
    return rows;
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
