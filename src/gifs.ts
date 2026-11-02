// Tenor share links point at a page, embeds need the actual .gif file behind it.
// Texz looks the file up once and remembers it.

const direct = /^https:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;
const tenorPage = /^https:\/\/tenor\.com\/(?:[a-z-]+\/)?view\/\S+$/i;

const cache = new Map<string, string>();

// defaults per moment, servers can swap any of them with tz config gif
export const defaults: Record<string, string[]> = {
  help: ['https://tenor.com/view/dazai-osamu-dazai-dazai-osamu-bsd-bungo-stray-dogs-gif-13950935552741604206'],
  status: ['https://tenor.com/view/osamu-dazai-dazai-osamu-dazai-bsd-bungou-stray-dogs-gif-8005754592498114340'],
  ping: ['https://tenor.com/view/dazai-dazai-osamu-osamu-dazai-bungo-stray-dogs-bsd-gif-27476630'],
  error: ['https://tenor.com/view/dazai-osamu-dazai-osamu-dazai-bsd-bungo-stray-dogs-gif-5687204305493565288'],
  welcome: ['https://tenor.com/view/dazai-dazai-osamu-dazai-chibi-osamu-bungou-gif-9846613305180712149'],
};

// which card kinds show which moment's gif
export const momentOf: Record<string, string> = {
  help: 'help', status: 'status', ping: 'ping', error: 'error', missing: 'error', leaderboard: 'leaderboard',
  huntbot: 'huntbot', ask: 'ask',
};

export const isGifLink = (url: string) => direct.test(url) || tenorPage.test(url);

export async function resolve(url: string): Promise<string | null> {
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
export const cached = (url: string | null | undefined) => (!url ? null : direct.test(url) ? url : cache.get(url) ?? null);

export const pickDefault = (moment: string) => {
  const list = defaults[moment];
  return list?.length ? list[Math.floor(Math.random() * list.length)] : null;
};

export async function warmUp(extra: string[] = []) {
  const all = [...Object.values(defaults).flat(), ...extra];
  const got = await Promise.all(all.map(resolve));
  return got.filter(Boolean).length;
}
