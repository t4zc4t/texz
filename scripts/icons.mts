// draws the icon set Texz uploads as its own emojis. Lucide shapes (ISC), Agency colours
// run: npx tsx scripts/icons.mts <path to lucide-static/icons>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas';

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
  normal: ['circle-dot', '#9FA19F'], fire: ['flame', '#EE8130'], water: ['droplet', '#6390F0'], grass: ['leaf', '#7AC74C'],
  electric: ['zap', '#E6B800'], ice: ['snowflake', '#5FC8C4'], fighting: ['hand-fist', '#C22E28'], poison: ['flask-conical', '#A33EA1'],
  ground: ['ground', '#B5784A'], flying: ['flying', '#6FA8EC'], psychic: ['eye', '#F95587'], bug: ['bug', '#A6B91A'],
  rock: ['rock', '#A8932E'], ghost: ['ghost', '#735797'], dragon: ['file:sea-dragon', '#6F35FC'], dark: ['moon', '#705746'],
  steel: ['cog', '#8E9AAD'], fairy: ['sparkles', '#D46BA8'],
};

// drawn glyphs for types that have no clear stock icon
// a glyph is a list of steps on a 24 grid: fill a shape, or carve a line / outline out of what is drawn
type Step = { f: string } | { c: string; w: number } | { o: string; w: number };
const GLYPHS: Record<string, Step[]> = {
  flying: [{ f: 'M2 11 C5.5 6 12.5 3 22 2 L14.6 6.6 L21.4 6 L13.6 10.2 L20 10.4 L12.2 14 L17.6 14.8 L9 18.4 C5 18.8 2 16 2 11 Z' }],
  ground: [{ f: 'M1.5 20.5 L8.3 7 L11.3 11.4 L15.1 4.8 L22.5 20.5 Z' },
    { c: 'M0 12.6 Q6 10.6 12 12.2 T24 11.6', w: 1.5 }, { c: 'M0 16.8 Q6 15 12 16.6 T24 16', w: 1.5 }],
  rock: [{ f: 'M2.2 20.5 L2.6 14.2 L5.4 10.8 L9 12 L9 20.5 Z' },
    { o: 'M8 20.5 L7.6 10 L11 5.4 L17.6 4.4 L21.6 9 L21.8 17 L19.6 20.5 Z', w: 2.2 },
    { f: 'M8 20.5 L7.6 10 L11 5.4 L17.6 4.4 L21.6 9 L21.8 17 L19.6 20.5 Z' },
    { c: 'M11 5.6 L12.6 11 L11.6 20.5 M12.6 11 L17.6 10 L21.6 9 M17.6 4.6 L17.6 10', w: 1.1 }],
};
function glyph(steps: Step[], s: number) {
  const c = createCanvas(Math.ceil(24 * s), Math.ceil(24 * s));
  const k = c.getContext('2d');
  k.scale(s, s); k.fillStyle = '#fff'; k.lineCap = 'round'; k.lineJoin = 'round';
  for (const st of steps) {
    if ('f' in st) { k.globalCompositeOperation = 'source-over'; k.fill(new Path2D(st.f)); continue; }
    k.globalCompositeOperation = 'destination-out'; k.lineWidth = st.w;
    k.stroke(new Path2D('c' in st ? st.c : st.o));
  }
  return c;
}
// draws a white glyph so its visible shape sits in the middle of the badge
function centred(x: any, g: any, fit: number) {
  const { width: w, height: h } = g;
  const px = g.getContext('2d').getImageData(0, 0, w, h).data;
  let l = w, t = h, r = 0, b = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (px[(y * w + i) * 4 + 3] > 24) { l = Math.min(l, i); r = Math.max(r, i); t = Math.min(t, y); b = Math.max(b, y); }
  const s = fit / Math.max(r - l + 1, b - t + 1);
  const dw = (r - l + 1) * s, dh = (b - t + 1) * s;
  x.drawImage(g, l, t, r - l + 1, b - t + 1, 64 - dw / 2, 64 - dh / 2, dw, dh);
}
// lighter or darker by a fraction, for the badge gradient
function shade(hex: string, by: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, by > 0 ? v + (255 - v) * by : v * (1 + by))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

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
// each type is a finished badge: a disc in the type's colour with a soft light from the top, the symbol in white
mkdirSync('assets/types-line', { recursive: true });
for (const [name, [icon, colour]] of Object.entries(TYPES)) {
  const c = createCanvas(128, 128);
  const x = c.getContext('2d');
  const disc = x.createLinearGradient(0, 8, 0, 120);
  disc.addColorStop(0, shade(colour, 0.18));
  disc.addColorStop(1, shade(colour, -0.22));
  x.fillStyle = disc;
  x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill();
  // a thin darker rim keeps it crisp on light and dark themes
  x.lineWidth = 4; x.strokeStyle = shade(colour, -0.35);
  x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.stroke();
  if (GLYPHS[icon]) centred(x, glyph(GLYPHS[icon], 12), 66);
  else if (icon.startsWith('file:')) {
    const art = createCanvas(512, 512);
    art.getContext('2d').drawImage(await loadImage(readFileSync(`assets/glyphs/${icon.slice(5)}.svg`)), 0, 0, 512, 512);
    centred(x, art, 70);
  } else {
    const svg = readFileSync(`${dir}/${icon}.svg`, 'utf8').replace(/<!--.*?-->/s, '').replace(/currentColor/g, '#FFFFFF').replace(/stroke-width="2"/, 'stroke-width="2.4"').replace(/width="24"\s+height="24"/, 'width="128" height="128"');
    x.drawImage(await loadImage(Buffer.from(svg)), 30, 30, 68, 68);
  }
  writeFileSync(`assets/types-line/${name}.png`, c.toBuffer('image/png'));
}
console.log(Object.keys(SET).length, 'icons,', Object.keys(TYPES).length, 'types');
