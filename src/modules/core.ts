import { servers } from './servers.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import type { Ctx } from '../core/ctx.js';
import { closest, search } from '../core/fuzzy.js';
import { isStaff } from '../core/staff.js';
import { defaultRules, type Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card, say } from '../theme.js';
import { isGifLink, resolve } from '../gifs.js';
import { setupPanel } from '../features/setup.js';

// filled in by the registry so help and config can list every module
// a few words on what each dashboard holds, for the help page
const blurb: Record<string, string> = {
  admin: 'mod, cases, giveaways, posts, setup', owo: 'huntbot, gems, zoo, weapons, timers', poketwo: 'claim help, hints, dex, race', shoob: 'rare drops, wishlist',
  anime: 'airing, search, your list, parties', sports: 'F1, football, predictions', fun: 'hug, bonk, quizzes, ship, quotes',
  profile: 'card, favourites, rank, medals, pings', yen: 'daily, wallet, give, role shop', misc: 'user, server, afk, reminders',
};

// the dashboards, filled in by the registry, so help can list them
export const dashList: { name: string; label: string; emoji: string; description: string; home: string; anywhere?: boolean }[] = [];
export const allModules: Module[] = [];

const switchable = () => allModules.filter((m) => !m.locked);

// moments an admin can attach a gif to
export const gifMoments = ['help', 'ping', 'status', 'error', 'huntbot', 'leaderboard', 'ask', 'levelup', 'welcome', 'goodbye', 'ban', 'kick', 'timeout', 'warn', 'giveaway', 'f1week', 'f1soon', 'f1win', 'f1quali', 'f1result', 'matchday', 'kickoff', 'fulltime', 'screening', 'episode'];

