import { MessageFlags, type ChatInputCommandInteraction, type Interaction, type Message } from 'discord.js';
import { armouryPage, parseArmId, filters, sorts, type Filter, type Sort } from '../features/armoury-pages.js';
import { apply, modalFor, panel, parseRp } from '../features/panel.js';
import type { Store } from '../db.js';
import { core, allModules } from '../modules/core.js';
import { owo } from '../modules/owo.js';
import { RED, card, type Kind } from '../theme.js';
import { fromComponent, fromSlash, fromText, type Ctx } from './ctx.js';
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
type Block = { kind: Kind; vars?: Record<string, string> };

function gate(store: Store, ctx: Ctx, mod: Module, cmd: Command): Block | null {
  if (cmd.admin && !ctx.isAdmin) return { kind: 'noPerm' };
  if (mod.locked || !ctx.guildId) return null;
  const r = store.rules(ctx.guildId, mod.name);
  if (!r.enabled) return { kind: 'off' };
  // admins can always use things, so they can't lock themselves out
  if (ctx.isAdmin) return null;
  if (r.channels.length && !r.channels.includes(ctx.channelId)) return { kind: 'wrongChannel', vars: { where: r.channels.map((c) => `<#${c}>`).join(' or ') } };
  if (r.roles.length && !r.roles.some((id) => ctx.member?.roles.cache.has(id))) return { kind: 'noRole' };
  return null;
}

async function run(store: Store, ctx: Ctx, mod: Module, cmd: Command) {
  const blocked = gate(store, ctx, mod, cmd);
  if (blocked) return ctx.reply(card({ ...blocked, title: 'Not this time', emoji: '🚫', color: RED }));
  try {
    await cmd.run(ctx, store);
  } catch (e) {
    console.error(`${cmd.name} failed`, e);
    await ctx.reply(card({ kind: 'error', title: 'Well, that slipped', emoji: '🩹', color: RED })).catch(() => {});
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

// buttons and menus on Texz's own messages
export async function onComponent(store: Store, i: Interaction) {
  if (i.isModalSubmit() || i.isButton() || i.isStringSelectMenu()) {
    const rp = parseRp(i.customId);
    if (rp) return onPanel(store, i, rp).catch((e) => console.error('panel', e));
  }
  if (!i.isButton() && !i.isStringSelectMenu()) return;
  // "nav|command|option=value" buttons open another screen, just for whoever pressed it
  if (i.customId.startsWith('nav|')) {
    const [, name, extra] = i.customId.split('|');
    const opts: Record<string, string> = {};
    if (extra) for (const pair of extra.split(',')) { const [k, v] = pair.split('='); opts[k] = v; }
    if (i.isStringSelectMenu()) opts[opts.as ?? 'value'] = i.values[0];
    const hit = bySlash.get(name);
    if (hit) return run(store, fromComponent(i, opts), hit.mod, hit.cmd);
    return;
  }
  const arm = parseArmId(i.customId);
  if (!arm) return;
  if (i.user.id !== arm.userId) {
    return i.reply({ content: 'That\'s someone else\'s case file. Open your own with `tz a all`.', flags: MessageFlags.Ephemeral });
  }
  let { page, filter, sort } = arm;
  if (i.isStringSelectMenu()) {
    const v = i.values[0];
    if (arm.what === 'filter' && v in filters) { filter = v as Filter; page = 0; }
    if (arm.what === 'sort' && v in sorts) { sort = v as Sort; page = 0; }
  }
  await i.update(armouryPage(store, arm.userId, page, filter, sort)).catch((e) => console.error('armoury page', e));
}

const notYours = 'That\'s someone else\'s control room. Open your own with `tz remind`.';

async function onPanel(store: Store, i: Interaction, rp: NonNullable<ReturnType<typeof parseRp>>) {
  if (!i.isModalSubmit() && !i.isButton() && !i.isStringSelectMenu()) return;
  if (i.user.id !== rp.userId) return i.reply({ content: notYours, flags: MessageFlags.Ephemeral });

  // buttons that need typing open a small form first
  if (i.isButton() && ['quiet', 'tz', 'add'].includes(rp.action)) {
    const modal = modalFor(rp.userId, rp.action, store.settings(rp.userId));
    if (modal) return i.showModal(modal);
  }
  if (i.isButton() && rp.action === 'view') return i.update(panel(store, rp.userId, rp.arg === 'list' ? 'list' : 'settings'));

  const fields: Record<string, string> = {};
  if (i.isModalSubmit()) for (const id of ['hours', 'zone', 'minutes', 'note']) {
    try { fields[id] = i.fields.getTextInputValue(id); } catch { /* not in this form */ }
  }
  const arg = i.isStringSelectMenu() ? i.values[0] : rp.arg;
  const err = apply(store, rp.userId, rp.action, arg, fields, i.channelId ?? '');
  if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });

  const view = ['add', 'cancel'].includes(rp.action) ? 'list' : 'settings';
  if (i.isModalSubmit()) {
    if (i.isFromMessage()) return i.update(panel(store, rp.userId, view));
    return i.reply({ ...panel(store, rp.userId, view), flags: MessageFlags.Ephemeral });
  }
  return i.update(panel(store, rp.userId, view));
}
