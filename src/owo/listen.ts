import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { Events, type Client, type Message, type PartialMessage } from 'discord.js';
import type { Store } from '../db.js';
import { report } from '../ops.js';
import * as read from './read.js';
import { OwoState } from './state.js';
import { rangesFrom, verdict } from './advice.js';
import { card } from '../theme.js';
import { startOrders } from './orders.js';

// Texz only ever reads here. It never sends OwO commands, presses OwO's buttons or touches captchas.

// what people type to OwO: "owo hb", "w hb", "whb", "W TEAM", OwO's own short prefix included
const names: Record<string, string> = {
  hunt: 'hunt', h: 'hunt', catch: 'hunt',
  battle: 'battle', b: 'battle', fight: 'battle',
  autohunt: 'huntbot', huntbot: 'huntbot', hb: 'huntbot', ah: 'huntbot',
  team: 'team', squad: 'team', tm: 'team',
  weapon: 'weapon', w: 'weapon', weapons: 'weapon',
  zoo: 'zoo', z: 'zoo',
  ws: 'ws', weaponshard: 'ws',
  inventory: 'inv', inv: 'inv',
  sacrifice: 'sacrifice', sac: 'sacrifice', sc: 'sacrifice',
  sell: 'sell',
  upgrade: 'upgrade', upg: 'upgrade', up: 'upgrade',
  dismantle: 'dismantle', dm: 'dismantle',
  reroll: 'reroll', rr: 'reroll',
  crate: 'crate', wc: 'crate', weaponcrate: 'crate',
  lootbox: 'lootbox', lb: 'lootbox',
  daily: 'daily', vote: 'vote', pray: 'pray', curse: 'curse', cookie: 'cookie', rep: 'cookie',
  quest: 'quest', q: 'quest', checklist: 'checklist', cl: 'checklist',
  cowoncy: 'cash', cash: 'cash', money: 'cash', bal: 'cash',
  shop: 'shop', dex: 'dex', d: 'dex', pets: 'pets', pet: 'pets',
};

export function owoCommand(content: string): { name: string; args: string } | null {
  const m = content.trim().match(/^(?:owo|w)\s*([a-z]+)\b\s*(.*)$/is);
  if (!m) return content.trim().toLowerCase() === 'owo' ? { name: 'owo', args: '' } : null;
  const name = names[m[1].toLowerCase()];
  return name ? { name, args: m[2].trim() } : null;
}

interface Waiting { userId: string; names: string[]; cmd: string; args: string; at: number }
// the last few OwO commands per channel, OwO answers within a couple of seconds
const waiting = new Map<string, Waiting[]>();
// OwO edits its replies (pages, rerolls), so remember whose each one is
const owners = new Map<string, string>();
// one sweep of the weapon list per person, to notice weapons that are gone
const sweeps = new Map<string, { start: number; of: number; seen: Set<number> }>();

function remember(messageId: string, userId: string) {
  owners.set(messageId, userId);
  if (owners.size > 1000) owners.delete(owners.keys().next().value!);
}

function onCommand(m: Message) {
  const cmd = owoCommand(m.content);
  if (!cmd) return;
  const list = (waiting.get(m.channelId) ?? []).filter((w) => Date.now() - w.at < 20_000);
  const known = [m.author.username, m.author.globalName, m.member?.displayName].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  list.push({ userId: m.author.id, names: [...new Set(known)], cmd: cmd.name, args: cmd.args, at: Date.now() });
  waiting.set(m.channelId, list.slice(-12));
}

// who an OwO reply belongs to: slash use, a reply, a mention, or the matching recent command
async function ownerOf(m: Message | PartialMessage, s: read.Said): Promise<{ userId: string; cmd: string | null } | null> {
  const known = owners.get(m.id);
  if (known) return { userId: known, cmd: null };
  const slashUser = m.interactionMetadata?.user?.id;
  if (slashUser) return { userId: slashUser, cmd: null };
  if (m.reference?.messageId) {
    const ref = m.channel.messages.cache.get(m.reference.messageId);
    if (ref && !ref.author.bot) return { userId: ref.author.id, cmd: owoCommand(ref.content)?.name ?? null };
  }
  const { id, name } = read.addressee(s);
  const list = (waiting.get(m.channelId) ?? []).filter((w) => Date.now() - w.at < 20_000);
  let i = -1;
  if (id) i = list.findIndex((w) => w.userId === id);
  if (i < 0 && name) {
    const low = name.toLowerCase();
    i = list.findIndex((w) => w.names.includes(low));
  }
  // a mention of someone who didn't type a command still names the owner, a cookie gift for example
  if (i < 0 && id) return { userId: id, cmd: null };
  // nothing names anyone: only trust the queue when one person is waiting, never guess between two
  if (i < 0 && !name && new Set(list.map((w) => w.userId)).size === 1) i = list.length - 1;
  if (i < 0) return null;
  const [w] = list.splice(i, 1);
  waiting.set(m.channelId, list);
  return { userId: w.userId, cmd: w.cmd };
}

