import type { Store } from '../db.js';
import { mediaById, titleOf } from './anilist.js';

// keeps one reminder queued per followed show, at the time its next episode airs
export function watchEpisodes(store: Store) {
  const check = async () => {
    const ids = [...new Set(store.follows().map((f) => f.media_id))];
    for (const id of ids) {
      const m = await mediaById(id).catch(() => null);
      if (!m) continue;
      for (const f of store.follows().filter((x) => x.media_id === id)) {
        const next = m.nextAiringEpisode;
        if (!next) {
          // finished airing, nothing more to wait for
          if (m.status === 'FINISHED') store.unfollow(f.user_id, id);
          continue;
        }
        const at = next.airingAt * 1000;
        store.follow(f.user_id, id, titleOf(m), at, f.channel_id);
        const queued = store.reminderOf(f.user_id, `ep:${id}`);
        if (!queued || queued.due_at !== at) {
          store.setReminder(f.user_id, `ep:${id}`, new Date(at), `${titleOf(m)}|${next.episode}|${m.siteUrl}`, f.channel_id);
        }
      }
    }
  };
  void check();
  setInterval(() => void check(), 60 * 60_000);
}
