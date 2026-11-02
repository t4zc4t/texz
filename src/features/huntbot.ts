import type { Huntbot, Trait } from '../owo/parse.js';

// max levels from the OwO wiki
export const maxLevel: Record<Trait, number> = {
  efficiency: 215,
  duration: 235,
  cost: 5,
  gain: 200,
  experience: 200,
  radar: 999,
};

export interface Advice {
  pick: Trait | null;
  lines: string[];
}

const left = (hb: Huntbot, t: Trait) => {
  const s = hb.traits[t];
  return s ? Math.max(0, s.needed - s.progress) : Infinity;
};
const maxed = (hb: Huntbot, t: Trait) => (hb.traits[t]?.level ?? 0) >= maxLevel[t];

// Gain pays for every later upgrade, so it goes first. Efficiency runs alongside it,
// whichever of the two is closer to its next level gets the essence. After both are
// maxed, experience levels the team, then duration. Cost and radar barely pay back.
export function advise(hb: Huntbot): Advice {
  const lines: string[] = [];
  let pick: Trait | null = null;

  const gain = hb.traits.gain;
  const eff = hb.traits.efficiency;

  if (gain && eff && !maxed(hb, 'gain') && !maxed(hb, 'efficiency')) {
    const g = left(hb, 'gain');
    const e = left(hb, 'efficiency');
    pick = g <= e * 1.5 ? 'gain' : 'efficiency';
    lines.push(
      `Gain needs ${g.toLocaleString()} more essence for level ${gain.level + 1}, Efficiency needs ${e.toLocaleString()} for level ${eff.level + 1}.`,
    );
    if (pick === 'gain') {
      // roughly 25 essence an hour per Gain level
      const paysBack = Math.ceil(gain.needed / 25);
      lines.push(`Gain is the better buy right now, each level adds about 25 essence an hour and pays itself back in about ${paysBack}h of hunting.`);
    } else {
      lines.push('Efficiency is much closer to its next level, so finish that one first, then go back to Gain.');
    }
  } else if (!maxed(hb, 'gain') && gain) {
    pick = 'gain';
    lines.push('Efficiency is maxed, keep putting everything into Gain.');
  } else if (!maxed(hb, 'efficiency') && eff) {
    pick = 'efficiency';
    lines.push('Gain is maxed, keep putting everything into Efficiency.');
  } else if (hb.traits.experience && !maxed(hb, 'experience')) {
    pick = 'experience';
    lines.push('Gain and Efficiency are done, Experience is next, it levels your team while you are away.');
  } else if (hb.traits.duration && !maxed(hb, 'duration')) {
    pick = 'duration';
    lines.push('Duration is the last useful one, longer runs mean fewer restarts.');
  }

  if (pick && hb.essence !== null) {
    const need = left(hb, pick);
    if (hb.essence >= need) {
      lines.push(`You have ${hb.essence.toLocaleString()} essence, enough for the next ${pick} level: \`owo upgrade ${pick} ${need}\``);
    } else if (hb.essence > 0) {
      lines.push(`You have ${hb.essence.toLocaleString()} essence, put it in anyway, progress carries over: \`owo upgrade ${pick} ${hb.essence}\``);
    } else {
      lines.push('No essence on hand, sacrifice spare commons and uncommons first: `owo sacrifice common uncommon`');
    }
  }

  lines.push('Skip Cost and Radar for now, they cost a lot and give back very little.');
  if (hb.maxRunCost) lines.push(`Your full run costs ${hb.maxRunCost.toLocaleString()} cowoncy: \`owo autohunt ${hb.maxRunCost}\``);
  return { pick, lines };
}