function rulesText(store: Store, guildId: string) {
  const g = store.guild(guildId);
  const out = [`Prefix: \`${g.prefix}\``, ''];
  for (const m of switchable()) {
    const r = { ...defaultRules(m.name), ...g.modules[m.name] };
    const where = r.channels.length ? r.channels.map((c) => `<#${c}>`).join(' ') : 'everywhere';
    const who = r.roles.length ? r.roles.map((x) => `<@&${x}>`).join(' ') : 'everyone';
    out.push(`${r.enabled ? '✅' : '⬜'} **${m.label}** (\`${m.name}\`): ${where}, ${who}`);
  }
  const gifs = Object.keys(g.gifs);
  if (gifs.length) out.push('', `🎞️ gifs set for: ${gifs.map((x) => `\`${x}\``).join(', ')}`);
  return out.join('\n');
}

import { examples, argsOf } from '../core/examples.js';
import { entriesOf } from '../core/dashboards.js';

const icons: Record<string, string> = { core: '🗂️', owo: '🐾', moderation: '🛡️', welcome: '🌸', levels: '🎖️', utility: '🧰', anime: '📺', giveaways: '🎁', birthdays: '🎂', server: '🏛️', economy: '💴', bulletins: '🗞️', spawns: '🎯' };

// who may see a command in help: staff things only for admins and the staff role
let staffNow = false;
function allowed(ctx: Ctx, c: Command) {
  if (c.name === 'backup' || c.name === 'setup') return ctx.isAdmin;
  if (c.admin || c.group === 'admin') return ctx.isAdmin || staffNow;
  return true;
}

// everything help can point at: commands people can run, not the dashboard homes
function catalogue(ctx: Ctx, store: Store) {
  const out: { m: Module; c: Command }[] = [];
  for (const m of allModules) {
    if (!m.locked && !store.rules(ctx.guildId, m.name).enabled) continue;
    for (const c of m.commands) {
      if (c.name.endsWith('home') || c.name === 'servers' || c.name === 'config' || c.name === 'untimeout') continue;
      if (c.hidden && !c.text) continue;
      if (allowed(ctx, c)) out.push({ m, c });
    }
  }
  return out;
}

const help: Command = {
  name: 'help',
  cooldown: 1,
  data: new SlashCommandBuilder().setName('help').setDescription('Everything Texz can do, or search it in plain words')
    .addStringOption((o) => o.setName('feature').setDescription('What you\'re after, like money, birthday or ping me')).toJSON(),
  text: { aliases: ['h', 'commands'], args: ['feature'] },
  example: 'birthday',
  run: (ctx, store) => {
    const prefix = ctx.guildId ? store.guild(ctx.guildId).prefix : 'tz';
    const gif = ctx.guildId ? store.guild(ctx.guildId).gifs.help ?? null : null;
    const raw = ctx.str('feature')?.toLowerCase().trim();
    const want = raw === 'home' ? undefined : raw || undefined;
    const all = catalogue(ctx, store);
    staffNow = isStaff(store, ctx);
    const staff = (d: { name: string }) => (d.name === 'admin' ? ctx.isAdmin || staffNow : true);
    const dashes = dashList.filter((d) => (ctx.guildId || d.anywhere) && staff(d));
    const dashMenu = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`nav|pick|owner=${ctx.userId},back=help`).setPlaceholder('Open a dashboard')
        .addOptions(dashes.map((d) => ({ label: d.label, value: d.home, emoji: d.emoji, description: `/${d.name} · ${prefix} ${d.name}` }))),
    );

    // a dashboard name opens that dashboard's own page
    const dash = want ? dashes.find((d) => d.name === want || d.label.toLowerCase() === want) : undefined;
    if (dash) return ctx.reply({ content: `Opening **${dash.label}**, or type \`${prefix} ${dash.name}\` next time.`, components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`nav|${dash.home}|owner=${ctx.userId}`).setLabel(`Open ${dash.label}`).setEmoji(dash.emoji).setStyle(ButtonStyle.Primary))], temp: true });

    if (want) {
      // an admin command asked for by name gets a straight answer instead of a near miss
      const locked = allModules.flatMap((m) => m.commands).find((c) => (c.name === want || c.call === want || c.text?.aliases?.includes(want)) && !allowed(ctx, c));
      if (locked) return ctx.reply({ embeds: [card({ kind: 'help', title: `${prefix} ${locked.call ?? locked.name}`, emoji: '🔐', gif: 'off', body: `${locked.data.description}.\nThat one is for staff, so it stays out of your menus.` })], components: [dashMenu] });
      const exact = all.find(({ c }) => c.name === want || c.call === want || c.text?.aliases?.includes(want));
      const found = search(want, all.map(({ m, c }) => ({ id: c.name, names: [c.name, c.call ?? '', ...(c.text?.aliases ?? []), c.as ?? ''].filter(Boolean), text: `${c.data.description} ${m.label} ${m.about} ${c.group ?? ''}` })));
      const pick = exact ?? all.find(({ c }) => c.name === found[0]?.id);
      if (!pick) {
        const near = closest(want.split(/\s+/)[0], all.flatMap(({ c }) => [c.name, ...(c.text?.aliases ?? [])]));
        return ctx.reply({ embeds: [card({ kind: 'missing', title: `Nothing on "${want}"`, emoji: '🔍', gif: 'off', body: `${near ? `Did you mean \`${prefix} help ${near}\`?\n` : ''}Try other words, like \`${prefix} help money\` or \`${prefix} help ping me\`, or open a dashboard below.` })], components: [dashMenu] });
      }
      const { m, c } = pick;
      const ex = examples(c, prefix);
      const others = found.filter((x) => x.id !== c.name).map((x) => all.find(({ c: o }) => o.name === x.id)!).filter(Boolean).slice(0, 5);
      const rows = [];
      if (others.length) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`nav|help|as=feature,owner=${ctx.userId}`).setPlaceholder('Not it? Other matches')
          .addOptions(others.map(({ c: o }) => ({ label: `${prefix} ${o.call ?? o.name}`, value: o.name, description: o.data.description.slice(0, 100) }))),
      ));
      rows.push(dashMenu);
      const group = dashList.find((d) => d.name === c.group);
      const parts = argsOf(c);
      const form = entriesOf(c)[0];
      if (form && (c.data.options ?? []).length) rows.unshift(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`nav|pick|owner=${ctx.userId},back=${group?.home ?? 'help'},key=${form.key}`).setLabel('Fill in a form instead').setStyle(ButtonStyle.Secondary),
      ));
      return ctx.reply({ embeds: [card({
        kind: 'help', title: `${prefix} ${c.call ?? c.name}`, emoji: '', gif,
        body: `${c.data.description}.`,
        fields: [
          ...ex.map((e) => ({ name: ex.length > 1 ? `${e.label}${e.about ? ` · ${e.about}`.slice(0, 200) : ''}` : 'Try it', value: `\`${e.typed}\`${c.hidden ? '' : `\n\`${e.slash}\``}`, inline: false })),
          ...(parts.length ? [{ name: 'What goes after it', value: parts.map((a) => `\`${a.shown}\` ${a.about}${a.required ? '' : ' · optional'}`).join('\n').slice(0, 1024), inline: false }] : []),
          ...(c.text?.aliases?.length ? [{ name: 'Shorter', value: c.text.aliases.filter((a) => !a.includes(' ')).slice(0, 4).map((a) => `\`${prefix} ${a}\``).join(' · ') || '—', inline: true }] : []),
          ...(group ? [{ name: 'Lives in', value: `${group.label} · \`${prefix} ${group.name}\``, inline: true }] : []),
          ...(c.admin ? [{ name: 'Who', value: 'Admins and the staff role', inline: true }] : []),
          { name: '\u200b', value: !exact && found.length ? `-# Closest match for "${want}". Leave anything you're not sure about out and I'll ask.` : '-# Leave anything out and I\'ll ask. Slash replies only show to you, typed ones to everyone.', inline: false },
        ],
      })], components: rows });
    }

    // the front page is the dashboards, the same map as /owo, /fun and the rest
    const rows = [dashMenu];
    if (ctx.isAdmin && ctx.guildId) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`nav|setup|owner=${ctx.userId}`).setLabel('Setup desk').setStyle(ButtonStyle.Secondary),
    ));
    return ctx.reply({ embeds: [card({
      kind: 'help', title: 'The Agency directory', emoji: '', gif,
      body: [
        '*Ten doors, one building. Each one has buttons for what works with a click, and examples for what you type.*',
        '',
        ...dashes.map((d) => `${d.emoji} **${d.label}** · \`${prefix} ${d.name}\`\n-# ${blurb[d.name] ?? ''}`),
        '',
        `Lost? Ask in plain words: \`${prefix} help money\` · \`${prefix} help hug\``,
      ].join('\n'),
    })], components: rows });
  },
};

