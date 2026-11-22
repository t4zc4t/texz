import { appendFileSync } from 'node:fs';
import { Events, type Client, type Message, type PartialMessage } from 'discord.js';
import type { Store } from '../db.js';
import { report } from '../ops.js';
import * as read from './read.js';
import { OwoState } from './state.js';

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
  shop: 'shop', dex: 'dex', d: 'dex',
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

const debugFile = process.env.OWO_DEBUG ? 'owo-debug.log' : null;

export function apply(state: OwoState, userId: string, s: read.Said, now = Date.now()) {
  const seen: string[] = [];
  const t = read.team(s);
  if (t?.pets.length) { state.saveTeam(userId, t, now); seen.push('team'); }
  const z = read.zoo(s);
  if (z?.animals.length) { state.saveZoo(userId, z, now); seen.push('zoo'); }
  const w = read.weapon(s);
  if (w?.id) { state.saveWeaponCard(userId, w, now); seen.push('weapon'); }
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

async function onOwo(store: Store, m: Message | PartialMessage, edited: boolean) {
  if (m.partial) m = await m.fetch().catch(() => m);
  const s = read.said({ content: m.content, embeds: m.embeds.map((e) => e.toJSON()), components: m.components.map((c) => c.toJSON()) });
  const who = await ownerOf(m, s);
  if (debugFile && !edited) appendFileSync(debugFile, JSON.stringify({ at: new Date().toISOString(), cmd: who?.cmd ?? '?', content: s.content, embeds: m.embeds.map((e) => e.toJSON()), components: m.components.map((c) => c.toJSON()) }) + '\n');
  if (!who) return;
  remember(m.id, who.userId);
  // a server that switched the OwO helper off doesn't teach Texz anything
  if (!store.rules(m.guildId ?? null, 'owo').enabled) return;
  apply(new OwoState(store.db), who.userId, s);
}

export function listenToOwo(client: Client, store: Store) {
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
