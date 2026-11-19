import type { Store } from '../db.js';

// channels that are for one thing: the bulletins, the count, the evidence board, the giveaways, the quote wall.
// Commands and games don't run there, they get sent to the yen counter (or general) so the feed stays readable
export function feedOf(store: Store, guild: string | null, channel: string): string | null {
  if (!guild) return null;
  const b = store.guild(guild).bulletins;
  if (b.f1.channel === channel) return 'the paddock bulletins';
  if (b.football.channel === channel) return 'the football bulletins';
  if (b.anime.channel === channel) return 'the anime bulletins';
  if (store.getKv(`mediach:${guild}`) === channel) return 'the evidence board';
  if ((JSON.parse(store.getKv(`count:${guild}`) ?? '{}') as { channel?: string }).channel === channel) return 'the count';
  if (store.getKv(`gwdaily:${guild}`) === channel) return 'the giveaways';
  if (store.guild(guild).quotes.channel === channel) return 'the quote wall';
  if (store.guild(guild).starboard.channel === channel) return 'the starboard';
  return null;
}

// where to go instead: the economy channel, then general
export function playHere(store: Store, guild: string): string | null {
  return store.rules(guild, 'economy').channels[0] ?? store.getKv(`generalch:${guild}`) ?? null;
}
