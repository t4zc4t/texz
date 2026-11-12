import type { Command } from './module.js';

// believable things to type after a command, so every help page shows a real example
export const sample: Record<string, string> = {
  user: '@someone', other: '@friend', amount: '100', minutes: '30', note: 'drink water', title: 'Frieren', name: 'Gojo', day: 'tomorrow',
  season: 'fall', year: '2026', when: '9pm', show: 'Frieren', type: 'manga', question: 'will it rain tomorrow?', options: 'pizza, burger, ramen',
  dice: '2d6', reason: 'spamming links', length: '10m', id: '123456789012345678', hint: 'p_k_ch_', filter: 'best', topic: 'f1', feature: 'birthday',
  what: 'cookie', days: '7', on: 'on', all: 'Best opening? | Unravel | Gurenge', level: '10', date: '14 march', role: '@Gamers', channel: '#general',
  view: 'standings', club: 'Inter Miami', link: '(reply to a message)',
};
const subSample: Record<string, string> = { 'remind': '2h drink water', 'giveaway start': '1d 1 Nitro', 'birthday set': '14 march', 'football fav': 'Inter Miami', 'wish add': 'Gojo', 'xp give': '@someone 500', 'xp level': '@someone 10', 'announce add': '#news 9pm Movie night tonight',
  'roleshop buy': '1', 'roleshop remove': '1', 'roleshop add': '@Gamers 500', 'giveaway end': '3', 'giveaway reroll': '3', 'giveaway cancel': '3', 'announce delete': '2',
  'case view': '12', 'case reason': '12 spamming links', 'case delete': '12', slowmode: '10s', rolepicker: 'Colours', afk: 'eating, back soon', 'backup import': '(attach the file)',
  'mycolour buy': '#c8283c', 'mycolour colour': '#3fa7a3 #e8b04b', 'mycolour name': 'The Demon Prodigy', 'mycolour icon': '🦋' };

// a typed example and the matching slash one, no <x> or [x] to decode
export function examples(c: Command, prefix: string): { label: string; typed: string; slash: string; about?: string }[] {
  const t = c.text ?? {};
  const call = c.call ?? c.name;
  const opts = (c.data.options ?? []) as { name: string; description: string; type: number; options?: { name: string; type: number }[] }[];
  const subs = opts.filter((o) => o.type === 1);
  const fill = (args: string[]) => args.map((a) => sample[a] ?? a).join(' ');
  const slashOf = (sub: string | null, args: string[]) => {
    const base = c.group ? `/${c.group} view:${c.as ?? c.name}` : `/${c.name}${sub ? ` ${sub}` : ''}`;
    if (!args.length) return c.group && sub ? `${base} input:${sub}` : base;
    if (c.group) return `${base} input:${sub ? `${sub} ` : ''}${fill(args)}`;
    return `${base} ${args.map((a) => `${a}:${sample[a] ?? a}`).join(' ')}`;
  };
  if (subs.length) {
    return subs.slice(0, 5).map((sc) => {
      const args = t.subArgs?.[sc.name] ?? [];
      const ex = subSample[`${call} ${sc.name}`] ?? fill(args);
      return { label: sc.name, about: sc.description, typed: `${prefix} ${call} ${sc.name}${ex ? ` ${ex}` : ''}`, slash: slashOf(sc.name, args) };
    });
  }
  const args = t.args ?? [];
  // the required bits, or the first optional one so the example shows what it takes
  const needed = args.filter((a) => (opts.find((o) => o.name === a) as { required?: boolean } | undefined)?.required);
  const ex = c.example ?? subSample[call] ?? fill(needed.length ? needed : args.slice(0, 1));
  const shown = needed.length ? needed : args.slice(0, 1);
  return [{ label: call, typed: `${prefix} ${call}${ex ? ` ${ex}` : ''}`, slash: c.group && ex ? `/${c.group} view:${c.as ?? c.name} input:${ex}` : slashOf(null, shown) }];
}


// what each bit after the command means, for the "type these" lists and help pages
export function argsOf(c: Command, sub?: string): { arg: string; shown: string; about: string; required: boolean }[] {
  const opts = (c.data.options ?? []) as { name: string; description: string; type: number; required?: boolean; options?: { name: string; description: string; type: number; required?: boolean }[] }[];
  const list = sub ? opts.find((o) => o.type === 1 && o.name === sub)?.options ?? [] : opts.filter((o) => o.type !== 1 && o.type !== 2);
  const order = sub ? c.text?.subArgs?.[sub] ?? list.map((o) => o.name) : c.text?.args ?? list.map((o) => o.name);
  return order.map((a) => list.find((o) => o.name === a)).filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({ arg: o.name, shown: o.type === 6 ? '@someone' : o.type === 7 ? '#channel' : o.type === 8 ? '@role' : o.name, about: o.description, required: !!o.required }));
}
