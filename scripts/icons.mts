// draws the icon set Texz uploads as its own emojis. Lucide shapes (ISC), Agency colours
// run: npx tsx scripts/icons.mts <path to lucide-static/icons>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const SAND = '#C8A97E';
const RED = '#E8475B';
const GREEN = '#6BBF8E';
const BONE = '#EDE6DA';

// our name: [lucide icon, colour]
export const SET: Record<string, [string, string]> = {
  yen: ['japanese-yen', SAND], wallet: ['wallet', SAND], vault: ['vault', SAND], worth: ['gem', SAND], streak: ['flame', RED],
  gift: ['gift', SAND], wait: ['hourglass', SAND], clock: ['clock', SAND], yes: ['check', GREEN], no: ['x', RED],
  ok: ['circle-check', GREEN], fail: ['circle-x', RED], crown: ['crown', SAND], trophy: ['trophy', SAND], dice: ['dice-5', BONE],
  coin: ['coins', SAND], work: ['briefcase', SAND], crime: ['skull', RED], fish: ['fish', SAND], beg: ['hand-coins', SAND],
  rob: ['hand-grab', RED], heist: ['venetian-mask', SAND], ticket: ['ticket', SAND], wheel: ['circle-dot', RED], rps: ['scissors', BONE],
  people: ['users', SAND], person: ['user', SAND], online: ['radio', GREEN], voice: ['mic', SAND], chat: ['message-square', SAND],
  door: ['door-open', SAND], boost: ['rocket', SAND], shield: ['shield', SAND], cake: ['cake', SAND], hall: ['landmark', SAND],
  roles: ['tags', SAND], date: ['calendar-days', SAND], notebook: ['notebook-pen', SAND], eye: ['eye', SAND], lock: ['lock', RED],
  unlock: ['lock-open', GREEN], star: ['star', SAND], spark: ['sparkles', SAND], bell: ['bell', SAND], info: ['info', SAND],
  next: ['arrow-right', SAND], mail: ['mail', SAND], moon: ['moon', SAND], zap: ['zap', SAND], heart: ['heart', RED],
  bot: ['bot', SAND], target: ['crosshair', RED], ban: ['ban', RED], mute: ['mic-off', RED], deaf: ['ear-off', RED],
  hangup: ['phone-off', RED], move: ['move', SAND], duel: ['swords', RED], scroll: ['scroll', SAND], quill: ['feather', SAND],
  search: ['search', SAND], award: ['award', SAND], gauge: ['gauge', SAND],
  tv: ['tv', SAND], detective: ['scan-eye', SAND], football: ['goal', SAND], medal: ['medal', SAND], edit: ['pencil-line', SAND],
  flag: ['flag', SAND], list: ['clipboard-list', SAND], sweep: ['brush-cleaning', SAND], magic: ['wand-sparkles', SAND], announce: ['megaphone', SAND],
  palette: ['palette', SAND], plus: ['plus', GREEN], minus: ['minus', RED], car: ['car', SAND], film: ['clapperboard', SAND],
  reel: ['film', SAND], flower: ['flower-2', SAND], news: ['newspaper', SAND], trash: ['trash-2', RED], folder: ['folder', SAND],
  image: ['image', SAND], puzzle: ['puzzle', SAND], pin: ['map-pin', RED], chart: ['chart-line', SAND], paw: ['paw-print', SAND],
  cards: ['spade', BONE], alarm: ['alarm-clock', SAND], shop: ['shopping-bag', SAND], vote: ['vote', SAND], archive: ['archive', SAND],
  candle: ['flame-kindling', SAND], hammer: ['hammer', RED], wrench: ['wrench', SAND], hash: ['hash', SAND], party: ['party-popper', SAND],
  bandage: ['bandage', SAND], pray: ['hand-heart', SAND], sword: ['sword', RED], again: ['repeat', SAND], refresh: ['refresh-cw', SAND],
  popcorn: ['popcorn', SAND], warn: ['triangle-alert', RED], keys: ['keyboard', SAND], hmm: ['message-circle-question', SAND],
  quiet: ['bell-off', SAND], loud: ['volume-2', SAND], inbox: ['inbox', SAND], send: ['send', SAND], book: ['book-open', SAND],
  wave: ['hand', SAND], sliders: ['sliders-horizontal', SAND], sunrise: ['sunrise', SAND], new: ['badge-plus', GREEN], back: ['arrow-left', SAND],
  deal: ['handshake', SAND], dna: ['dna', SAND], drink: ['martini', SAND], home: ['house', SAND], receipt: ['receipt', SAND],
  map: ['map', SAND], link: ['link', SAND], boom: ['bomb', RED], brain: ['brain', SAND], pinned: ['pin', SAND], shuffle: ['shuffle', SAND],
  box: ['package', SAND], game: ['gamepad-2', SAND], globe: ['globe', SAND], gear: ['settings', SAND], pause: ['pause', SAND],
  stop: ['square', SAND], skip: ['skip-forward', SAND], prev: ['skip-back', SAND], help: ['circle-help', SAND], scale: ['scale', SAND],
  grad: ['graduation-cap', SAND], bookmark: ['bookmark', SAND], compass: ['compass', SAND], hundred: ['badge-check', GREEN], like: ['thumbs-up', SAND],
  strong: ['biceps-flexed', SAND], plane: ['plane', SAND], snow: ['snowflake', SAND], dove: ['bird', SAND], slow: ['turtle', SAND],
  luck: ['clover', GREEN], kick: ['log-out', RED], idcard: ['id-card', SAND], camera: ['camera', SAND], ghost: ['ghost', SAND],
  steps: ['footprints', SAND], join: ['user-round-plus', GREEN], leave: ['user-round-minus', RED], tasks: ['list-checks', SAND],
  sched: ['calendar-clock', SAND], letter: ['mail-open', SAND], sweet: ['candy', SAND], slice: ['cake-slice', SAND], glasses: ['glasses', SAND],
  gold: ['medal', '#E0B44C'], silver: ['medal', '#C9C9C9'], bronze: ['medal', '#B8794A'],
  green: ['dot', GREEN], red: ['dot', RED], yellow: ['dot', '#E0B44C'], black: ['dot', '#6B6460'], white: ['dot', BONE], purple: ['dot', '#9B7AD1'], orange: ['dot', '#E0901F'], blue: ['dot', '#5B8FD1'],
};

