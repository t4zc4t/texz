import {
  ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, InteractionContextType, MessageFlags, PermissionFlagsBits, type MessageActionRowComponentBuilder,
  type ChatInputCommandInteraction, type Interaction, type Message, type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { armouryPage, parseArmId, filters, sorts, type Filter, type Sort } from '../features/armoury-pages.js';
import { apply, modalFor, panel, parseRp } from '../features/panel.js';
import type { Store } from '../db.js';
import { core, allModules, dashList, setGroupOpener } from '../modules/core.js';
import { owo } from '../modules/owo.js';
import { anime, onAnimeComponent, onGuess } from '../modules/anime.js';
import { onF1Quiz } from '../modules/f1quiz.js';
import { onPredict } from '../modules/predict.js';
import { onOwnerButton, onOwnerConfirm } from '../modules/servers.js';
import { economy } from '../modules/economy.js';
import { bulletins, onBulletinButton } from '../modules/bulletins.js';
import { onWatchlist } from '../modules/watchlist.js';
import { onAvatarButton, onPollButton, utility } from '../modules/utility.js';
import { moderation, onCaseComponent } from '../modules/moderation.js';
import { onRoleButton, welcomeModule } from '../modules/welcome.js';
import { levelsModule } from '../modules/levels.js';
import { giveaways, onGiveawayButton } from '../modules/giveaways.js';
import { birthdays } from '../modules/birthdays.js';
import { onServerComponent, server } from '../modules/server.js';
import { onSetup, useModules } from '../features/setup.js';
import { RED, card, type Kind } from '../theme.js';
import { countUse, report } from '../ops.js';
import { quoteCommand } from '../modules/quote.js';
import { onProfileEdit } from '../modules/profile.js';
import { onAchPick } from '../modules/missions.js';
import { community, onConfess } from '../modules/community.js';
import { actions, onAct } from '../modules/actions.js';
import { onShip } from '../modules/ship.js';
import { onCatchCopy, onPingsButton, onSpawnButton, spawnsModule } from '../modules/spawns.js';
import { fromComponent, fromSlash, fromText, withTokens, type Ctx } from './ctx.js';
import { slashPath, type Command, type Module } from './module.js';
import { glance, layout } from './glance.js';
import { closest } from './fuzzy.js';
import { isStaff } from './staff.js';
import { fixText, setupButton, usualPerms } from './fixes.js';
import { askModal, entriesOf, homePage, needsInput, refPage, refPageOf, parseKey, readModal, type Entry, type GroupInfo } from './dashboards.js';

export const modules: Module[] = [core, owo, anime, utility, moderation, welcomeModule, levelsModule, giveaways, birthdays, server, economy, bulletins, spawnsModule, community, actions];
allModules.push(...modules);
useModules(modules);

// every group is one slash command and one typed word that opens its dashboard, everything else is picked from there
type Group = GroupInfo & { description: string; perms?: bigint; anywhere?: boolean; dashboard?: string; staff?: boolean; old: string[] };
const groups: Record<string, Group> = {
  admin: { label: 'Port Mafia HQ', emoji: '🖤', about: '*The executives\' floor. Discipline, rewards and the building itself.*\nAdmins and the staff role only.', description: 'Admins only: moderation, giveaways, role pickers, posts, xp and setup', staff: true, perms: PermissionFlagsBits.ManageMessages, old: ['staff', 'mod', 'tools', 'hq', 'mafia'], extra: ['setup'] },
  owo: { label: 'Stray Dogs Den', emoji: '🐾', about: '', description: 'OwO: huntbot, gems, zoo, weapons, quests, timers and the shop', anywhere: true, old: [] },
  poketwo: { label: 'Pokédex Bureau', emoji: '🔴', about: '*Every creature on file, every catch accounted for.*\nClaim help, hints, the server Pokédex and the weekly race.', description: 'Pokétwo: claim help, hints, the Pokédex and the catch race', old: ['p2', 'pokétwo'], extra: ['pings'] },
  shoob: { label: 'Card Vault', emoji: '🃏', about: '*Some cards are worth waiting for.*\nRare drop pings and a wishlist for the characters you want.', description: 'Shoob: rare drop pings and your character wishlist', old: [], extra: ['spawns', 'pings'] },
  anime: { label: 'Literary Annex', emoji: '📚', about: '', description: 'Anime and manga: what\'s airing, search, your list, watch parties', anywhere: true, old: ['annex'], extra: ['animehome'] },
  sports: { label: 'Paddock & Pitch', emoji: '🏁', about: '*Odds, engines and ninety minutes of chaos.*\nFormula 1, football from the big leagues, and predictions that pay.', description: 'F1, football and predictions', anywhere: true, old: ['sport'], extra: ['pings'] },
  fun: { label: 'Bar Lupin', emoji: '🥃', about: '*Three glasses on the counter. Pull up a stool.*\nQuizzes that pay yen, games for the channel, confessions and dice.', description: 'Quizzes, guess the anime, ship, polls, quotes, confessions, dice', anywhere: true, old: ['games', 'game'] },
  profile: { label: 'Personnel File', emoji: '🪪', about: '*Everything the Agency knows about you. Mostly flattering.*\nYour card, favourites, rank, medals, birthday and every ping you get.', description: 'Your profile card, favourites, rank, medals, birthday and pings', anywhere: true, old: ['you', 'me', 'file'] },
  yen: { label: 'Yen Ledger', emoji: '💴', about: '*Kunikida balances it. Dazai owes it.*\nDaily yen, your wallet, paying people, the rich list and the role shop.', description: 'Daily yen, wallet, give, richest and the role shop', old: ['eco', 'money', 'bank'] },
  misc: { label: 'Odds & Ends', emoji: '🧰', about: '*The drawer nobody labels.*\nLook people up, server info, afk, one-off reminders and the bot ping.', description: 'User and server info, avatar, afk, reminders', anywhere: true, old: ['info', 'utils', 'odds'], extra: ['ping'] },
};

// where each command sits and the short name it goes by inside its dashboard, "/admin view:mute" or "tz admin mute"
const place: Record<string, [string, string?]> = {
  warn: ['admin'], case: ['admin'], timeout: ['admin', 'mute'], kick: ['admin'], ban: ['admin'], unban: ['admin'], purge: ['admin'], lock: ['admin'], slowmode: ['admin', 'slow'],
  act: ['fun'], bonds: ['profile'],
  rolepicker: ['admin', 'roles'], xp: ['admin'], giveaway: ['admin', 'gaw'], announce: ['admin', 'post'], serverstats: ['admin', 'stats'], backup: ['admin'],
  reminders: ['owo', 'timers'],
  poll: ['fun'], choose: ['fun', 'pick'], roll: ['fun'], coin: ['fun', 'flip'], ship: ['fun'], '8ball': ['fun'], guess: ['fun'], quiz: ['fun'], trivia: ['fun'],
  onthisday: ['fun', 'otd'], crestquiz: ['fun', 'crest'], quote: ['fun'], confess: ['fun'],
  profile: ['profile', 'card'], achievements: ['profile', 'medals'], rank: ['profile'], levels: ['profile', 'top'], perks: ['profile'], mission: ['profile'], birthday: ['profile', 'bday'], pings: ['profile'],
  daily: ['yen'], mycolour: ['yen', 'mycolour'], wallet: ['yen', 'bal'], give: ['yen'], rich: ['yen', 'top'], roleshop: ['yen', 'shop'],
  user: ['misc'], avatar: ['misc', 'av'], server: ['misc'], afk: ['misc'], remind: ['misc'],
};
for (const mod of [owo, utility, moderation, welcomeModule, levelsModule, giveaways, birthdays, server, economy, community, spawnsModule, actions]) for (const cmd of mod.commands) {
  const to = place[cmd.name];
  if (!to) continue;
  cmd.group = to[0];
  cmd.as = to[1];
  // a few levels pages were hidden before, they have a home now
  if (['levels', 'perks', 'rich', 'daily', 'avatar'].includes(cmd.name)) cmd.hidden = false;
}
// "tz yen" opens the ledger now, the daily keeps its other names
for (const cmd of economy.commands) if (cmd.text?.aliases) cmd.text.aliases = cmd.text.aliases.filter((a) => a !== 'yen');

// the old dashboard names still open the new ones, so "tz games" or "/mod" habits keep working
const oldGroup = new Map(Object.entries(groups).flatMap(([name, g]) => g.old.map((o) => [o, name] as const)));

// staff run the admin dashboard like admins do, except the backup, which stays with admins
const staffCmd = (cmd: Command) => (cmd.group === 'admin' || cmd.name === 'adminhome') && cmd.name !== 'backup';

type Hit = { mod: Module; cmd: Command };
const dashNames = new Set<string>();
const byName = new Map<string, Hit>();
const bySlash = new Map<string, Hit>();
const byText = new Map<string, Hit>();
for (const mod of modules) for (const cmd of mod.commands) {
  byName.set(cmd.name, { mod, cmd });
  if (!cmd.hidden) bySlash.set(slashPath(cmd), { mod, cmd });
  // typed "tz owo huntbot" mirrors "/owo view:huntbot"
  if (cmd.group && !bySlash.has(`${cmd.group} ${cmd.as ?? cmd.name}`)) bySlash.set(`${cmd.group} ${cmd.as ?? cmd.name}`, { mod, cmd });
  for (const name of [cmd.name, ...(cmd.text?.aliases ?? [])]) byText.set(name, { mod, cmd });
}

// the menu lines of a group, its own commands first, then borrowed ones
const groupEntries = (name: string): { hit: Hit; e: Entry }[] => {
  const own = [...byName.values()].filter((h) => h.cmd.group === name && !h.cmd.hidden);
  const extra = (groups[name].extra ?? []).map((n) => byName.get(n)).filter((h): h is Hit => !!h);
  return [...own, ...extra].flatMap((hit) => entriesOf(hit.cmd).map((e) => ({ hit, e })));
};
const findEntry = (key: string) => {
  const { name } = parseKey(key);
  const hit = byName.get(name);
  const e = hit ? entriesOf(hit.cmd).find((x) => x.key === key) : undefined;
  return hit && e ? { hit, e } : null;
};

// groups without a hand made dashboard get the generic one
for (const [name, g] of Object.entries(groups)) {
  dashNames.add(g.dashboard ?? `${name}home`);
  dashList.push({ name, label: g.label, emoji: g.emoji, description: g.description, home: g.dashboard ?? `${name}home`, anywhere: g.anywhere });
  if (g.dashboard) continue;
  g.dashboard = `${name}home`;
  const cmd: Command = {
    name: g.dashboard,
    hidden: true,
    data: { name: g.dashboard, description: g.description },
    run: (ctx, store) => {
      const all = groupEntries(name);
      const on = (h: Hit) => h.mod.locked || store.rules(ctx.guildId, h.mod.name).enabled;
      const off = [...new Set(all.filter(({ hit }) => !on(hit)).map(({ hit }) => hit.mod.label))];
      // in the order the group's sections give, so related commands sit together
      const order = (layout[name]?.sections ?? []).flatMap(([, keys]) => keys);
      const rank = (e: Entry) => { const i = order.findIndex((k) => k === e.key || k.split(/[.~]/)[0] === e.cmd.name); return i < 0 ? order.length : i; };
      const live = all.filter(({ hit }) => on(hit)).map(({ e }) => e).sort((a, b) => rank(a) - rank(b));
      const prefix = ctx.guildId ? store.guild(ctx.guildId).prefix : 'tz';
      const look = all.some(({ hit }) => on(hit)) ? glance(name, ctx, store) : null;
      // the admin floor stays a dashboard with buttons, every other group is a list of commands to type
      if (name === 'admin') return ctx.reply(homePage(ctx, g.dashboard!, g, live, { layout: layout[name], glance: look, off, prefix }));
      const focus = ctx.str('focus') ?? undefined;
      const page = ctx.int('page') ?? (focus ? refPageOf(live, name, prefix, focus) : 0);
      return ctx.reply(refPage(ctx, g.dashboard!, g, live, { group: name, prefix, page, focus, glance: page === 0 ? look : null, off }));
    },
  };
  core.commands.push(cmd);
  byName.set(cmd.name, { mod: core, cmd });
}

// help for one command opens its group's list at the right page
setGroupOpener((ctx, store, group, focus) => {
  const hit = byName.get(groups[group].dashboard!);
  if (!hit) return Promise.resolve();
  const at: Ctx = { ...ctx, str: (n) => (n === 'focus' ? focus : n === 'page' ? null : ctx.str(n)), int: (n) => (n === 'page' ? null : ctx.int(n)) };
  return hit.cmd.run(at, store);
});

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

// commands people can also use after adding Texz to their own account, in any server or DM
const anywhereTop = new Set(['help', 'ping']);
const everywhere = { integration_types: [0, 1], contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel] };
const serverOnly = { integration_types: [0], contexts: [InteractionContextType.Guild] };

