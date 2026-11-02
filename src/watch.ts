import { appendFileSync } from 'node:fs';
import type { Client, Message, PartialMessage } from 'discord.js';
import type { Store } from './db.js';
import { minigames, parseCommand } from './owo/commands.js';
import {
  OWO_BOT_ID, flatten, isCaptcha, parseDuration, parseHuntbot, parseInventory, parseTeam, parseWeapon,
  type Embedish, type Huntbot, type Weapon,
} from './owo/parse.js';
import { scheduleDailies, urgent } from './reminders.js';
import { HOUR, owoDay } from './time.js';

interface Pending {
  userId: string;
  cmd: string;
  args?: string;
  at: number;
}

// recent OwO commands per channel, oldest first, OwO's reply usually lands within a couple of seconds
const pending = new Map<string, Pending[]>();

// picks which waiting command an OwO reply belongs to, a weapon ID in the reply wins,
// otherwise the oldest command still waiting
function claim(channelId: string, text: string): Pending | undefined {
  const now = Date.now();
  const queue = (pending.get(channelId) ?? []).filter((p) => now - p.at < 15_000);
  if (!queue.length) return undefined;
  // team replies list weapon IDs too, so only a real weapon card counts
  const weaponId = parseWeapon(text)?.id;
  let i = weaponId ? queue.findIndex((p) => p.cmd === 'weapon' && p.args?.toUpperCase() === weaponId) : -1;
  if (i < 0) i = 0;
  const [picked] = queue.splice(i, 1);
  pending.set(channelId, queue);
  return picked;
}
// OwO edits its own messages (pages, animations), remember who each one belongs to
const owners = new Map<string, Pending>();

const daily = new Set(['daily', 'cookie', 'quest', 'checklist', 'vote', ...minigames]);

function embedsOf(m: Message | PartialMessage): Embedish[] {
  return m.embeds.map((e) => ({
    title: e.title,
    author: e.author?.name,
    description: e.description,
    fields: e.fields.map((f) => ({ name: f.name, value: f.value })),
    footer: e.footer?.text,
  }));
}

// newer OwO screens use message components instead of embeds, pull any text out of those
function componentText(m: Message | PartialMessage): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'content' || k === 'label') && typeof v === 'string') out.push(v);
      else if (typeof v === 'object') walk(v);
    }
  };
  walk(m.components.map((c) => c.toJSON()));
  return out.join('\n');
}

const debugFile = process.env.OWO_DEBUG ? 'owo-debug.log' : null;

function debug(m: Message | PartialMessage, cmd: string) {
  if (!debugFile) return;
  const line = JSON.stringify({
    at: new Date().toISOString(), cmd, content: m.content,
    embeds: m.embeds.map((e) => e.toJSON()),
    components: m.components.map((c) => c.toJSON()),
  });
  appendFileSync(debugFile, line + '\n');
}

function remember(id: string, p: Pending) {
  owners.set(id, p);
  if (owners.size > 500) owners.delete(owners.keys().next().value!);
}

function onCommand(store: Store, m: Message) {
  const cmd = parseCommand(m.content);
  if (!cmd) return;
  const userId = m.author.id;
  store.touch(userId, m.channelId);
  scheduleDailies(store, userId);
  const queue = pending.get(m.channelId) ?? [];
  queue.push({ userId, cmd: cmd.name, args: cmd.args.split(/\s+/)[0] || undefined, at: Date.now() });
  pending.set(m.channelId, queue.slice(-10));

  const day = owoDay();
  if (cmd.name === 'hunt' || cmd.name === 'battle' || cmd.name === 'owo') store.bump(userId, day, cmd.name);
}