// Pokémon types, each in its own colour, kept apart in assets/types-line
export const TYPES: Record<string, [string, string]> = {
  normal: ['circle', '#B5B48C'], fire: ['flame', '#EE8130'], water: ['droplet', '#6390F0'], grass: ['leaf', '#7AC74C'],
  electric: ['zap', '#F7D02C'], ice: ['snowflake', '#96D9D6'], fighting: ['hand-fist', '#E0504A'], poison: ['flask-conical', '#C266C0'],
  ground: ['mountain', '#E2BF65'], flying: ['feather', '#A98FF3'], psychic: ['eye', '#F95587'], bug: ['bug', '#A6B91A'],
  rock: ['gem', '#B6A136'], ghost: ['ghost', '#9A7CC4'], dragon: ['crown', '#8C63FF'], dark: ['moon', '#A08670'],
  steel: ['cog', '#B7B7CE'], fairy: ['sparkles', '#D685AD'],
};

const dir = process.argv[2];
mkdirSync('assets/icons', { recursive: true });
for (const [name, [icon, colour]] of Object.entries(SET)) {
  if (icon === 'dot') {
    // status dots are drawn, a filled circle with a soft ring
    const c = createCanvas(128, 128);
    const x = c.getContext('2d');
    x.fillStyle = colour; x.beginPath(); x.arc(64, 64, 34, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 0.35; x.lineWidth = 8; x.strokeStyle = colour; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.stroke();
    writeFileSync(`assets/icons/${name}.png`, c.toBuffer('image/png'));
    continue;
  }
  const svg = readFileSync(`${dir}/${icon}.svg`, 'utf8').replace(/<!--.*?-->/s, '').replace(/currentColor/g, colour).replace(/stroke-width="2"/, 'stroke-width="2.25"').replace(/width="24"\s+height="24"/, 'width="128" height="128"');
  const img = await loadImage(Buffer.from(svg));
  const c = createCanvas(128, 128);
  c.getContext('2d').drawImage(img, 4, 4, 120, 120);
  writeFileSync(`assets/icons/${name}.png`, c.toBuffer('image/png'));
}
mkdirSync('assets/types-line', { recursive: true });
for (const [name, [icon, colour]] of Object.entries(TYPES)) {
  const svg = readFileSync(`${dir}/${icon}.svg`, 'utf8').replace(/<!--.*?-->/s, '').replace(/currentColor/g, colour).replace(/stroke-width="2"/, 'stroke-width="2.25"').replace(/width="24"\s+height="24"/, 'width="128" height="128"');
  const img = await loadImage(Buffer.from(svg));
  const c = createCanvas(128, 128);
  c.getContext('2d').drawImage(img, 4, 4, 120, 120);
  writeFileSync(`assets/types-line/${name}.png`, c.toBuffer('image/png'));
}
console.log(Object.keys(SET).length, 'icons,', Object.keys(TYPES).length, 'types');
