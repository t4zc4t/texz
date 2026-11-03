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

test('armoury pages, filters and buttons', async () => {
  const { Store } = await import('../src/db.ts');
  const { armouryPage, parseArmId } = await import('../src/features/armoury-pages.ts');
  const store = new Store(':memory:');
  const rows = parseWeaponList(list);
  // pad to three pages
  const many = [...rows, ...Array.from({ length: 20 }, (_, i) => ({ ...rows[1], id: `X${String(i).padStart(5, '0')}`, quality: 40 + i }))];
  store.saveSnapshot('123456789012345678', 'armoury', many.map((w) => [w.id, w]));
  const first = armouryPage(store, '123456789012345678', 0, 'all', 'rarity');
  const ids = first.components.flatMap((r) => r.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length <= 100));
  assert.match(JSON.stringify(first.embeds[0].toJSON()), /1 \/ 3/);
  const top = armouryPage(store, '123456789012345678', 0, 'top', 'quality');
  assert.match(JSON.stringify(top.embeds[0].toJSON()), /Mythic and up · 2/);
  assert.deepEqual(parseArmId('arm|1|2|held|type|next'), { userId: '1', page: 2, filter: 'held', sort: 'type', what: 'next' });
});

test('giphy links turn into gif files without any api', async () => {
  const { giphyFile, cached, isGifLink } = await import('../src/gifs.ts');
  assert.equal(giphyFile('https://giphy.com/gifs/bsd-bungo-stray-dogs-chuuya-Waq81Yz6Vw3GuCxGPZ'), 'https://media.giphy.com/media/Waq81Yz6Vw3GuCxGPZ/giphy.gif');
  assert.equal(giphyFile('https://giphy.com/gifs/UzGnrtOUKXmdrtja0V'), 'https://media.giphy.com/media/UzGnrtOUKXmdrtja0V/giphy.gif');
  assert.equal(giphyFile('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/Waq81Yz6Vw3GuCxGPZ/giphy.gif'), 'https://media.giphy.com/media/Waq81Yz6Vw3GuCxGPZ/giphy.gif');
  assert.equal(cached('https://giphy.com/gifs/UzGnrtOUKXmdrtja0V'), 'https://media.giphy.com/media/UzGnrtOUKXmdrtja0V/giphy.gif');
  assert.ok(isGifLink('https://giphy.com/gifs/dazai-bungo-stray-dogs-osamu-vayuMKG6qqHlRUwRaG'));
  assert.ok(!isGifLink('https://example.com/page'));
});

test('anilist text cleanup and seasons', async () => {
  const { plain, currentSeason, titleOf } = await import('../src/anime/anilist.ts');
  assert.equal(plain('A <i>detective</i><br>agency. ~!he dies!~ __big__'), 'A detective\nagency. [spoiler hidden] **big**');
  assert.ok(plain('x'.repeat(1000), 50).endsWith('…'));
  assert.deepEqual(currentSeason(new Date('2026-11-02T00:00:00Z')), { season: 'FALL', year: 2026 });
  assert.equal(titleOf({ title: { english: null, romaji: 'Bungou Stray Dogs' } }), 'Bungou Stray Dogs');
});

test('poll view counts votes', async () => {
  const { pollView } = await import('../src/modules/utility.ts');
  const v = pollView('123', { question: 'snack?', options: ['crab', 'pizza'], votes: { a: 0, b: 0, c: 1 }, owner: 'a' });
  const json = JSON.stringify(v.embeds[0].toJSON());
  assert.match(json, /67%/);
  assert.equal(v.components.length, 2);
  const closed = pollView('123', { question: 'snack?', options: ['crab', 'pizza'], votes: { a: 0 }, owner: 'a', closed: true });
  assert.equal(closed.components.length, 0);
  assert.match(JSON.stringify(closed.embeds[0].toJSON()), /👑/);
});

test('levels, ranks and lengths', async () => {
  const { levelOf, totalFor, rankFor, stepXp } = await import('../src/modules/levels.ts');
  const { parseLength, human } = await import('../src/modules/moderation.ts');
  assert.equal(stepXp(0), 100);
  assert.deepEqual(levelOf(0), { level: 0, into: 0, need: 100 });
  assert.equal(levelOf(totalFor(10)).level, 10);
  assert.equal(levelOf(totalFor(10) - 1).level, 9);
  assert.equal(rankFor(0).name, 'Stray');
  assert.equal(rankFor(12).name, 'Junior Detective');
  assert.equal(rankFor(80).name, 'Living Legend of Yokohama');
  assert.equal(parseLength('10m'), 600_000);
  assert.equal(parseLength('1d 2h'), 93_600_000);
  assert.equal(parseLength('nope'), null);
  assert.equal(human(93_600_000), '1d 2h');
});

test('welcome text placeholders', async () => {
  const { fill } = await import('../src/modules/welcome.ts');
  const m = { id: '1', displayName: 'Atsushi', user: { username: 'tiger' }, guild: { name: 'Agency', memberCount: 42 } };
  assert.equal(fill('Hi {user}, welcome to {server}, you are #{count}, {name}!', m as never), 'Hi <@1>, welcome to Agency, you are #42, Atsushi!');
});

test('weapon shop page from a real sample', async () => {
  const { readFileSync } = await import('node:fs');
  const { flatten, parseShopWeapons } = await import('../src/owo/parse.ts');
  const { shopDeals } = await import('../src/features/armoury.ts');
  const e = JSON.parse(readFileSync(new URL('./samples/shop-weapons.json', import.meta.url), 'utf8'));
  const shop = parseShopWeapons(flatten('', [e]));
  assert.ok(shop);
  assert.equal(shop.items.length, 10);
  const tithe = shop.items.find((w) => w.id === '102')!;
  assert.deepEqual([tithe.type, tithe.rarity, tithe.price, tithe.tagged], ['Soul Tithe', 'epic', 63, true]);
  assert.equal(shop.items.find((w) => w.id === '104')!.rarity, 'mythic');
  assert.ok(shop.resetsInMs! > 2 * 3_600_000);
  const deals = shopDeals(shop.items, [{ id: 'AAAAAA', rarity: 'rare', name: 'Soul Tithe', quality: 50, equippedOn: null, empowered: false }], null);
  assert.equal(deals.find((d) => d.item.id === '102')!.verdict, 'upgrade');
  assert.equal(deals.find((d) => d.item.id === '110')!.verdict, 'new');
});
