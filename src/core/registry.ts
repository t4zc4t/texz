import type { ChatInputCommandInteraction, Message } from 'discord.js';
import type { Store } from '../db.js';
import { core, allModules } from '../modules/core.js';
import { owo } from '../modules/owo.js';
import { lines, pick } from '../theme.js';
import { fromSlash, fromText, type Ctx } from './ctx.js';
import type { Command, Module } from './module.js';

export const modules: Module[] = [core, owo];
allModules.push(...modules);

const bySlash = new Map<string, { mod: Module; cmd: Command }>();
const byText = new Map<string, { mod: Module; cmd: Command }>();
for (const mod of modules) for (const cmd of mod.commands) {
  bySlash.set(cmd.name, { mod, cmd });
  for (const name of [cmd.name, ...(cmd.text?.aliases ?? [])]) byText.set(name, { mod, cmd });
}

export const definitions = modules.flatMap((m) => m.commands.map((c) => c.data));

// the on/off switch, channel limits and role limits, checked before every command
function gate(store: Store, ctx: Ctx, mod: Module, cmd: Command): string | null {
  if (cmd.admin && !ctx.isAdmin) return pick(lines.noPerm);
  if (mod.locked || !ctx.guildId) return null;
  const r = store.rules(ctx.guildId, mod.name);
  if (!r.enabled) return pick(lines.off);
  // admins can always use things, so they can't lock themselves out
  if (ctx.isAdmin) return null;
  if (r.channels.length && !r.channels.includes(ctx.channelId)) return lines.wrongChannel(r.channels.map((c) => `<#${c}>`).join(' or '));
  if (r.roles.length && !r.roles.some((id) => ctx.member?.roles.cache.has(id))) return pick(lines.noRole);
  return null;
}

async function run(store: Store, ctx: Ctx, mod: Module, cmd: Command) {
  const blocked = gate(store, ctx, mod, cmd);
  if (blocked) return ctx.reply(blocked);
  try {
    await cmd.run(ctx, store);
  } catch (e) {
    console.error(`${cmd.name} failed`, e);
    await ctx.reply(pick(lines.error)).catch(() => {});
  }
}

export function onSlash(store: Store, i: ChatInputCommandInteraction) {
  const hit = bySlash.get(i.commandName);
  if (hit) return run(store, fromSlash(i), hit.mod, hit.cmd);
}

export function isEnabled(store: Store, guildId: string | null, module: string) {
  return store.rules(guildId, module).enabled;
}

// "tz status", "tz hb", "tzstatus" all work, case doesn't matter
export function onText(store: Store, m: Message): boolean {
  const prefix = m.guildId ? store.guild(m.guildId).prefix : 'tz';
  const text = m.content.trim();
  if (!text.toLowerCase().startsWith(prefix)) return false;
  const body = text.slice(prefix.length);
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  const name = tokens.shift()?.toLowerCase();
  if (!name) return false;
  const hit = byText.get(name);
  if (!hit) return false;
  // "tzatziki" shouldn't trigger anything, only a space or a real command name after the prefix
  if (!/^\s/.test(body) && !byText.has(body.split(/\s+/)[0].toLowerCase())) return false;
  const t = hit.cmd.text ?? {};
  const sub = t.sub ? tokens[0]?.toLowerCase() : undefined;
  const args = t.sub ? (t.subArgs?.[sub ?? ''] ?? []) : (t.args ?? []);
  void run(store, fromText(m, tokens, args, !!t.sub), hit.mod, hit.cmd);
  return true;
}
