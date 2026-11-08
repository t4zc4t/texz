import { ActionRowBuilder, ChannelType, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import { slashPath, type Command, type Module } from '../core/module.js';
import { card, say } from '../theme.js';
import { isGifLink, resolve } from '../gifs.js';
import { setupPanel } from '../features/setup.js';

// filled in by the registry so help and config can list every module
// a few words on what each dashboard holds, for the help page
const blurb: Record<string, string> = {
  owo: 'timers, huntbot, gems, weapons', anime: 'search, airing, your list', fun: 'quizzes, quotes, ship, spawns',
  eco: 'daily, balance, role shop', levels: 'rank card, perks, top', info: 'profile, pings, birthdays',
  sports: 'F1 and football', mod: 'actions and cases', tools: 'giveaways, posts, stats',
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

const icons: Record<string, string> = { core: '🗂️', owo: '🐾', moderation: '🛡️', welcome: '🌸', levels: '🎖️', utility: '🧰', anime: '📺', giveaways: '🎁', birthdays: '🎂', server: '🏛️', economy: '💴', bulletins: '🗞️', spawns: '🎯' };

// both ways to run a command, written the same way everywhere in help
function forms(c: Command, prefix: string) {
  const t = c.text ?? {};
  const opts = (c.data.options ?? []) as { name: string; required?: boolean; type: number }[];
  const slashArgs = opts.filter((o) => o.type !== 1 && o.type !== 2).map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
  const textArgs = (t.args ?? []).map((a) => (opts.find((o) => o.name === a)?.required ? `<${a}>` : `[${a}]`)).join(' ');
  const short = c.group || t.aliases?.length ? ` · short: ${[...(c.group ? [c.name] : []), ...(t.aliases ?? [])].slice(0, 3).map((a) => `\`${prefix} ${a}\``).join(' ')}` : '';
  return {
    slash: c.group ? `\`/${slashPath(c)}${textArgs ? ` input:${textArgs}` : ''}\`` : `\`/${slashPath(c)}${slashArgs ? ` ${slashArgs}` : ''}\``,
    // typed mirrors slash, "tz owo huntbot" for "/owo view:huntbot", the short names still work
    text: `\`${prefix} ${c.group ? `${c.group} ${c.as ?? c.name}` : c.name}${textArgs ? ` ${textArgs}` : ''}\`${short}`,
  };
}