const visible = modules.flatMap((m) => m.commands.filter((c) => !c.hidden));
export const definitions: Json[] = [
  quoteCommand as unknown as Json,
  ...visible.filter((c) => !c.group).map((c) => ({ ...c.data, ...(anywhereTop.has(c.name) ? everywhere : c.data.contexts ? {} : serverOnly) })),
  ...Object.entries(groups).map(([name, g]) => ({
    name,
    description: g.description,
    ...(g.anywhere ? everywhere : serverOnly),
    ...(g.perms ? { default_member_permissions: g.perms.toString() } : {}),
    // one command with a view picker and a free text box, empty opens the dashboard
    options: [
      { type: ApplicationCommandOptionType.String, name: 'view', description: 'Leave empty for the dashboard', choices: visible.filter((c) => c.group === name).slice(0, 25).map((c) => ({ name: c.as ?? c.name, value: c.as ?? c.name })) },
      { type: ApplicationCommandOptionType.String, name: 'input', description: 'Optional, whatever that view needs. Leave empty and I\'ll ask', max_length: 200 },
    ] as Opt[],
  })),
];

// the on/off switch, channel limits and role limits, checked before every command
type Block = { kind: Kind; vars?: Record<string, string> };

function gate(store: Store, ctx: Ctx, mod: Module, cmd: Command): Block | null {
  if (!ctx.isAdmin && staffCmd(cmd) && isStaff(store, ctx)) ctx.isAdmin = true;
  if (cmd.group === 'admin' && !ctx.isAdmin) return { kind: 'noPerm' };
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

// a short wait between uses so nobody floods a channel, longer for the ones that draw pictures or call outside sites
const heavy = new Set(['rank', 'profile', 'ship', 'guess', 'f1', 'football', 'anime', 'manga', 'character', 'season', 'trending', 'recommend', 'airing', 'animehome', 'avatar', 'serverstats', 'rich', 'leaderboard', 'levels']);
export const cooldownOf = (cmd: Command) => cmd.cooldown ?? (heavy.has(cmd.name) ? 8 : 3);
const used = new Map<string, number>();
export const clearCooldowns = () => used.clear();

function coolingDown(ctx: Ctx, cmd: Command): number {
  if (cmd.admin) return 0;
  const key = `${ctx.userId}:${cmd.name}`;
  const now = Date.now();
  const until = used.get(key) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  used.set(key, now + cooldownOf(cmd) * 1000);
  // keep the map small
  if (used.size > 5000) for (const [k, t] of used) if (t < now) used.delete(k);
  return 0;
}

async function run(store: Store, ctx: Ctx, mod: Module, cmd: Command, cool = true) {
  // where Back goes from this page: a dashboard goes back to help, anything else to its own dashboard
  ctx.self = cmd.name;
  ctx.home ??= dashNames.has(cmd.name) ? 'help' : groups[cmd.group ?? '']?.dashboard ?? 'help';
  const blocked = gate(store, ctx, mod, cmd);
  if (blocked) return ctx.reply({ embeds: [card({ ...blocked, title: 'Not this time', emoji: '🚫', color: RED, gif: 'off' })], temp: true });
  // buttons on dashboards move between pages, they don't count
  const wait = cool ? coolingDown(ctx, cmd) : 0;
  if (wait) return ctx.reply({ content: `⏳ Easy, give it **${wait}s**. Even Dazai takes breaks between schemes.`, temp: true });
  countUse(cmd.name);
  try {
    await cmd.run(ctx, store);
  } catch (e) {
    // Discord said no because of a permission, say which one instead of a shrug
    if ((e as { code?: number }).code === 50013 && ctx.guild) {
      const fix = fixText(ctx.guild, { perms: usualPerms, channelId: ctx.channelId }) ?? '🔧 Discord says I\'m missing a permission for that. Check my role in Server Settings → Roles, and this channel\'s permissions.';
      await ctx.reply({ content: fix, components: ctx.isAdmin ? [setupButton(ctx.userId)] : [], temp: true }).catch(() => {});
      return;
    }
    report(`${cmd.name} failed`, e);
    await ctx.reply({ embeds: [card({ kind: 'error', title: 'Well, that slipped', emoji: '🩹', color: RED })], temp: true }).catch(() => {});
  }
}

export async function onSlash(store: Store, i: ChatInputCommandInteraction) {
  const g = groups[i.commandName];
  if (g) {
    let view = i.options.getString('view');
    const input = i.options.getString('input') ?? '';
    // "/anime input:frieren" is a search
    if (!view && input && i.commandName === 'anime') view = 'search';
    const hit = view ? bySlash.get(`${i.commandName} ${view}`) : byName.get(g.dashboard!);
    if (!hit) return;
    // a view that needs something and got nothing asks for it, or shows its parts to pick from
    if (view && !input) {
      const parts = entriesOf(hit.cmd);
      if (parts.length > 1) return run(store, fromSlash(i, null), core, pickerFor(i.commandName, parts));
      if (parts[0] && needsInput(parts[0])) {
        const blocked = gate(store, fromSlash(i, null), hit.mod, hit.cmd);
        if (!blocked) return i.showModal(askModal(parts[0], i.user.id, g.dashboard!));
      }
    }
    const t = hit.cmd.text;
    const tokens = input.split(/\s+/).filter(Boolean);
    const args = t?.sub ? t.subArgs?.[tokens[0]?.toLowerCase() ?? ''] ?? [] : t?.args ?? [];
    return run(store, withTokens(fromSlash(i, null), tokens, args, !!t?.sub), hit.mod, hit.cmd);
  }
  const hit = bySlash.get(i.commandName);
  if (hit) return run(store, fromSlash(i), hit.mod, hit.cmd);
}

// a small page of one command's parts, like giveaway start, end and reroll
function pickerFor(group: string, parts: Entry[]): Command {
  const g = groups[group];
  return {
    name: `${group}parts`, hidden: true, data: { name: 'parts', description: parts[0].cmd.data.description },
    run: (ctx) => ctx.reply(homePage(ctx, g.dashboard!, { ...g, label: `${g.label} · ${parts[0].cmd.as ?? parts[0].cmd.name}`, about: parts[0].cmd.data.description }, parts)),
  };
}

export function isEnabled(store: Store, guildId: string | null, module: string) {
  return store.rules(guildId, module).enabled;
}

// names a typo can be matched to: everything people can type, minus the dashboard homes
const typoTargets = () => [...byText.entries()].filter(([, h]) => !dashNames.has(h.cmd.name) && !h.cmd.name.endsWith('home') && h.cmd.name !== 'servers').map(([k]) => k);

// "tz status", "tz hb", "tzstatus" all work, case doesn't matter
export function onText(store: Store, m: Message): boolean {
  const prefix = m.guildId ? store.guild(m.guildId).prefix : 'tz';
  const text = m.content.trim();
  if (!text.toLowerCase().startsWith(prefix)) return false;
  const body = text.slice(prefix.length);
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  let name = tokens.shift()?.toLowerCase();
  if (name && oldGroup.has(name) && !byText.has(name)) name = oldGroup.get(name)!;
  // just the prefix on its own opens help
  if (!name && text.length === prefix.length) name = 'help';
  if (!name) return false;
  // two word names like "tz quiz crest" or "tz predict top"
  const two = tokens[0] ? `${name} ${tokens[0].toLowerCase()}` : '';
  if (two && byText.has(two)) { tokens.shift(); name = two; }
  // "tz mod warn @x" works like "/mod warn", but "tz anime frieren" is still a search
  const next = tokens[0]?.toLowerCase();
  const member = groups[name] && next
    ? bySlash.get(`${name} ${next}`) ?? (byText.get(next)?.cmd.group === name ? byText.get(next) : undefined)
    : undefined;
  if (member) { tokens.shift(); name = member.cmd.name; }
  // "tz fun" on its own opens the dashboard, "tz owo" too
  const hit = member ?? (groups[name] && !tokens.length ? byName.get(groups[name].dashboard!) : undefined) ?? byText.get(name) ?? (groups[name] ? byName.get(groups[name].dashboard!) : undefined);
  if (!hit) {
    // a typo after the prefix gets a nudge to the nearest command, plain chat that happens to start with tz doesn't
    if (!/^\s/.test(body)) return false;
    const near = closest(name, typoTargets());
    const target = near ? byText.get(near) : undefined;
    if (!target) return false;
    void m.reply({
      content: `🤔 No \`${prefix} ${name}\` in my files. Did you mean **\`${prefix} ${target.cmd.call ?? near}\`**?`,
      components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`nav|${target.cmd.name}|owner=${m.author.id}`).setLabel(`Run ${prefix} ${target.cmd.call ?? near}`).setEmoji('▶️').setStyle(ButtonStyle.Primary))],
      allowedMentions: { repliedUser: false },
    }).then((sent) => store.deleteLater(sent.channelId, sent.id, Date.now() + 60_000)).catch(() => {});
    return true;
  }
  // "tzatziki" shouldn't trigger anything, only a space or a real command name after the prefix
  if (body && !/^\s/.test(body) && !byText.has(body.split(/\s+/)[0].toLowerCase())) return false;
  const t = hit.cmd.text ?? {};
  // "tz ship" with nobody named gets a button that opens a small form
  const parts = entriesOf(hit.cmd);
  if (!tokens.length && parts.length === 1 && needsInput(parts[0])) {
    void m.reply({
      content: `📝 **${parts[0].label}** needs a bit more. Press the button and I'll ask, or type it: \`${prefix} ${hit.cmd.name} ${(t.args ?? []).map((a) => `<${a}>`).join(' ')}\``,
      components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`nav|pick|owner=${m.author.id},key=${parts[0].key}`).setLabel('Fill it in').setEmoji('📝').setStyle(ButtonStyle.Primary))],
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
    return true;
  }
  const sub = t.sub ? tokens[0]?.toLowerCase() : undefined;
  const args = t.sub ? (t.subArgs?.[sub ?? ''] ?? []) : (t.args ?? []);
  // quick answers to typed commands clean themselves up, the server picks how long in /setup
  const clean = m.guildId ? store.guild(m.guildId).autoclean : 0;
  // dashboards and menus posted in the channel stop taking clicks after a while, so old ones don't pile up live
  const menuLike = dashNames.has(hit.cmd.name) || ['help', 'pings', 'spawns'].includes(hit.cmd.name);
  const after = (sent: Message, temp: boolean) => {
    if (temp && clean > 0 && sent?.id) store.deleteLater(sent.channelId, sent.id, Date.now() + clean * 1000);
    if (menuLike && sent?.edit) setTimeout(() => void sent.edit({ components: [] }).catch(() => {}), 10 * 60_000).unref?.();
  };
  void run(store, fromText(m, tokens, args, !!t.sub, after), hit.mod, hit.cmd);
  return true;
}

