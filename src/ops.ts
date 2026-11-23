import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Client } from 'discord.js';
import type { Store } from './db.js';

let client: Client | null = null;
let store: Store | null = null;
const queue: string[] = [];
let timer: NodeJS.Timeout | null = null;

// errors land in the console and, batched, in the channel the owner picked in /setup
// a dropped connection isn't a bug: one line when it goes, one when it's back, no stack dumps in between
const NET = /ConnectTimeout|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|UND_ERR|fetch failed|socket hang up|getaddrinfo|network/i;
let offlineSince: number | null = null;
let lastNetError = 0;
export const isOffline = () => offlineSince !== null;
function isNetwork(e: unknown) {
  const text = e instanceof Error ? `${e.name} ${e.message} ${String((e as { cause?: unknown }).cause ?? '')} ${(e as { code?: string }).code ?? ''}` : String(e);
  return NET.test(text);
}
function backOnlineCheck(ready: boolean) {
  if (offlineSince && ready && Date.now() - lastNetError > 45_000) {
    const mins = Math.max(1, Math.round((Date.now() - offlineSince) / 60_000));
    console.log(`back online after ${mins}m`);
    offlineMs += Date.now() - offlineSince;
    offlineSince = null;
  }
}

// counted for the weekly health report
const started = Date.now();
let errors = 0;
let offlineMs = 0;
const uses = new Map<string, number>();
export const countUse = (name: string) => uses.set(name, (uses.get(name) ?? 0) + 1);

// the same problem over and over is worth a DM, not just a line in the error channel
const recent = new Map<string, number[]>();
const nagged = new Map<string, number>();
function repeated(where: string) {
  const now = Date.now();
  const list = (recent.get(where) ?? []).filter((t) => now - t < 3600_000);
  list.push(now);
  recent.set(where, list);
  if (list.length >= 5 && now - (nagged.get(where) ?? 0) > 6 * 3600_000) {
    nagged.set(where, now);
    void dmOwner(`🚨 **${where}** failed ${list.length} times in the last hour.`);
  }
}

export function report(where: string, e: unknown) {
  if (!isNetwork(e)) { errors++; repeated(where); }
  if (isNetwork(e)) {
    lastNetError = Date.now();
    if (!offlineSince) { offlineSince = Date.now(); console.log(`offline (${where}), retrying`); }
    return;
  }
  console.error(where, e);
  const text = e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(e);
  queue.push(`**${where}** · <t:${Math.floor(Date.now() / 1000)}:T>\n\`\`\`\n${text.slice(0, 600)}\n\`\`\``);
  if (queue.length > 20) queue.shift();
  timer ??= setTimeout(flush, 30_000);
}

async function flush() {
  timer = null;
  const id = store?.getKv('errorChannel');
  const lines = queue.splice(0);
  if (!id || !client || !lines.length) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch?.isSendable()) return;
  let chunk = '';
  for (const l of lines) {
    if (chunk.length + l.length > 1900) { await ch.send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => {}); chunk = ''; }
    chunk += `${l}\n`;
  }
  if (chunk) await ch.send({ content: `🩹 ${chunk}`, allowedMentions: { parse: [] } }).catch(() => {});
}

async function ownerOf(c: Client) {
  const app = await c.application?.fetch().catch(() => null);
  const ownerId = app?.owner && 'members' in app.owner ? app.owner.ownerId : app?.owner?.id;
  return ownerId ? c.users.fetch(ownerId).catch(() => null) : null;
}
export async function dmOwner(text: string) {
  if (!client) return;
  const owner = await ownerOf(client);
  await owner?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}

// each feed notes when it last ran clean; one stuck for hours while Texz itself is online gets a DM
const feedsOk = new Map<string, number>();
export const feedOk = (name: string) => feedsOk.set(name, Date.now());
function checkFeeds() {
  if (!client?.isReady() || offlineSince) return;
  const now = Date.now();
  for (const [name, at] of feedsOk) {
    if (now - at < 3 * 3600_000 || !store) continue;
    const key = `feedwarn:${name}`;
    if (now - Number(store.getKv(key) ?? 0) < 12 * 3600_000) continue;
    store.setKv(key, String(now));
    void dmOwner(`📡 The **${name}** feed hasn't worked since <t:${Math.floor(at / 1000)}:R>.`);
  }
}

// the last lines of the log before a crash, for the DM after it
function logTail(lines = 12) {
  try {
    const all = readFileSync('texz.log', 'utf8').trimEnd().split('\n');
    const cut = all.findLastIndex((l) => /^\[\d{4}-\d{2}-\d{2} [\d:]+\] texz (was not running|started)/.test(l));
    return all.slice(Math.max(0, cut - lines), cut > 0 ? cut : undefined).join('\n').slice(-1500);
  } catch { return ''; }
}