// OwO's raw replies stay on this PC (never in the repo) so new layouts can be learnt from real messages.
// Capped at about 20 MB, the old file is kept once as owo-debug.old.log
const debugFile = process.env.OWO_DEBUG === 'off' ? null : 'owo-debug.log';
function keep(line: string) {
  if (!debugFile) return;
  try {
    if (existsSync(debugFile) && statSync(debugFile).size > 20_000_000) renameSync(debugFile, 'owo-debug.old.log');
    appendFileSync(debugFile, line + '\n');
  } catch { /* the log is a nice to have */ }
}

export function apply(state: OwoState, userId: string, s: read.Said, now = Date.now()) {
  const seen: string[] = [];
  const t = read.team(s);
  if (t?.pets.length) { state.saveTeam(userId, t, now); seen.push('team'); }
  const pl = read.pets(s);
  if (pl?.pets.length) { state.savePets(userId, pl.pets, now); seen.push('pets'); }
  const dx = read.dex(s);
  if (dx) { state.saveDex(dx, now); seen.push('dex'); }
  const z = read.zoo(s);
  if (z?.animals.length) { state.saveZoo(userId, z, now); seen.push('zoo'); }
  const w = read.weapon(s);
  if (w?.id) { state.saveWeaponCard(userId, w, now); seen.push('weapon'); }
  if (w) state.saveSample(w.name, w, w.shopId ? 'shop' : 'card', now);
  const rr = read.reroll(s);
  if (rr) {
    state.saveReroll(userId, rr, now);
    state.saveSample(rr.name, rr.current, 'reroll', now);
    state.saveSample(rr.name, rr.next, 'reroll', now);
    seen.push('reroll');
  }
  const list = read.weaponList(s);
  if (list?.weapons.length) {
    state.saveWeaponRows(userId, list.weapons, now);
    seen.push('weapons');
    if (!list.filtered) {
      const sw = sweeps.get(userId);
      const fresh = !sw || sw.of !== list.pages || now - sw.start > 15 * 60_000;
      const cur = fresh ? { start: now, of: list.pages, seen: new Set<number>() } : sw;
      cur.seen.add(list.page);
      sweeps.set(userId, cur);
      if (cur.seen.size === cur.of) {
        state.sweepWeapons(userId, cur.start);
        sweeps.delete(userId);
      }
    }
  }
  const h = read.huntbot(s);
  if (h) { state.saveHuntbot(userId, h, now); seen.push('huntbot'); }
  const hn = read.huntbotNote(s);
  if (hn?.kind === 'sent' || hn?.kind === 'hunting') state.setHuntbotBack(userId, now + hn.backInMs);
  if (hn?.kind === 'back') state.setHuntbotBack(userId, null);
  const b = read.battle(s);
  if (b) {
    state.logBattle(userId, b, now);
    if (b.streak !== null) state.setBit(userId, 'streak', b.streak, now);
  }
  const n = read.note(s);
  if (n) {
    if (n.kind === 'shards') state.setBit(userId, 'shards', n.n, now);
    if (n.kind === 'cash') state.setBit(userId, 'cash', n.n, now);
    if (n.kind === 'cookies') state.setBit(userId, 'cookies', n.n, now);
    if (n.kind === 'pray') state.setBit(userId, 'luck', n.luck, now);
    if (n.kind === 'upgrade') state.setTrait(userId, n.trait, n.level, n.progress, n.need);
    if (n.kind === 'pet') state.setBit(userId, `pet:${n.game}`, { streak: n.streak, resetsAt: n.resetsInMs !== null ? now + n.resetsInMs : null }, now);
    if (n.kind === 'minigame') state.setBit(userId, `game:${n.game}`, { done: n.done, of: n.of, total: n.total, out: n.out }, now);
    if (n.kind === 'checklist') state.setBit(userId, `board:${n.board}`, { claimable: n.claimable, claimed: n.claimed, allDone: n.allDone, resetsAt: n.resetsAt }, now);
    if (n.kind === 'daily') state.setBit(userId, 'dailyStreak', n.streak, now);
    if (n.kind !== 'tooFast') seen.push(n.kind);
  }
  const inv = read.inventory(s);
  if (inv) state.setBit(userId, 'inventory', Object.fromEntries(inv), now);
  return seen;
}