const optsOf = (extra?: string) => {
  const opts: Record<string, string> = {};
  if (extra) for (const pair of extra.split(',')) { const [k, v] = pair.split('='); if (k) opts[k] = v; }
  return opts;
};

// buttons and menus on Texz's own messages
export async function onComponent(store: Store, i: Interaction) {
  try {
    if (await onSetup(store, i)) return;
    if (await onAnimeComponent(store, i)) return;
    if (await onWatchlist(store, i)) return;
    if (await onPollButton(store, i)) return;
    if (await onAvatarButton(i)) return;
    if (await onRoleButton(store, i)) return;
    if (await onCaseComponent(store, i)) return;
    if (await onGiveawayButton(store, i)) return;
    if (await onServerComponent(store, i)) return;
    if (await onGuess(store, i)) return;
    if (await onF1Quiz(store, i)) return;
    if (await onSpawnButton(store, i)) return;
    if (await onPingsButton(store, i)) return;
    if (await onCatchCopy(i)) return;
    if (await onPredict(store, i)) return;
    if (await onOwnerButton(i)) return;
    if (await onOwnerConfirm(i)) return;
    if (await onProfileEdit(store, i)) return;
    if (await onAchPick(store, i)) return;
    if (await onConfess(store, i)) return;
    if (await onShip(i)) return;
    if (await onAct(store, i)) return;
    if (await onBulletinButton(i, store)) return;
  } catch (e) {
    report('component', e);
  }
  if (i.isModalSubmit() || i.isButton() || i.isStringSelectMenu()) {
    const rp = parseRp(i.customId);
    if (rp) return onPanel(store, i, rp).catch((e) => report('panel', e));
  }
  // a filled in form from a dashboard pick
  if (i.isModalSubmit() && i.customId.startsWith('ask|')) {
    const [, key, extra] = i.customId.split('|');
    const found = findEntry(key);
    if (!found) return;
    const opts: Record<string, string> = { ...optsOf(extra), ...readModal(i, found.e), ...(found.e.fixed ?? {}), ...(found.e.sub ? { sub: found.e.sub } : {}) };
    const edit = opts.owner === i.user.id && i.isFromMessage();
    return run(store, fromComponent(i, opts, edit), found.hit.mod, found.hit.cmd, false);
  }
  if (!i.isButton() && !i.isStringSelectMenu()) return;
  // "nav|command|option=value" buttons open another screen, just for whoever pressed it
  if (i.customId.startsWith('nav|')) {
    const [, name0, extra] = i.customId.split('|');
    const opts = optsOf(extra);
    if (i.isStringSelectMenu() && name0 !== 'pick') opts[opts.as ?? 'value'] = i.values[0];
    // pages that belong to whoever opened them change in place, anyone else gets their own copy
    const edit = !!opts.owner && opts.owner === i.user.id;
    if (name0 === 'pick') {
      const key = i.isStringSelectMenu() ? i.values[0] : opts.key;
      const found = key ? findEntry(key) : null;
      // the hand made dashboards name the command itself
      if (!found) {
        const hit = key ? byName.get(key) : undefined;
        return hit ? run(store, fromComponent(i, opts, edit), hit.mod, hit.cmd, false) : undefined;
      }
      const ctx = fromComponent(i, opts, edit);
      // pick something that needs a name or a number, and a small form asks for it
      if (needsInput(found.e)) {
        const blocked = gate(store, ctx, found.hit.mod, found.hit.cmd);
        if (blocked) return run(store, ctx, found.hit.mod, found.hit.cmd, false);
        return i.showModal(askModal(found.e, i.user.id, opts.back ?? groups[found.hit.cmd.group ?? '']?.dashboard ?? 'help'));
      }
      Object.assign(opts, found.e.fixed ?? {}, found.e.sub ? { sub: found.e.sub } : {});
      return run(store, fromComponent(i, opts, edit), found.hit.mod, found.hit.cmd, false);
    }
    const hit = byName.get(name0);
    if (!hit) return;
    return run(store, fromComponent(i, opts, edit), hit.mod, hit.cmd, false);
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
  await i.update(armouryPage(store, arm.userId, page, filter, sort)).catch((e) => report('armoury page', e));
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
