import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberAfter, parseQuestLog, parseWeaponList, parseZoo, weaponType } from '../src/owo/parse.ts';
import { planZoo } from '../src/features/zoo.ts';
import { armouryReport } from '../src/features/armoury.ts';

// trimmed copies of real OwO replies
const zoo = `🌿 🌱 🌳** Someone's zoo! **🌳 🌿 🌱
<:common:416520037713838081>   :bee:¹¹  :bug:⁰⁸  :snail:¹³  :beetle:⁰⁹  :butterfly:¹⁴  
<:uncommon:416520056269176842>   :baby_chick:⁰⁹  :mouse2:⁰²  :rooster:⁰⁵  :rabbit2:⁰⁸  :chipmunk:⁰⁸  
<:rare:416520066629107712>   :sheep:¹⁶  :pig2:¹³  :cow2:¹⁵  :dog2:¹⁰  :cat2:¹³  
<:epic:416520722987614208>   :crocodile:⁰¹  :tiger2:⁰²  :penguin:⁰²  :elephant:⁰⁰  :whale:⁰³  
<:special:427935192137859073>    <a:2026oct_bean:1556949354454065162>⁰⁰  
<:mythic:416520808501084162>   :dragon:⁰⁰  :unicorn:⁰⁰  :snowman2:⁰⁰  :ghost:⁰⁰  :dove:⁰⁰  
<a:gem:510023576489951232>    <a:gcamel:510023576573837322>⁰⁰  <a:gspider:510023576775032844>⁰⁰  
<a:legendary:417955061801680909>    <a:gdeer:418290217989046274>⁰⁰  <a:gowl:418284974593277954>⁰⁰
**Zoo Points: __642,655__**`;

const list = "`G3JG6F` <:mythic:416520808501084162><:mgreatsword:535279249125539858><:mlifesteal:548729400078893057> **Great Sword** 84.6% ➤  <a:gfox:418291892376305664> gfox\n" +
  "`G3F4FS` <:rare:416520066629107712><:rgreatsword:535279249129472014><:ukkaze:619834825486106624> **Great Sword [0]** 42%\n" +
  "`G39XPV` <:rare:416520066629107712><:rbow:535283613374349316><:lsnail:1107928501148975125> **Bow** 51.6%\n" +
  "`G39XUD` <:rare:416520066629107712><:brwoundb:1473904260881317982><:eswarm:1449614480731275335><:ewgen:621558018365980712> **Empowered Wounding Crossbow [1]** 59.5%\n" +
  "`G2QHWC` <:mythic:416520808501084162><:mestaff:572984069915279380><:ldischarge:572285187023699988> **Energy Staff** 83.3%\n" +
  "`FYGARW` <:epic:416520722987614208><:eawand:572620164361617408><:rabsolve:562175425556774912> **Wand of Absorption [60]** 65.7% ➤  :cat2: cat";

test('zoo counts per rank', () => {
  const z = parseZoo(zoo)!;
  assert.equal(z.common, 55);
  assert.equal(z.uncommon, 32);
  assert.equal(z.rare, 67);
  assert.equal(z.epic, 8);
  assert.equal(z.mythic, 0);
  const plan = planZoo(z, null).join('\n');
  assert.match(plan, /owo sacrifice common uncommon rare epic/);
});

test('weapon list rows', () => {
  const rows = parseWeaponList(list);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { id: 'G3JG6F', rarity: 'mythic', name: 'Great Sword', quality: 84.6, equippedOn: 'gfox', empowered: false });
  assert.equal(rows[5].equippedOn, 'cat');
  assert.equal(rows[3].empowered, true);
  assert.equal(weaponType(rows[3].name), 'Wounding Crossbow');
  assert.equal(weaponType('Fine Resurrection Staff [477]'), 'Resurrection Staff');
});

test('armoury keeps the good stuff', () => {
  const team = [{ slot: 2, name: 'gfox', level: 28, hp: 724, wp: 668, str: 352, mag: 128, pr: 36, mr: 46, weaponId: 'G3JG6F' }];
  const out = armouryReport(parseWeaponList(list), team, new Map(), 2673).join('\n');
  // the weaker rare great sword can go, the only bow and the empowered crossbow stay
  assert.match(out, /G3F4FS/);
  assert.doesNotMatch(out.split('Safe to dismantle')[1] ?? '', /G39XPV|G39XUD|G3JG6F/);
  assert.match(out, /gfox \(STR\): `G3JG6F`/);
});

test('plain replies', () => {
  assert.equal(numberAfter('**<:weaponshard:1> | Someone**, you currently have **2,673** Weapon Shards!', /have\s+([\d,]+)\s+Weapon Shards/i), 2673);
  assert.equal(numberAfter('<:cowoncy:1> **| Someone**, you currently have **__100,345__ cowoncy!**', /have\s+([\d,]+)\s+cowoncy/i), 100345);
  assert.equal(numberAfter('Someone! You currently have **32** cookies! Yummy!', /have\s+([\d,]+)\s+cookies?/i), 32);
});

test('quest log', () => {
  assert.deepEqual(parseQuestLog("### 📜 <@1>'s Quest Log\nUwU You finished all of your quests! Come back tomorrow! <3"), { allDone: true, lines: [] });
  const q = parseQuestLog("### 📜 <@1>'s Quest Log\n-# Balance: **78**\nReceive 2 cookies from friends (0/2)\nSay owo 10 times (3/10)\nDaily\nClaim")!;
  assert.deepEqual(q.lines, ['Receive 2 cookies from friends (0/2)', 'Say owo 10 times (3/10)']);
});