// one Texz reply per reroll session, edited on every try so the channel doesn't fill up
const helpers = new Map<string, Message>();

export function rerollCard(state: OwoState, r: read.Reroll) {
  const v = verdict(rangesFrom(state), r, r.shards);
  const tag = v.pick === 'confirm' ? '✅' : v.pick === 'cancel' ? '❌' : '🤔';
  const body = [`${tag} ${v.headline}`, '', ...v.lines, '', v.stop ? `🛑 Time to stop: ${v.odds ?? 'a better roll is very unlikely.'}` : v.odds ?? ''].filter((x, i, all) => x || all[i - 1]);
  const e = card({ kind: 'help', title: `Reroll check · ${r.name} \`${r.id}\``, emoji: '🎲', gif: 'off', line: '', body: body.join('\n') });
  e.setFooter({ text: `Try ${r.attempts ?? '?'} · Texz only reads OwO, the buttons are yours · tz o reroll off to stop these` });
  return e;
}

async function rerollHelp(store: Store, m: Message | PartialMessage, userId: string, s: read.Said) {
  const r = read.reroll(s);
  if (!r) return;
  const state = new OwoState(store.db);
  if (state.bits(userId).get('rrhelp')?.value === 'off') return;
  const embeds = [rerollCard(state, r)];
  const old = helpers.get(m.id);
  if (old) return void (await old.edit({ embeds }).catch(() => {}));
  if (!m.channel?.isSendable()) return;
  const sent = await m.channel.send({ embeds, reply: { messageReference: m.id, failIfNotExists: false }, allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) {
    helpers.set(m.id, sent);
    if (helpers.size > 200) helpers.delete(helpers.keys().next().value!);
  }
}

async function onOwo(store: Store, m: Message | PartialMessage, edited: boolean) {
  if (m.partial) m = await m.fetch().catch(() => m);
  const s = read.said({ content: m.content, embeds: m.embeds.map((e) => e.toJSON()), components: m.components.map((c) => c.toJSON()) });
  const who = edited && owners.has(m.id) ? { userId: owners.get(m.id)!, cmd: null } : await ownerOf(m, s);
  // edits matter too: rerolls and page flips change the message in place
  keep(JSON.stringify({ at: new Date().toISOString(), cmd: who?.cmd ?? '?', edited, content: s.content, embeds: m.embeds.map((e) => e.toJSON()), components: m.components.map((c) => c.toJSON()) }));
  // a dex card belongs to nobody in particular, base stats are the same for everyone
  if (!who) {
    const dx = read.dex(s);
    if (dx && store.rules(m.guildId ?? null, 'owo').enabled) new OwoState(store.db).saveDex(dx);
    return;
  }
  remember(m.id, who.userId);
  // a server that switched the OwO helper off doesn't teach Texz anything
  if (!store.rules(m.guildId ?? null, 'owo').enabled) return;
  apply(new OwoState(store.db), who.userId, s);
  await rerollHelp(store, m, who.userId, s);
}

// once: everything already in the saved OwO log becomes weapon samples and dex entries,
// so the weapons helper starts with weeks of data instead of none
function backfill(store: Store) {
  if (store.getKv('owo:backfill') || !debugFile) return;
  const st = new OwoState(store.db);
  let n = 0;
  for (const file of ['owo-debug.old.log', debugFile]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const s = read.said(JSON.parse(line));
        const w = read.weapon(s);
        if (w) { st.saveSample(w.name, w, w.shopId ? 'shop' : 'card'); n++; }
        const rr = read.reroll(s);
        if (rr) { st.saveSample(rr.name, rr.current, 'reroll'); st.saveSample(rr.name, rr.next, 'reroll'); n++; }
        const dx = read.dex(s);
        if (dx) st.saveDex(dx);
      } catch { /* a broken line is skipped */ }
    }
  }
  store.setKv('owo:backfill', String(Date.now()));
  console.log(`owo backfill: ${n} weapon readings, ${st.samples().length} unique samples`);
}

export function listenToOwo(client: Client, store: Store) {
  setTimeout(() => { try { backfill(store); } catch (e) { report('owo backfill', e); } }, 20_000);
  startOrders(client, store);
  client.on(Events.MessageCreate, (m) => {
    if (!m.guildId) return;
    if (m.author.id === read.OWO_BOT_ID) return void onOwo(store, m, false).catch((e) => report('owo read', e));
    if (!m.author.bot) onCommand(m);
  });
  client.on(Events.MessageUpdate, (_old, m) => {
    if (m.author?.id !== read.OWO_BOT_ID && !owners.has(m.id)) return;
    void onOwo(store, m, true).catch((e) => report('owo read', e));
  });
}