const setup: Command = {
  name: 'setup',
  admin: true,
  data: new SlashCommandBuilder().setName('setup').setDescription('Set up everything with buttons: features, welcome, autorole, logs, levels, gifs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false).toJSON(),
  text: { aliases: ['panel', 'frontdesk'] },
  run: (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Setup lives inside a server.');
    // buttons on error messages open the page that fixes the problem
    return ctx.reply({ ...setupPanel(store, ctx.guild, ctx.userId, ctx.str('page') ?? 'home'), private: true });
  },
};

// the typed version of setup, kept for people who like typing, it has no slash command
const config: Command = {
  name: 'config',
  admin: true,
  hidden: true,
  data: new SlashCommandBuilder().setName('config').setDescription('Turn features on or off and limit where they work')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('Show every feature and its limits'))
    .addSubcommand((s) => s.setName('feature').setDescription('Switch a feature on or off')
      .addStringOption((o) => o.setName('name').setDescription('Feature').setRequired(true).setAutocomplete(false))
      .addBooleanOption((o) => o.setName('on').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('Only allow a feature in certain channels')
      .addStringOption((o) => o.setName('name').setDescription('Feature').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('add, remove or clear').setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'clear', value: 'clear' }))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('role').setDescription('Only allow a feature for certain roles')
      .addStringOption((o) => o.setName('name').setDescription('Feature').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('add, remove or clear').setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'clear', value: 'clear' }))
      .addRoleOption((o) => o.setName('role').setDescription('Role')))
    .addSubcommand((s) => s.setName('gif').setDescription('Pick a gif for a moment, like help or levelup')
      .addStringOption((o) => o.setName('moment').setDescription('Which moment').setRequired(true)
        .addChoices(...gifMoments.map((m) => ({ name: m, value: m }))))
      .addStringOption((o) => o.setName('url').setDescription('Giphy or Tenor link, .gif link, "default" or "off"').setRequired(true)))
    .addSubcommand((s) => s.setName('prefix').setDescription('Change the short text prefix')
      .addStringOption((o) => o.setName('prefix').setDescription('Like tz').setRequired(true).setMaxLength(5)))
    .toJSON(),
  text: {
    aliases: ['cfg'],
    sub: true,
    subArgs: { feature: ['name', 'on'], channel: ['name', 'action', 'channel'], role: ['name', 'action', 'role'], prefix: ['prefix'], gif: ['moment', 'url'] },
  },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Server settings only make sense inside a server.');
    const g = store.guild(ctx.guildId);
    // plain "tz config" opens /setup, the typed subcommands stay for people who like them
    if (!ctx.sub() && ctx.guild) return ctx.reply({ ...setupPanel(store, ctx.guild, ctx.userId, 'features'), private: true });
    const sub = ctx.sub() ?? 'view';
    const name = ctx.str('name')?.toLowerCase();
    const mod = name ? switchable().find((m) => m.name === name) : undefined;
    if (['feature', 'channel', 'role'].includes(sub) && !mod) {
      return ctx.reply(`Which feature? Options: ${switchable().map((m) => `\`${m.name}\``).join(', ')}`);
    }
    const rules = mod ? { ...defaultRules(mod.name), ...g.modules[mod.name] } : null;

    if (sub === 'feature' && mod && rules) {
      const on = ctx.bool('on');
      if (on === null) return ctx.reply(`Like this: \`${g.prefix} config feature ${mod.name} off\``);
      rules.enabled = on;
    }
    if ((sub === 'channel' || sub === 'role') && mod && rules) {
      const action = ctx.str('action');
      const list = sub === 'channel' ? rules.channels : rules.roles;
      const id = sub === 'channel' ? ctx.channel('channel') : ctx.role('role');
      if (action === 'clear') list.length = 0;
      else if ((action === 'add' || action === 'remove') && id) {
        const at = list.indexOf(id);
        if (action === 'add' && at < 0) list.push(id);
        if (action === 'remove' && at >= 0) list.splice(at, 1);
      } else return ctx.reply(`Like this: \`${g.prefix} config ${sub} ${mod.name} add ${sub === 'channel' ? '#channel' : '@role'}\``);
    }
    if (sub === 'prefix') {
      const p = ctx.str('prefix')?.trim().toLowerCase();
      if (!p || /\s/.test(p) || p === 'owo' || p === 'w') return ctx.reply('Pick a short prefix without spaces, and not `owo` or `w`, those are taken.');
      g.prefix = p;
    }
    if (sub === 'gif') {
      const moment = ctx.str('moment')?.toLowerCase() ?? '';
      const url = ctx.str('url')?.trim() ?? '';
      if (!gifMoments.includes(moment)) return ctx.reply(`Moments: ${gifMoments.map((m) => `\`${m}\``).join(', ')}`);
      if (url === 'clear' || url === 'default') delete g.gifs[moment];
      else if (url === 'off') g.gifs[moment] = 'off';
      else if (isGifLink(url)) {
        if (!(await resolve(url))) return ctx.reply('I couldn\'t open that gif. Use a Giphy link, a Tenor share link, or a direct link ending in `.gif`.');
        g.gifs[moment] = url;
      } else return ctx.reply('Send a Giphy link (giphy.com/gifs/...), a Tenor share link, or a direct `.gif` link. `default` puts mine back, `off` hides it.');
    }
    if (mod && rules) g.modules[mod.name] = rules;
    if (sub !== 'view') store.saveGuild(ctx.guildId, g);
    return ctx.reply(card({ kind: 'settings', title: 'Server settings', emoji: '🏛️', body: rulesText(store, ctx.guildId) }));
  },
};

const started = Date.now();

// how Texz feels about the connection, slow pings get the sulky lines
function pingMood(ms: number) {
  if (ms < 0) return 'Still waking up, the heartbeat hasn\'t settled. Ask again in a bit~';
  if (ms < 80) return 'Faster than Kunikida-kun can open his notebook. Impressive, even for me.';
  if (ms < 160) return 'A perfectly respectable speed. Not that I was rushing.';
  if (ms < 300) return 'A little sluggish. I blame the crab I had for lunch.';
  return 'Slow. Ranpo-san on a Monday slow. Someone check the wires, I\'m not getting up.';
}

const ping: Command = {
  name: 'ping',
  data: new SlashCommandBuilder().setName('ping').setDescription('Poke Texz and see how quickly he answers').toJSON(),
  text: { aliases: ['pong'] },
  run: (ctx, store) => {
    const ms = Math.round(ctx.latency());
    const up = Date.now() - started;
    const h = Math.floor(up / 3_600_000);
    const m = Math.floor((up % 3_600_000) / 60_000);
    return ctx.reply(card({
      kind: 'ping', title: 'You rang?', emoji: '😪',
      gif: ctx.guildId ? store.guild(ctx.guildId).gifs.ping ?? null : null,
      body: `*${pingMood(ms)}*`,
      fields: [
        { name: '💓 Heartbeat', value: ms < 0 ? 'warming up' : `**${ms}** ms`, inline: true },
        { name: '😴 Awake for', value: h ? `${h}h ${m}m` : `${m}m`, inline: true },
        { name: '🦀 Crab eaten today', value: String(1 + (new Date().getDate() % 4)), inline: true },
      ],
    }));
  },
};

export const core: Module = {
  name: 'core',
  label: 'Core',
  about: 'Help, server settings and the basics',
  locked: true,
  commands: [help, setup, ping, config, servers],
};