// one copy of the database a day, the last week kept, in BACKUP_DIR when set
export function backup(s: Store, dir = process.env.BACKUP_DIR || 'backups', keep = 7) {
  mkdirSync(dir, { recursive: true });
  const name = `texz-${new Date().toISOString().slice(0, 10)}.db`;
  const path = join(dir, name);
  rmSync(path, { force: true });
  s.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter((f) => /^texz-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return path;
}

export function startOps(c: Client, s: Store) {
  client = c;
  store = s;
  process.on('unhandledRejection', (e) => report('unhandled', e));
  c.on('error', (e) => report('discord', e));
  // a run that ended without a clean restart was a crash: say so, with the last log lines
  const prev = s.getKv('run:state');
  if (prev === 'running') {
    const tail = logTail();
    void dmOwner(`💥 **Texz stopped unexpectedly** and is back up.${tail ? `\n\`\`\`\n${tail.replace(/```/g, "'''")}\n\`\`\`` : ''}`);
  }
  s.setKv('run:state', 'running');
  // a normal stop (closing the tray, shutting the PC down) isn't a crash
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) {
    process.once(sig, () => { try { s.setKv('run:state', 'clean'); } catch { /* closing */ } process.exit(0); });
  }
  setInterval(checkFeeds, 30 * 60_000).unref?.();
  const daily = () => {
    if (s.getKv('lastBackup') === new Date().toISOString().slice(0, 10)) return;
    try {
      const path = backup(s);
      s.setKv('lastBackup', new Date().toISOString().slice(0, 10));
      console.log(`backup saved: ${path}`);
    } catch (e) { report('backup', e); }
  };
  daily();
  setInterval(daily, 3_600_000);
  // the tray icon reads this to tell "online" from "running but stuck"
  const beat = () => {
    backOnlineCheck(c.isReady() && c.ws.ping > 0);
    try { writeFileSync('.alive', offlineSince ? `offline:${Date.now()}` : String(c.isReady() ? Date.now() : 0)); } catch { /* read-only folder, no tray then */ }
    // dropping a .restart file asks for a clean exit, the tray or runner starts the new build
    if (existsSync('.restart')) { rmSync('.restart', { force: true }); s.setKv('run:state', 'clean'); console.log('restart asked for, exiting'); process.exit(0); }
  };
  beat();
  setInterval(beat, 30_000);
}

// slash commands are registered again only when they changed, so a new build never needs a manual deploy
export async function syncCommands(c: Client<true>, s: Store, defs: unknown[]) {
  const hash = createHash('sha256').update(JSON.stringify(defs)).digest('hex');
  if (s.getKv('commandsHash') === hash) return;
  await c.application.commands.set(defs as never);
  s.setKv('commandsHash', hash);
  console.log(`slash commands updated: ${defs.length}`);
}

// Sunday, a short note to whoever owns the bot: how the week went
async function healthReport(c: Client, s: Store) {
  const d = new Date();
  const key = `health:${d.toISOString().slice(0, 10)}`;
  if (d.getUTCDay() !== 0 || d.getUTCHours() < 15 || s.getKv(key)) return;
  s.setKv(key, '1');
  const owner = await ownerOf(c);
  if (!owner) return;
  const up = Date.now() - started;
  const hours = (ms: number) => `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
  let spawns = '';
  try {
    const week = Date.now() - 7 * 86_400_000;
    const lines = readFileSync(join('cache', 'spawnlog.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { at: number; guess: { name: string } | null; confirmed: string | null }).filter((x) => x.at > week);
    const sure = lines.filter((x) => x.confirmed);
    const right = sure.filter((x) => x.guess && x.guess.name.toLowerCase() === x.confirmed!.toLowerCase()).length;
    if (lines.length) spawns = `🔎 Pokétwo: ${lines.length} spawns, ${right}/${sure.length} named exactly`;
  } catch { /* no log yet */ }
  let dbSize = '';
  try { dbSize = `${(statSync(process.env.DB_PATH || 'texz.db').size / 1_048_576).toFixed(1)} MB`; } catch { /* in memory */ }
  const top = [...uses].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, k]) => `${n} ${k}`).join(' · ');
  const text = [
    '🩺 **Texz weekly check-up**',
    `⏱️ Up ${hours(up)} since the last restart${offlineMs ? `, offline for ${hours(offlineMs)} of it` : ''}`,
    `🧯 ${errors} error${errors === 1 ? '' : 's'} reported`,
    spawns,
    top ? `⌨️ Most used: ${top}` : '',
    dbSize ? `🗄️ Database ${dbSize}, ${c.guilds.cache.size} server${c.guilds.cache.size === 1 ? '' : 's'}` : '',
    `💾 Last backup ${s.getKv('lastBackup') ?? 'none yet'}`,
  ].filter(Boolean).join('\n');
  await owner.send(text).catch(() => {});
}
export const startHealth = (c: Client, s: Store) => setInterval(() => void healthReport(c, s).catch(() => {}), 3600_000).unref?.();
