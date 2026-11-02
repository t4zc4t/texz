import { EmbedBuilder } from 'discord.js';

// sand coat, the colour everything wears
export const COLOR = 0xc2a46e;
export const DARK = 0x3b3128;
export const RED = 0xb5523b;

export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export const embed = (title?: string) => {
  const e = new EmbedBuilder().setColor(COLOR);
  return title ? e.setTitle(title) : e;
};

// the voice, playful and a little lazy, never cruel
export const lines = {
  off: [
    'That one is switched off here. Someone with the keys decided we needed a nap.',
    'Not here, I\'m afraid. This server turned that off, and I\'m happy to rest.',
  ],
  wrongChannel: (where: string) => pick([
    `Wrong room. Try it in ${where}, I'll be waiting there, probably lying down.`,
    `I only answer that in ${where}. Rules, sadly, even I follow some.`,
  ]),
  noRole: [
    'You need a certain role for that one. I don\'t make the rules, I just enjoy them.',
    'That\'s for a select few. Not you, not today.',
  ],
  noPerm: [
    'You\'d need Manage Server for that. Nice try though.',
    'Admin business. Fetch an admin, I\'ll wait.',
  ],
  error: [
    'Something slipped. Even a genius trips sometimes, try again in a bit.',
    'That broke on my side. How embarrassing, try once more.',
  ],
  unknown: [
    'I don\'t know that one. `tz help` has everything I do.',
  ],
};
