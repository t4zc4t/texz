import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defaultRules, type Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { embed, pick } from '../theme.js';

// filled in by the registry so help and config can list every module
export const allModules: Module[] = [];

const switchable = () => allModules.filter((m) => !m.locked);

function rulesText(store: Store, guildId: string) {
  const g = store.guild(guildId);
  const out = [`Prefix: \`${g.prefix}\``, ''];
  for (const m of switchable()) {
    const r = { ...defaultRules(), ...g.modules[m.name] };
    const where = r.channels.length ? r.channels.map((c) => `<#${c}>`).join(' ') : 'everywhere';
    const who = r.roles.length ? r.roles.map((x) => `<@&${x}>`).join(' ') : 'everyone';
    out.push(`${r.enabled ? '✅' : '⬜'} **${m.label}** (\`${m.name}\`): ${where}, ${who}`);
  }
  return out.join('\n');
}

const help: Command = {
  name: 'help',
  data: new SlashCommandBuilder().setName('help').setDescription('What Texz can do here')
    .addStringOption((o) => o.setName('feature').setDescription('One feature in detail')).toJSON(),
  text: { aliases: ['h', 'commands'], args: ['feature'] },
  run: (ctx, store) => {
    const prefix = ctx.guildId ? store.guild(ctx.guildId).prefix : 'tz';
    const want = ctx.str('feature')?.toLowerCase();
    const mods = allModules.filter((m) => m.locked || store.rules(ctx.guildId, m.name).enabled);
    const pickMod = want ? mods.find((m) => m.name === want || m.label.toLowerCase().includes(want)) : undefined;
    if (want && pickMod) {
      const e = embed(pickMod.label).setDescription(pickMod.about);
      e.addFields({
        name: 'Commands',
        value: pickMod.commands.map((c) => {
          const alias = c.text?.aliases?.length ? ` · \`${prefix} ${c.text.aliases[0]}\`` : '';
          return `\`/${c.name}\` · \`${prefix} ${c.name}\`${alias} — ${c.data.description}`;
        }).join('\n'),
      });
      return ctx.reply(e);
    }
    const e = embed('Texz').setDescription([
      'A detective who prefers napping, but fine, I\'ll help. Slash commands work, and so does the short way: `' + prefix + ' <command>`.',
      `Ask \`${prefix} help <feature>\` for the details of one.`,
    ].join('\n'));
    for (const m of mods) e.addFields({ name: m.label, value: `${m.about}\n${m.commands.map((c) => `\`${c.name}\``).join(' ')}` });
    return ctx.reply(e);
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
    .addSubcommand((s) => s.setName('prefix').setDescription('Change the short text prefix')
      .addStringOption((o) => o.setName('prefix').setDescription('Like tz').setRequired(true).setMaxLength(5)))
    .toJSON(),
  text: {
    aliases: ['cfg'],
    sub: true,
    subArgs: { feature: ['name', 'on'], channel: ['name', 'action', 'channel'], role: ['name', 'action', 'role'], prefix: ['prefix'] },
  },
  run: (ctx, store) => {
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
    if (mod && rules) g.modules[mod.name] = rules;
    if (sub !== 'view') store.saveGuild(ctx.guildId, g);
    return ctx.reply(embed('Server settings').setDescription(rulesText(store, ctx.guildId)));
  },
};

const ping: Command = {
  name: 'ping',
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that Texz is awake').toJSON(),
  run: (ctx) => ctx.reply(pick(['Awake. Barely.', 'Here. Was hoping for a nap.', 'Present, unfortunately.'])),
};

export const core: Module = {
  name: 'core',
  label: 'Core',
  about: 'Help, server settings and the basics',
  locked: true,
  commands: [help, config, ping],
};

