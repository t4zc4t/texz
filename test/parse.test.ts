import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/owo/commands.ts';
import { parseHuntbot, parseInventory, parsePetField, parseWeapon, isCaptcha, flatten } from '../src/owo/parse.ts';
import { advise } from '../src/features/huntbot.ts';
import { planGems } from '../src/features/gems.ts';
import { damageOn } from '../src/features/weapons.ts';

test('commands with both prefixes', () => {
  assert.deepEqual(parseCommand('wh'), { name: 'hunt', args: '' });
  assert.deepEqual(parseCommand('owo hunt'), { name: 'hunt', args: '' });
  assert.deepEqual(parseCommand('wweapon G3JG6F'), { name: 'weapon', args: 'g3jg6f' });
  assert.deepEqual(parseCommand('owo autohunt 2640'), { name: 'huntbot', args: '2640' });
  assert.equal(parseCommand('wrun')?.name, 'run');
  assert.equal(parseCommand('owo')?.name, 'owo');
  assert.equal(parseCommand('what is up'), null);
  assert.equal(parseCommand('who'), null);
});

const hbEmbed = flatten('', [{
  author: "Nyxaroth's HuntBot",
  description: 'BEEP. BOOP. I AM HUNTBOT. I WILL HUNT FOR YOU MASTER.',
  fields: [
    { name: '<:efficiency:1> Efficiency - `60/H`', value: '`Lvl 35`\n`[628/5253]`\n`[■■□□□□]`' },
    { name: '<:duration:1> Duration - `5.5H`', value: '`Lvl 50`\n`[217/7995]`\n`[■□□□□]`' },
    { name: '<:cost:1> Cost - `8 cowoncy`', value: '`Lvl 2 [0/41899]`\n`[□□□□]`' },
    { name: '<:gain:1> Gain - `500 essence/H`', value: '`Lvl 20`\n`[1404/2398]`\n`[■■■■]`' },
    { name: '<:exp:1> Experience - `455 xp/H`', value: '`Lvl 13`\n`[490/1156]`' },
    { name: '<:radar:1> Radar - `0.00003 %`', value: '`Lvl 8`\n`[6059/12150]`' },
    { name: '<:essence:1> Animal Essence - `0`', value: '`Current Max Autohunt: 330 animals, 2,750 essence, and 2,502 xp for 2,640 cowoncy`' },
    { name: '<:bot:1> HUNTBOT is currently hunting!', value: '`BEEP BOOP. I AM STILL HUNTING. I WILL BE BACK IN 2H 33M`\n`53.63% DONE | 177 ANIMALS CAPTURED`' },
  ],
}]);

test('huntbot embed', () => {
  const hb = parseHuntbot(hbEmbed)!;
  assert.equal(hb.traits.efficiency?.level, 35);
  assert.equal(hb.traits.gain?.progress, 1404);
  assert.equal(hb.traits.gain?.needed, 2398);
  assert.equal(hb.traits.cost?.needed, 41899);
  assert.equal(hb.traits.radar?.level, 8);
  assert.equal(hb.essence, 0);
  assert.equal(hb.maxRunCost, 2640);
  assert.equal(hb.backInMs, (2 * 60 + 33) * 60_000);
  assert.equal(hb.percentDone, 53.63);
});

test('huntbot advice picks gain first', () => {
  const a = advise(parseHuntbot(hbEmbed)!);
  assert.equal(a.pick, 'gain');
});

test('inventory with superscript counts', () => {
  const inv = parseInventory('`051`<:cgem1:1>`¹³` `052`<:ugem1:1>`⁰³` `054`<:egem1:1>`⁰²`\n`068`<:egem3:1>`⁰²` `075`<:egem4:1>`⁰²` `065`<:cgem3:1>`⁰⁹` `072`<:cgem4:1>`⁰⁶`');
  assert.equal(inv.get(51), 13);
  assert.equal(inv.get(52), 3);
  assert.equal(inv.get(75), 2);
  const plan = planGems(inv);
  assert.ok(plan.lines.some((l) => l.includes('owo use 54 68 75')));
  assert.ok(plan.lines.some((l) => l.includes('owo use 51 65 72')));
});

test('team pet field', () => {
  const pet = parsePetField({
    name: '[2] <:gfox:1> gfox',
    value: 'Lvl 28\n`[118,236/615,656]`\n<:hp:1> `0724` <:wp:1> `0668`\n<:att:1> `0352` <:mag:1> `0128`\n<:pr:1> `36%` <:mr:1> `46%`\n`G13ZGK` <:mythic:1> 87.4%',
  })!;
  assert.equal(pet.name, 'gfox');
  assert.equal(pet.str, 352);
  assert.equal(pet.mag, 128);
  assert.equal(pet.mr, 46);
  assert.equal(pet.weaponId, 'G13ZGK');
});

test('weapon damage on a pet', () => {
  const w = parseWeapon(flatten('', [{
    title: "Nyxaroth's Great Sword",
    description: '**Name:** Great Sword\n**ID:** `G3JG6F`\n**Quality:** <:m:1> 84.6%\n**Weapon Cost:** 117 <:wp:1>\n\nDeals **51.4%** of your <:att:1> STR to all opponents.\n\n<:ls:1> **Lifesteal** - All damage you deal heals you for **32.8%** of the damage dealt!',
  }]))!;
  assert.equal(w.id, 'G3JG6F');
  assert.equal(w.wpCost, 117);
  assert.equal(w.hits[0].allEnemies, true);
  const d = damageOn(w, { slot: 2, name: 'gfox', level: 28, hp: 724, wp: 668, str: 352, mag: 128, pr: 36, mr: 46, weaponId: null });
  assert.equal(d.perCast, 181);
  assert.equal(d.total, 543);
  assert.equal(d.mismatch, false);
});

test('captcha message', () => {
  assert.ok(isCaptcha('<@1> are you a real human? Please use the link below so I can check!'));
  assert.ok(!isCaptcha('you caught a dog'));
});
