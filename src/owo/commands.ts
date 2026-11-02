// OwO answers to "owo" and the short "w" prefix, with or without a space
const aliases: Record<string, string> = {
  hunt: 'hunt', h: 'hunt', catch: 'hunt',
  battle: 'battle', b: 'battle', fight: 'battle',
  pray: 'pray',
  curse: 'curse',
  daily: 'daily',
  vote: 'vote',
  quest: 'quest', q: 'quest',
  cookie: 'cookie', rep: 'cookie',
  checklist: 'checklist', cl: 'checklist', task: 'checklist', tasks: 'checklist',
  autohunt: 'huntbot', huntbot: 'huntbot', hb: 'huntbot', ah: 'huntbot',
  inventory: 'inv', inv: 'inv',
  team: 'team',
  weapon: 'weapon', w: 'weapon', weapons: 'weapon',
  zoo: 'zoo', z: 'zoo',
  cowoncy: 'cash', cash: 'cash', money: 'cash', balance: 'cash', bal: 'cash',
  lootbox: 'lootbox', lb: 'lootbox',
  crate: 'crate', wc: 'crate',
  ws: 'ws', weaponshard: 'ws',
  sacrifice: 'sacrifice', sac: 'sacrifice',
  upgrade: 'upgrade', up: 'upgrade',
  alastor: 'alastor',
  babyyoda: 'babyyoda',
  piku: 'piku',
  run: 'run',
  puppy: 'puppy', pup: 'puppy',
};

export const minigames = ['alastor', 'babyyoda', 'piku', 'run', 'puppy'] as const;

export interface OwoCommand {
  name: string;
  args: string;
}

export function parseCommand(content: string): OwoCommand | null {
  const text = content.trim().toLowerCase();
  if (text === 'owo' || text === 'uwu') return { name: 'owo', args: '' };
  const m = text.match(/^(owo|w)\s*([a-z0-9]+)\s*(.*)$/s);
  if (!m) return null;
  const name = aliases[m[2]];
  if (!name) return null;
  return { name, args: m[3] };
}
