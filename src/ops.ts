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

export function report(where: string, e: unknown) {
  if (!isNetwork(e)) errors++;
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

// one copy of the database a day, the last week kept
export function backup(s: Store, dir = 'backups', keep = 7) {
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
    if (existsSync('.restart')) { rmSync('.restart', { force: true }); console.log('restart asked for, exiting'); process.exit(0); }
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
  const app = await c.application?.fetch().catch(() => null);
  const ownerId = app?.owner && 'members' in app.owner ? app.owner.ownerId : app?.owner?.id;
  const owner = ownerId ? await c.users.fetch(ownerId).catch(() => null) : null;
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
  ].filter(Boolean).join('\n');
  await owner.send(text).catch(() => {});
}
export const startHealth = (c: Client, s: Store) => setInterval(() => void healthReport(c, s).catch(() => {}), 3600_000).unref?.();
