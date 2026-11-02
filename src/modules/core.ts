import { ActionRowBuilder, ChannelType, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card, say } from '../theme.js';
import { isGifLink, resolve } from '../gifs.js';

// filled in by the registry so help and config can list every module
export const allModules: Module[] = [];

const switchable = () => allModules.filter((m) => !m.locked);

// moments an admin can attach a gif to
export const gifMoments = ['help', 'ping', 'status', 'error', 'huntbot', 'leaderboard', 'ask', 'levelup', 'welcome', 'goodbye', 'ban', 'kick', 'timeout', 'warn', 'giveaway'];

function rulesText(store: Store, guildId: string) {
  const g = store.guild(guildId);
  const out = [`Prefix: \`${g.prefix}\``, ''];
  for (const m of switchable()) {
    const r = { ...defaultRules(), ...g.modules[m.name] };
    const where = r.channels.length ? r.channels.map((c) => `<#${c}>`).join(' ') : 'everywhere';
    const who = r.roles.length ? r.roles.map((x) => `<@&${x}>`).join(' ') : 'everyone';
    out.push(`${r.enabled ? '✅' : '⬜'} **${m.label}** (\`${m.name}\`): ${where}, ${who}`);
  }
  const gifs = Object.keys(g.gifs);
  if (gifs.length) out.push('', `🎞️ gifs set for: ${gifs.map((x) => `\`${x}\``).join(', ')}`);
  return out.join('\n');
}

const icons: Record<string, string> = { core: '🗂️', owo: '🐾', moderation: '🛡️', welcome: '🌸', levels: '📈', fun: '🎲', anime: '📺' };

const help: Command = {
  name: 'help',
  data: new SlashCommandBuilder().setName('help').setDescription('What Texz can do here')
    .addStringOption((o) => o.setName('feature').setDescription('One feature in detail')).toJSON(),
  text: { aliases: ['h', 'commands'], args: ['feature'] },
  run: (ctx, store) => {
    const prefix = ctx.guildId ? store.guild(ctx.guildId).prefix : 'tz';
    const gif = ctx.guildId ? store.guild(ctx.guildId).gifs.help ?? null : null;
    const want = ctx.str('feature')?.toLowerCase();
    const mods = allModules.filter((m) => m.locked || store.rules(ctx.guildId, m.name).enabled);
    const pickMod = want ? mods.find((m) => m.name === want || m.label.toLowerCase().includes(want)) : undefined;
    // a command name or alias wins over a feature name, "tz help status" means the status command
    const pickCmd = want ? (() => {
      for (const m of mods) for (const c of m.commands) {
        if (c.name === want || c.text?.aliases?.includes(want)) return { m, c };
      }
      return null;
    })() : null;
    if (pickCmd) {
      const { m, c } = pickCmd;
      const t = c.text ?? {};
      const subs = (c.data.options ?? []).filter((o) => o.type === 1) as { name: string; description: string }[];
      const usage = subs.length
        ? subs.map((sc) => {
            const args = (t.subArgs?.[sc.name] ?? []).map((a) => `<${a}>`).join(' ');
            return `\`${prefix} ${c.name} ${sc.name}${args ? ` ${args}` : ''}\`\n-# ${sc.description}`;
          }).join('\n')
        : `\`${prefix} ${c.name}${(t.args ?? []).map((a) => ` [${a}]`).join('')}\``;
      return ctx.reply(card({
        kind: 'help', title: `${prefix} ${c.name}`, emoji: icons[m.name] ?? '📁', gif,
        body: c.data.description,
        fields: [
          { name: '⌨️ How to use it', value: usage, inline: false },
          { name: '⚡ Slash', value: `\`/${c.name}\``, inline: true },
          { name: '🏷️ Short names', value: t.aliases?.length ? t.aliases.map((a) => `\`${prefix} ${a}\``).join(' ') : 'none', inline: true },
          { name: '📁 Part of', value: m.label, inline: true },
          ...(c.admin ? [{ name: '🔐 Who', value: 'Admins with Manage Server', inline: false }] : []),
        ],
      }));
    }
    if (want && !pickMod) {
      return ctx.reply(card({ kind: 'missing', title: `No "${want}" here`, emoji: '🔍', body: `Try \`${prefix} help\` for the full list.` }));
    }
    if (want && pickMod) {
      return ctx.reply(card({
        kind: 'help', title: pickMod.label, emoji: icons[pickMod.name] ?? '📁', body: pickMod.about, gif,
        fields: pickMod.commands.map((c) => ({
          name: `/${c.name}`,
          value: `${c.data.description}\n\`${prefix} ${c.name}\`${c.text?.aliases?.length ? ` · \`${prefix} ${c.text.aliases[0]}\`` : ''}`,
          inline: true,
        })),
      }));
    }
    const menu = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId('nav|help|as=feature').setPlaceholder('📂 Open a feature')
        .addOptions(mods.map((m) => ({ label: m.label, value: m.name, emoji: icons[m.name] ?? '📁', description: m.about.slice(0, 100) }))),
    );
    return ctx.reply({ components: [menu], embeds: [card({
      kind: 'help', title: 'At your service', emoji: '🕵️', gif,
      body: `Slash commands work, and so does the lazy way: \`${prefix} <command>\`.\nAsk \`${prefix} help <feature>\` and I'll walk you through one.`,
      fields: mods.map((m) => ({
        name: `${icons[m.name] ?? '📁'} ${m.label}`,
        value: `${m.about}\n${m.commands.map((c) => `\`${c.name}\``).join(' ')}`,
        inline: false,
      })),
    })] });
  },
};

const config: Command = {
  name: 'config',
  admin: true,
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
      .addStringOption((o) => o.setName('url').setDescription('Tenor share link or .gif link, "default" or "off"').setRequired(true)))
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
    const rules = mod ? { ...defaultRules(), ...g.modules[mod.name] } : null;

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
        if (!(await resolve(url))) return ctx.reply('I couldn\'t open that gif. Use a Tenor share link or a direct link ending in `.gif`.');
        g.gifs[moment] = url;
      } else return ctx.reply('Send a Tenor share link (tenor.com/view/...) or a direct `.gif` link. `default` puts mine back, `off` hides it.');
    }
    if (mod && rules) g.modules[mod.name] = rules;
    if (sub !== 'view') store.saveGuild(ctx.guildId, g);
    return ctx.reply(card({ kind: 'settings', title: 'Server settings', emoji: '🏛️', body: rulesText(store, ctx.guildId) }));
  },
};

const ping: Command = {
  name: 'ping',
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that Texz is awake').toJSON(),
  run: (ctx, store) => ctx.reply(card({ kind: 'ping', title: 'Pong', emoji: '🏓', gif: ctx.guildId ? store.guild(ctx.guildId).gifs.ping ?? null : null, body: `💓 heartbeat · **${Math.round(ctx.latency())} ms**` })),
};

export const core: Module = {
  name: 'core',
  label: 'Core',
  about: 'Help, server settings and the basics',
  locked: true,
  commands: [help, config, ping],
};

