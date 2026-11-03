// Share links point at a page, embeds need the actual .gif file behind it.
// Giphy keeps the id in the link so the file address is built straight from it, no api needed.
// Tenor's api is gone, so its links are read from the public page as a fallback.

const direct = /^https:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;
const tenorPage = /^https:\/\/tenor\.com\/(?:[a-z-]+\/)?view\/\S+$/i;
const giphyPage = /^https:\/\/(?:www\.)?giphy\.com\/(?:gifs|stickers|clips)\/(?:[\w-]*-)?([A-Za-z0-9]{8,})\/?(?:\?\S*)?$/i;
const giphyMedia = /^https:\/\/(?:media\d*|i)\.giphy\.com\/\S*?([A-Za-z0-9]{8,})(?:\/giphy)?\.(?:gif|webp|mp4)/i;

export function giphyFile(url: string): string | null {
  const id = url.match(giphyPage)?.[1] ?? url.match(giphyMedia)?.[1];
  return id ? `https://media.giphy.com/media/${id}/giphy.gif` : null;
}

export const giphy = (id: string) => `https://giphy.com/gifs/${id}`;

const cache = new Map<string, string>();

// defaults per moment, servers can swap any of them with tz config gif
// one hand-picked gif per moment, only where a gif actually adds something
export const defaults: Record<string, string[]> = {
  // chibi Dazai reading, he's opening the case file for you
  help: [giphy('vcj7xtGMjwr6Kxngl3')],
  // flat on the floor with dizzy eyes, you woke him up
  ping: [giphy('bILqpu1iGcUYlKogLX')],
  // chibi Dazai dancing, saved for welcomes and level ups
  welcome: [giphy('UzGnrtOUKXmdrtja0V')],
  levelup: [giphy('UzGnrtOUKXmdrtja0V')],
  birthday: [giphy('UzGnrtOUKXmdrtja0V')],
  // flat, unimpressed stare
  warn: [giphy('aJ25GJE4LT8fQvvSPr')],
  // the creepy smile with reaching hands, No Longer Human
  timeout: [giphy('99WDYnKHEhfizOW5N3')],
  // smug smile over tea, shown the door politely
  kick: [giphy('NVJBqrqDTcsv86EctI')],
  // lit up in red, dead serious
  ban: [giphy('GpSELI5HJt5FbBUFPa')],
  // a lone figure walking off down a red hallway
  goodbye: [giphy('Waq81Yz6Vw3GuCxGPZ')],
};

// which card kinds show which moment's gif
export const momentOf: Record<string, string> = {
  help: 'help', ping: 'ping', status: 'status', leaderboard: 'leaderboard', ask: 'ask', welcome: 'welcome', levelup: 'levelup', rankUp: 'levelup', warn: 'warn', timeout: 'timeout', kick: 'kick', ban: 'ban', tempban: 'ban', goodbye: 'goodbye', birthday: 'birthday',
};

export const isGifLink = (url: string) => direct.test(url) || tenorPage.test(url) || giphyPage.test(url);

export async function resolve(url: string): Promise<string | null> {
  const g = giphyFile(url);
  if (g) return g;
  if (direct.test(url)) return url;
  if (!tenorPage.test(url)) return null;
  const hit = cache.get(url);
  if (hit) return hit;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
    const html = await res.text();
    // the page lists several sizes, the plain .gif is the one embeds play
    const media = html.match(/https:\/\/media\d*\.tenor\.com\/[^"'\s]+?\.gif/)?.[0];
    if (media) cache.set(url, media);
    return media ?? null;
  } catch {
    return null;
  }
}

// sync lookup for building cards, only what's already resolved
export const cached = (url: string | null | undefined) => (!url ? null : giphyFile(url) ?? (direct.test(url) ? url : cache.get(url) ?? null));

export const pickDefault = (moment: string) => {
  const list = defaults[moment];
  return list?.length ? list[Math.floor(Math.random() * list.length)] : null;
};

export async function warmUp(extra: string[] = []) {
  const all = [...Object.values(defaults).flat(), ...extra];
  const got = await Promise.all(all.map(resolve));
  return got.filter(Boolean).length;
}
