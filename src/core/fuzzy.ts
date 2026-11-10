// small helpers for "did you mean" and plain word search in help

// edits between two words, a swap of two neighbouring letters counts as one ("rnak" is one away from "rank")
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// the nearest word from a list, only if it's close enough to be a typo
export function closest(word: string, words: Iterable<string>): string | null {
  if (word.length < 3) return null;
  const limit = word.length <= 5 ? 1 : 2;
  let best: string | null = null;
  let bestD = Infinity;
  for (const w of words) {
    const d = distance(word, w);
    if (d < bestD || (d === bestD && best && w.length < best.length)) { best = w; bestD = d; }
  }
  return bestD <= limit ? best : null;
}

// words people use that aren't in any command description
const synonyms: Record<string, string[]> = {
  money: ['wallet', 'balance'], cash: ['wallet', 'balance'], coins: ['wallet', 'balance'], bank: ['wallet'],
  ping: ['pings', 'notify'], notify: ['pings'], alert: ['alerts', 'pings'], notification: ['pings'],
  bday: ['birthday'], birth: ['birthday'], level: ['rank', 'xp'], xp: ['rank', 'level'],
  pfp: ['avatar'], picture: ['avatar', 'quote'], medal: ['achievements', 'badges'], badge: ['achievements', 'badges'],
  timer: ['remind', 'reminders'], reminder: ['remind', 'reminders'], pokemon: ['pokétwo', 'spawns', 'pokemon'],
  race: ['f1', 'grand prix'], formula: ['f1'], soccer: ['football'], match: ['football', 'ship'],
  mute: ['timeout'], delete: ['purge'], clear: ['purge'], schedule: ['announce', 'airing'], episode: ['airing', 'alerts'],
};

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const stop = new Set(['the', 'me', 'my', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'is', 'how', 'do', 'what', 'where', 'can', 'in', 'on', 'it', 'with']);

export interface Doc { id: string; names: string[]; text: string }

// scores every command against the words typed: names count most, then the description
export function search(query: string, docs: Doc[], limit = 6): { id: string; score: number }[] {
  const q = words(query).filter((w) => !stop.has(w));
  const terms = [...new Set(q.flatMap((w) => [w, ...(synonyms[w] ?? [])]))];
  if (!terms.length) return [];
  return docs.map((d) => {
    const names = d.names.map((n) => n.toLowerCase());
    const body = words(d.text);
    let score = 0;
    for (const t of terms) {
      const direct = q.includes(t) ? 1 : 0.6;
      if (names.includes(t)) score += 10 * direct;
      else if (names.some((n) => n.startsWith(t) || t.startsWith(n) && n.length > 2)) score += 5 * direct;
      else if (names.some((n) => distance(n, t) <= (t.length > 4 ? 2 : 1))) score += 3 * direct;
      if (body.includes(t)) score += 2 * direct;
      else if (t.length > 3 && body.some((b) => b.startsWith(t))) score += 1 * direct;
    }
    return { id: d.id, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
