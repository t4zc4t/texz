import type { Huntbot, ZooRank } from '../owo/parse.js';

// sell price in cowoncy and sacrifice value in essence per animal, from the OwO wiki
export const values: Record<ZooRank, { sell: number; sac: number; label: string }> = {
  common: { sell: 1, sac: 1, label: 'common' },
  uncommon: { sell: 3, sac: 5, label: 'uncommon' },
  rare: { sell: 10, sac: 20, label: 'rare' },
  epic: { sell: 250, sac: 250, label: 'epic' },
  mythic: { sell: 5000, sac: 3000, label: 'mythical' },
  special: { sell: 6000, sac: 5000, label: 'special' },
  patreon: { sell: 1000, sac: 500, label: 'patreon' },
  legendary: { sell: 15000, sac: 10000, label: 'legendary' },
  gem: { sell: 30000, sac: 20000, label: 'gem' },
  bot: { sell: 50000, sac: 10000, label: 'bot' },
  cpatreon: { sell: 50000, sac: 25000, label: 'custom patreon' },
  fabled: { sell: 250000, sac: 100000, label: 'fabled' },
  distorted: { sell: 300000, sac: 200000, label: 'distorted' },
  hidden: { sell: 1000000, sac: 500000, label: 'hidden' },
};

// owo sell/sacrifice take these words for a whole rank
const rankWord: Partial<Record<ZooRank, string>> = {
  common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', mythic: 'mythical',
  legendary: 'legendary', gem: 'gem', special: 'special', fabled: 'fabled',
};

export function planZoo(zoo: Partial<Record<ZooRank, number>>, hb: Huntbot | null): string[] {
  const lines: string[] = [];
  const gainMaxed = (hb?.traits.gain?.level ?? 0) >= 200 && (hb?.traits.efficiency?.level ?? 0) >= 215;
  let essence = 0;
  let cash = 0;
  const sac: string[] = [];
  const sell: string[] = [];

  for (const [rank, n] of Object.entries(zoo) as [ZooRank, number][]) {
    if (!n) continue;
    const v = values[rank];
    // essence builds the huntbot, so it wins until the huntbot is done,
    // except when selling pays a lot more than sacrificing
    const sellIt = gainMaxed || v.sell >= v.sac * 2;
    if (sellIt) { cash += n * v.sell; sell.push(rankWord[rank] ?? rank); }
    else { essence += n * v.sac; sac.push(rankWord[rank] ?? rank); }
    lines.push(`${v.label}: **${n}** spare → ${sellIt ? `${(n * v.sell).toLocaleString()} cowoncy if sold` : `${(n * v.sac).toLocaleString()} essence if sacrificed`}`);
  }

  if (!lines.length) return ['Nothing spare in your zoo right now, every count is at zero.'];
  lines.push('');
  if (sac.length) lines.push(`Sacrifice: \`owo sacrifice ${sac.join(' ')}\` for about **${essence.toLocaleString()} essence**`);
  if (sell.length) lines.push(`Sell: \`owo sell ${sell.join(' ')}\` for about **${cash.toLocaleString()} cowoncy**`);
  lines.push('Your pets stay in the zoo either way, only the spare copies go.');

  const gain = hb?.traits.gain;
  if (gain && essence) {
    const left = gain.needed - gain.progress;
    lines.push(essence >= left
      ? `That's enough for the next Gain level (needs ${left.toLocaleString()}).`
      : `That covers ${Math.round((essence / left) * 100)}% of the next Gain level.`);
  }
  return lines;
}
