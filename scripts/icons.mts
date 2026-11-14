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
};

const dir = process.argv[2];
mkdirSync('assets/icons', { recursive: true });
for (const [name, [icon, colour]] of Object.entries(SET)) {
  const svg = readFileSync(`${dir}/${icon}.svg`, 'utf8').replace(/<!--.*?-->/s, '').replace(/currentColor/g, colour).replace(/stroke-width="2"/, 'stroke-width="2.25"').replace(/width="24"\s+height="24"/, 'width="128" height="128"');
  const img = await loadImage(Buffer.from(svg));
  const c = createCanvas(128, 128);
  c.getContext('2d').drawImage(img, 4, 4, 120, 120);
  writeFileSync(`assets/icons/${name}.png`, c.toBuffer('image/png'));
}
console.log(Object.keys(SET).length, 'icons');