const help: Command = {
  name: 'help',
  cooldown: 1,
  data: new SlashCommandBuilder().setName('help').setDescription('Everything Texz can do, by feature')
    .addStringOption((o) => o.setName('feature').setDescription('A feature or command to open')).toJSON(),
  text: { aliases: ['h', 'commands'], args: ['feature'] },
  run: (ctx, store) => {
    const prefix = ctx.guildId ? store.guild(ctx.guildId).prefix : 'tz';
    const gif = ctx.guildId ? store.guild(ctx.guildId).gifs.help ?? null : null;
    const raw = ctx.str('feature')?.toLowerCase();
    const want = raw === 'home' ? undefined : raw;
    const mods = allModules.filter((m) => m.locked || store.rules(ctx.guildId, m.name).enabled);
    const pickMod = want ? mods.find((m) => m.name === want || m.label.toLowerCase().includes(want)) : undefined;
    // a command name or alias wins over a feature name, "tz help status" means the status command
    const pickCmd = want ? (() => {
      for (const m of mods) for (const c of m.commands) {
        if (!c.hidden && (c.name === want || c.text?.aliases?.includes(want))) return { m, c };
      }
      return null;
    })() : null;

    // every page carries the same menus, picking from them flips this very message
    const id = `nav|help|as=feature,owner=${ctx.userId}`;
    const featureMenu = new StringSelectMenuBuilder().setCustomId(`${id},m=1`).setPlaceholder('📂 Open a feature')
      .addOptions([
        { label: 'Front page', value: 'home', emoji: '🕵️', description: 'Back to the start' },
        ...mods.map((m) => ({ label: m.label, value: m.name, emoji: icons[m.name] ?? '📁', description: m.about.slice(0, 100), default: (pickCmd?.m ?? pickMod)?.name === m.name })),
      ]);
    const rows = [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(featureMenu)];
    const inMod = pickCmd?.m ?? pickMod;
    if (inMod) {
      const cmds = inMod.commands.filter((c) => !c.hidden).slice(0, 25);
      rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${id},m=2`).setPlaceholder('🔎 How does a command work?')
          .addOptions(cmds.map((c) => ({ label: `${prefix} ${c.name}`, value: c.name, description: c.data.description.slice(0, 100), default: pickCmd?.c.name === c.name }))),
      ));
    }
    const page = (e: ReturnType<typeof card>) => ctx.reply({ embeds: [e], components: rows });

    if (pickCmd) {
      const { m, c } = pickCmd;
      const t = c.text ?? {};
      const opts = (c.data.options ?? []) as { name: string; description: string; type: number }[];
      const subs = opts.filter((o) => o.type === 1);
      const usage = subs.length
        ? subs.map((sc) => {
            const args = (t.subArgs?.[sc.name] ?? []).map((a) => `<${a}>`).join(' ');
            return `\`/${slashPath(c)} ${sc.name}\` · \`${prefix} ${c.name} ${sc.name}${args ? ` ${args}` : ''}\`\n-# ${sc.description}`;
          }).join('\n')
        : `${forms(c, prefix).slash}\n${forms(c, prefix).text}`;
      return page(card({
        kind: 'help', title: `${prefix} ${c.name}`, emoji: icons[m.name] ?? '📁', gif,
        body: c.data.description,
        fields: [
          { name: '⌨️ How to use it', value: usage, inline: false },
          ...(subs.length ? [] : opts.length ? [{ name: '🧩 Options', value: opts.map((o) => `\`${o.name}\` ${o.description}`).join('\n'), inline: false }] : []),
          { name: '📁 Part of', value: m.label, inline: true },
          ...(c.admin ? [{ name: '🔐 Who', value: 'Admins with Manage Server', inline: false }] : []),
        ],
      }));
    }
    if (want && !pickMod) {
      return page(card({ kind: 'missing', title: `No "${want}" in my files`, emoji: '🔍', gif: 'off', body: `Try \`${prefix} help\` for the whole list.` }));
    }
    if (pickMod) {
      return page(card({
        kind: 'help', title: pickMod.label, emoji: icons[pickMod.name] ?? '📁', gif,
        body: `${pickMod.about}\n-# Every command works both ways: slash, or typed with \`${prefix}\`. \`<x>\` is needed, \`[x]\` is optional.`,
        fields: pickMod.commands.filter((c) => !c.hidden).map((c) => {
          const f = forms(c, prefix);
          return { name: c.data.description.slice(0, 256), value: `${f.slash}\n${f.text}`, inline: false };
        }),
      }));
    }
    // the front page is the dashboards, each one opens with a click
    const staff = (d: { name: string }) => (d.name === 'tools' ? ctx.isAdmin : d.name === 'mod' ? ctx.isAdmin || !!ctx.member?.permissions.has(PermissionFlagsBits.ModerateMembers) : true);
    const dashes = dashList.filter((d) => (ctx.guildId || d.anywhere) && staff(d));
    rows.unshift(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`nav|pick|owner=${ctx.userId},back=help`).setPlaceholder('🚪 Open a dashboard')
        .addOptions(dashes.map((d) => ({ label: d.label, value: d.home, emoji: d.emoji, description: `/${d.name} · ${prefix} ${d.name}` }))),
    ));
    return page(card({
      kind: 'help', title: 'At your service', emoji: '🕵️', gif,
      body: `Everything lives in a few dashboards. Run one, then click, no commands to remember. Slash ones only show to you, typed ones to everyone.\n\n🖼️ Right click a message → Apps → **Make it a Quote**${ctx.isAdmin ? ' · 🛠️ `/setup` for the admin desk' : ''}\n-# The second menu lists every command a feature has, typed and slash.`,
      fields: dashes.map((d) => ({ name: `${d.emoji} ${d.label}`, value: `${blurb[d.name] ?? ''}\n\`/${d.name}\` · \`${prefix} ${d.name}\``, inline: true })),
    }));
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
    return ctx.reply({ ...setupPanel(store, ctx.guild, ctx.userId, 'home'), private: true });
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
  commands: [help, setup, ping, config],
};

