import {
  ApplicationCommandOptionType, InteractionContextType, MessageFlags, PermissionFlagsBits,
  type ChatInputCommandInteraction, type Interaction, type Message, type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { armouryPage, parseArmId, filters, sorts, type Filter, type Sort } from '../features/armoury-pages.js';
import { apply, modalFor, panel, parseRp } from '../features/panel.js';
import type { Store } from '../db.js';
import { core, allModules } from '../modules/core.js';
import { owo } from '../modules/owo.js';
import { anime, onAnimeComponent } from '../modules/anime.js';
import { onWatchlist } from '../modules/watchlist.js';
import { onAvatarButton, onPollButton, utility } from '../modules/utility.js';
import { moderation, onCaseComponent } from '../modules/moderation.js';
import { onRoleButton, welcomeModule } from '../modules/welcome.js';
import { levelsModule } from '../modules/levels.js';
import { giveaways, onGiveawayButton } from '../modules/giveaways.js';
import { birthdays } from '../modules/birthdays.js';
import { onSetup, useModules } from '../features/setup.js';
import { RED, card, type Kind } from '../theme.js';
import { report } from '../ops.js';
import { fromComponent, fromSlash, fromText, type Ctx } from './ctx.js';
import { slashPath, type Command, type Module } from './module.js';

export const modules: Module[] = [core, owo, anime, utility, moderation, welcomeModule, levelsModule, giveaways, birthdays];
allModules.push(...modules);
useModules(modules);

// the grouped slash commands and who can see them by default
const groups: Record<string, { description: string; perms?: bigint }> = {
  owo: { description: 'OwO helper: timers, huntbot, gems, zoo, weapons, quests, shop and reminders' },
  anime: { description: 'Anime and manga: search, characters, seasons, trending, alerts and your list' },
  mod: { description: 'Moderation: warn, timeout, kick, ban, purge, lock, slowmode and the case archive', perms: PermissionFlagsBits.ModerateMembers },
  levels: { description: 'Rank cards, the level leaderboard and xp tools' },
  info: { description: 'Profiles, avatars and the server' },
  fun: { description: 'Dice, coins, the 8ball and hard decisions' },
};

type Hit = { mod: Module; cmd: Command };
const byName = new Map<string, Hit>();
const bySlash = new Map<string, Hit>();
const byText = new Map<string, Hit>();
for (const mod of modules) for (const cmd of mod.commands) {
  byName.set(cmd.name, { mod, cmd });
  if (!cmd.hidden) bySlash.set(slashPath(cmd), { mod, cmd });
  for (const name of [cmd.name, ...(cmd.text?.aliases ?? [])]) byText.set(name, { mod, cmd });
}

type Json = RESTPostAPIChatInputApplicationCommandsJSONBody;
type Opt = NonNullable<Json['options']>[number];

// a command with its own subcommands becomes a subcommand group, anything else a plain subcommand
function asMember(c: Command): Opt {
  const opts = (c.data.options ?? []) as Opt[];
  const nested = opts.some((o) => o.type === ApplicationCommandOptionType.Subcommand);
  return {
    type: nested ? ApplicationCommandOptionType.SubcommandGroup : ApplicationCommandOptionType.Subcommand,
    name: c.as ?? c.name,
    description: c.data.description,
    options: opts,
  } as Opt;
}

const visible = modules.flatMap((m) => m.commands.filter((c) => !c.hidden));
export const definitions: Json[] = [
  ...visible.filter((c) => !c.group).map((c) => c.data),
  ...Object.entries(groups).map(([name, g]) => ({
    name,
    description: g.description,
    contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
    ...(g.perms ? { default_member_permissions: g.perms.toString() } : {}),
    options: visible.filter((c) => c.group === name).map(asMember),
  })).filter((d) => d.options.length),
];

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
  if (blocked) return ctx.reply({ embeds: [card({ ...blocked, title: 'Not this time', emoji: '🚫', color: RED, gif: 'off' })], temp: true });
  try {
    await cmd.run(ctx, store);
  } catch (e) {
    report(`${cmd.name} failed`, e);
    await ctx.reply({ embeds: [card({ kind: 'error', title: 'Well, that slipped', emoji: '🩹', color: RED })], temp: true }).catch(() => {});
  }
}

export function onSlash(store: Store, i: ChatInputCommandInteraction) {
  if (groups[i.commandName]) {
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand(false);
    const hit = bySlash.get(`${i.commandName} ${group ?? sub}`);
    if (hit) return run(store, fromSlash(i, group ? sub : null), hit.mod, hit.cmd);
    return;
  }
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
  let name = tokens.shift()?.toLowerCase();
  if (!name) return false;
  // "tz mod warn @x" works like "/mod warn", but "tz anime frieren" is still a search
  const next = tokens[0]?.toLowerCase();
  const member = groups[name] && next
    ? bySlash.get(`${name} ${next}`) ?? (byText.get(next)?.cmd.group === name ? byText.get(next) : undefined)
    : undefined;
  if (member) { tokens.shift(); name = member.cmd.name; }
  const hit = member ?? byText.get(name);
  if (!hit) return false;
  // "tzatziki" shouldn't trigger anything, only a space or a real command name after the prefix
  if (!/^\s/.test(body) && !byText.has(body.split(/\s+/)[0].toLowerCase())) return false;
  const t = hit.cmd.text ?? {};
  const sub = t.sub ? tokens[0]?.toLowerCase() : undefined;
  const args = t.sub ? (t.subArgs?.[sub ?? ''] ?? []) : (t.args ?? []);
  // quick answers to typed commands clean themselves up, the server picks how long in /setup
  const clean = m.guildId ? store.guild(m.guildId).autoclean : 0;
  const after = (sent: Message, temp: boolean) => {
    if (temp && clean > 0 && sent?.id) store.deleteLater(sent.channelId, sent.id, Date.now() + clean * 1000);
  };
  void run(store, fromText(m, tokens, args, !!t.sub, after), hit.mod, hit.cmd);
  return true;
}

// buttons and menus on Texz's own messages
export async function onComponent(store: Store, i: Interaction) {
  try {
    if (await onSetup(store, i)) return;
    if (await onAnimeComponent(store, i)) return;
    if (await onWatchlist(store, i)) return;
    if (await onPollButton(store, i)) return;
    if (await onAvatarButton(i)) return;
    if (await onRoleButton(i)) return;
    if (await onCaseComponent(store, i)) return;
    if (await onGiveawayButton(store, i)) return;
  } catch (e) {
    report('component', e);
  }
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
    const hit = byName.get(name);
    if (!hit) return;
    // pages that belong to whoever opened them change in place, anyone else gets their own copy
    const edit = !!opts.owner && opts.owner === i.user.id;
    return run(store, fromComponent(i, opts, edit), hit.mod, hit.cmd);
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
