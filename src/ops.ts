import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'discord.js';
import type { Store } from './db.js';

let client: Client | null = null;
let store: Store | null = null;
const queue: string[] = [];
let timer: NodeJS.Timeout | null = null;

// errors land in the console and, batched, in the channel the owner picked in /setup
export function report(where: string, e: unknown) {
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
  const beat = () => { try { writeFileSync('.alive', String(c.isReady() ? Date.now() : 0)); } catch { /* read-only folder, no tray then */ } };
  beat();
  setInterval(beat, 30_000);
}
