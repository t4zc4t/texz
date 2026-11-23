import type { Store } from '../db.js';
import { report } from '../ops.js';
import { ask } from './anilist.js';

// A member's AniList or MyAnimeList, kept in step with their Texz list every few hours.
// Reading needs only the username: AniList is open, MAL needs the app's client ID (MAL_CLIENT_ID).
// Changing the AniList list from Discord uses the member's own token, pasted once (ANILIST_CLIENT_ID).

export type Site = 'anilist' | 'mal';
export interface Link { user_id: string; site: Site; username: string; token: string | null; synced_at: number | null }
export interface Entry { mediaId: number; title: string; kind: 'ANIME' | 'MANGA'; status: string; progress: number; total: number | null }

const STATUS_IN: Record<string, string> = {
  CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'planning', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped',
  watching: 'watching', reading: 'watching', plan_to_watch: 'planning', plan_to_read: 'planning', completed: 'completed', on_hold: 'paused', dropped: 'dropped',
};
export const STATUS_OUT: Record<string, string> = { watching: 'CURRENT', planning: 'PLANNING', completed: 'COMPLETED', paused: 'PAUSED', dropped: 'DROPPED' };

export class Links {
  constructor(private db: Store['db']) {
    db.exec(`CREATE TABLE IF NOT EXISTS anime_links (user_id TEXT PRIMARY KEY, site TEXT NOT NULL, username TEXT NOT NULL, token TEXT, synced_at INTEGER, ids TEXT)`);
  }
  get(userId: string) { return this.db.prepare('SELECT * FROM anime_links WHERE user_id = ?').get(userId) as unknown as (Link & { ids: string | null }) | undefined; }
  all() { return this.db.prepare('SELECT * FROM anime_links').all() as unknown as (Link & { ids: string | null })[]; }
  set(userId: string, site: Site, username: string) {
    this.db.prepare(`INSERT INTO anime_links (user_id, site, username) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET site = excluded.site, username = excluded.username, token = CASE WHEN anime_links.site = excluded.site THEN anime_links.token ELSE NULL END`).run(userId, site, username);
  }
  token(userId: string, token: string | null) { this.db.prepare('UPDATE anime_links SET token = ? WHERE user_id = ?').run(token, userId); }
  synced(userId: string, ids: number[]) { this.db.prepare('UPDATE anime_links SET synced_at = ?, ids = ? WHERE user_id = ?').run(Date.now(), JSON.stringify(ids), userId); }
  drop(userId: string) { this.db.prepare('DELETE FROM anime_links WHERE user_id = ?').run(userId); }
}

// ---------- AniList ----------

type ALList = { MediaListCollection: { lists: { entries: { status: string; progress: number; media: { id: number; type: 'ANIME' | 'MANGA'; episodes: number | null; chapters: number | null; title: { english: string | null; romaji: string | null } } }[] }[] } | null };
const LIST_Q = `query ($u: String, $t: MediaType) { MediaListCollection(userName: $u, type: $t) { lists { entries { status progress media { id type episodes chapters title { english romaji } } } } } }`;

export async function anilistList(username: string): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const t of ['ANIME', 'MANGA'] as const) {
    const d = await ask<ALList>(LIST_Q, { u: username, t }, 60_000);
    for (const l of d.MediaListCollection?.lists ?? []) {
      for (const e of l.entries) {
        out.push({ mediaId: e.media.id, title: e.media.title.english ?? e.media.title.romaji ?? '?', kind: e.media.type, status: STATUS_IN[e.status] ?? 'planning', progress: e.progress ?? 0, total: (t === 'ANIME' ? e.media.episodes : e.media.chapters) ?? null });
      }
    }
  }
  return out;
}

export async function anilistUserExists(username: string) {
  const d = await ask<{ User: { id: number; name: string } | null }>('query ($u: String) { User(name: $u) { id name } }', { u: username }, 0).catch(() => null);
  return d?.User?.name ?? null;
}

// the member's own token: who it belongs to, and changes written back to their list
async function withToken<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? `AniList ${res.status}`);
  return body.data;
}
export const viewerOf = (token: string) => withToken<{ Viewer: { name: string } }>(token, 'query { Viewer { name } }', {}).then((d) => d.Viewer.name);
export const saveEntry = (token: string, mediaId: number, status: string, progress: number) =>
  withToken(token, 'mutation ($m: Int, $s: MediaListStatus, $p: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p) { id } }', { m: mediaId, s: STATUS_OUT[status] ?? 'CURRENT', p: progress });