function onReply(store: Store, m: Message | PartialMessage, p: Pending) {
  const embeds = embedsOf(m);
  const text = flatten([m.content ?? '', componentText(m)].join('\n'), embeds);
  const s = store.settings(p.userId);
  const now = Date.now();
  const day = owoDay();
  // OwO answers cooldowns with things like "please wait 3m 20s" or "try again in 4H 12M"
  const wait = text.match(/(?:wait|again in|in)\s*\**\s*((?:\d+\s*[hm]\s*)+)/i);
  const onCooldown = /slow down|please wait|you need to wait|already (claimed|voted)|come back/i.test(text);

  switch (p.cmd) {
    case 'hunt':
    case 'battle':
      if (!onCooldown) {
        store.setCooldown(p.userId, p.cmd, new Date(now + 15_000));
        if (s.huntbattle) store.setReminder(p.userId, 'hunt', new Date(now + 15_000), '', m.channelId);
      }
      break;
    case 'pray':
    case 'curse': {
      const ms = onCooldown && wait ? parseDuration(wait[1]) : 5 * 60_000;
      if (ms) {
        store.setCooldown(p.userId, 'pray', new Date(now + ms));
        if (s.pray) store.setReminder(p.userId, 'pray', new Date(now + ms), '', m.channelId);
      }
      break;
    }
    case 'vote': {
      store.markDone(p.userId, day, 'vote');
      const ms = (wait && parseDuration(wait[1])) || 12 * HOUR;
      store.setCooldown(p.userId, 'vote', new Date(now + ms));
      if (s.vote) store.setReminder(p.userId, 'vote', new Date(now + ms), '', m.channelId);
      break;
    }
    case 'huntbot': {
      const hb = parseHuntbot(text);
      if (!hb) break;
      // a run started from autohunt has no trait list, keep the last full one
      const old = store.snapshot<Huntbot>(p.userId, 'huntbot')?.data;
      const merged: Huntbot = Object.keys(hb.traits).length ? hb : { ...(old ?? hb), backInMs: hb.backInMs, percentDone: hb.percentDone };
      store.saveSnapshot(p.userId, 'huntbot', merged);
      if (hb.backInMs) {
        store.setCooldown(p.userId, 'huntbot', new Date(now + hb.backInMs));
        if (s.huntbot) store.setReminder(p.userId, 'huntbot', new Date(now + hb.backInMs), '', m.channelId);
      }
      break;
    }
    case 'inv': {
      const inv = parseInventory(text);
      if (inv.size) store.saveSnapshot(p.userId, 'inv', [...inv]);
      break;
    }
    case 'team': {
      const team = parseTeam(embeds);
      if (team.length) store.saveSnapshot(p.userId, 'team', team);
      break;
    }
    case 'weapon': {
      const w = parseWeapon(text);
      if (!w) break;
      const all = new Map(store.snapshot<[string, Weapon][]>(p.userId, 'weapons')?.data ?? []);
      all.set(w.id, w);
      store.saveSnapshot(p.userId, 'weapons', [...all].slice(-60));
      store.saveSnapshot(p.userId, 'lastweapon', w.id);
      break;
    }
    default:
      if (daily.has(p.cmd)) store.markDone(p.userId, day, p.cmd);
  }
}

export function watch(client: Client, store: Store) {
  const handle = async (m: Message | PartialMessage, edited: boolean) => {
    if (!m.author) return;
    // a server can switch the whole OwO helper off
    if (m.guildId && !store.rules(m.guildId, 'owo').enabled) return;
    if (!m.author.bot && !edited) return onCommand(store, m as Message);
    if (m.author.id !== OWO_BOT_ID) return;

    const text = flatten([m.content ?? '', componentText(m)].join('\n'), embedsOf(m));
    if (!edited && isCaptcha(text)) {
      const ids = new Set([...m.mentions.users.keys()]);
      for (const id of ids) {
        await urgent(client, store, id, m.channelId,
          `OwO wants a captcha from you in <#${m.channelId}>. Solve it now, ignoring it gets you banned from the bot.`).catch(() => {});
      }
    }

    // slash command replies carry the user directly
    const viaSlash = m.interactionMetadata?.user?.id;
    let p: Pending | undefined = owners.get(m.id);
    if (!p && viaSlash && m.interactionMetadata) {
      const slashName = (m.interactionMetadata as { name?: string }).name ?? '';
      const cmd = parseCommand(`owo ${slashName}`);
      if (cmd) p = { userId: viaSlash, cmd: cmd.name, at: Date.now() };
    }
    if (!p && !edited) p = claim(m.channelId, text);
    if (!p) return;
    remember(m.id, p);
    debug(m, p.cmd);
    onReply(store, m, p);
  };

  client.on('messageCreate', (m) => void handle(m, false).catch((e) => console.error(e)));
  client.on('messageUpdate', (_old, m) => void handle(m, true).catch((e) => console.error(e)));
}