export const anilistLoginUrl = () => (process.env.ANILIST_CLIENT_ID ? `https://anilist.co/api/v2/oauth/authorize?client_id=${process.env.ANILIST_CLIENT_ID}&response_type=token` : null);

// ---------- MyAnimeList ----------

type MalPage = { data: { node: { id: number; title: string; num_episodes?: number; num_chapters?: number }; list_status: { status: string; num_episodes_watched?: number; num_chapters_read?: number } }[]; paging: { next?: string } };

async function malGet(url: string) {
  const id = process.env.MAL_CLIENT_ID;
  if (!id) throw new Error('MAL is not set up');
  const res = await fetch(url, { headers: { 'X-MAL-CLIENT-ID': id }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`MAL ${res.status}`);
  return (await res.json()) as MalPage;
}
export const malReady = () => !!process.env.MAL_CLIENT_ID;
export async function malUserExists(username: string) {
  const p = await malGet(`https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/animelist?limit=1`);
  return p ? username : null;
}

// MAL's ids, turned into AniList's so the rest of Texz (alerts, cards) works the same
async function toAniList(malIds: number[], type: 'ANIME' | 'MANGA') {
  const map = new Map<number, number>();
  for (let i = 0; i < malIds.length; i += 50) {
    const d = await ask<{ Page: { media: { id: number; idMal: number }[] } }>('query ($ids: [Int], $t: MediaType) { Page(perPage: 50) { media(idMal_in: $ids, type: $t) { id idMal } } }', { ids: malIds.slice(i, i + 50), t: type }, 24 * 3600_000);
    for (const m of d.Page.media) map.set(m.idMal, m.id);
  }
  return map;
}

export async function malList(username: string): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const [path, kind] of [['animelist', 'ANIME'], ['mangalist', 'MANGA']] as const) {
    const fields = kind === 'ANIME' ? 'list_status,num_episodes' : 'list_status,num_chapters';
    let url: string | undefined = `https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/${path}?fields=${fields}&limit=1000&nsfw=true`;
    const rows: MalPage['data'] = [];
    for (let n = 0; url && n < 10; n++) {
      const p: MalPage | null = await malGet(url);
      if (!p) break;
      rows.push(...p.data);
      url = p.paging.next;
    }
    const ids = await toAniList(rows.map((r) => r.node.id), kind);
    for (const r of rows) {
      const id = ids.get(r.node.id);
      if (!id) continue;
      out.push({ mediaId: id, title: r.node.title, kind, status: STATUS_IN[r.list_status.status] ?? 'planning', progress: (kind === 'ANIME' ? r.list_status.num_episodes_watched : r.list_status.num_chapters_read) ?? 0, total: (kind === 'ANIME' ? r.node.num_episodes : r.node.num_chapters) || null });
    }
  }
  return out;
}

// ---------- syncing ----------

// the linked list becomes the Texz list; shows being watched get episode alerts, the rest lose them
export async function syncOne(store: Store, userId: string) {
  const links = new Links(store.db);
  const l = links.get(userId);
  if (!l) return null;
  const list = l.site === 'anilist' ? await anilistList(l.username) : await malList(l.username);
  const before = new Set<number>(JSON.parse(l.ids ?? '[]'));
  const now = new Set(list.map((e) => e.mediaId));
  for (const e of list) store.watch({ user_id: userId, media_id: e.mediaId, title: e.title, kind: e.kind, status: e.status, progress: e.progress, total: e.total });
  // gone from their list since the last sync, so it goes here too
  for (const id of before) if (!now.has(id)) { store.unwatch(userId, id); store.unfollow(userId, id); }
  const followed = new Set(store.follows(userId).map((f) => f.media_id));
  for (const e of list.filter((x) => x.kind === 'ANIME')) {
    if (e.status === 'watching' && !followed.has(e.mediaId)) store.follow(userId, e.mediaId, e.title, null, null);
    else if (e.status !== 'watching' && followed.has(e.mediaId) && before.has(e.mediaId)) store.unfollow(userId, e.mediaId);
  }
  links.synced(userId, [...now]);
  return list;
}

export function startLinkSync(store: Store) {
  const tick = async () => {
    for (const l of new Links(store.db).all()) {
      if (l.synced_at && Date.now() - l.synced_at < 3 * 3600_000) continue;
      await syncOne(store, l.user_id).catch((e) => report('anime list sync', e));
    }
  };
  setTimeout(() => void tick(), 60_000).unref?.();
  setInterval(() => void tick(), 30 * 60_000).unref?.();
}
