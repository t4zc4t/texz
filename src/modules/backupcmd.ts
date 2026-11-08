import { AttachmentBuilder, SlashCommandBuilder, type Guild } from 'discord.js';
import type { Command } from '../core/module.js';
import type { GuildSettings } from '../db.js';

// a server's whole setup as a file, and back. Channels and roles are saved by name, so the file
// works on another server too: whatever has the same name there gets picked up, the rest is left empty

const SNOWFLAKE = /^\d{17,20}$/;

function swapOut(v: unknown, g: Guild): unknown {
  if (typeof v === 'string' && SNOWFLAKE.test(v)) {
    const ch = g.channels.cache.get(v);
    if (ch) return `#channel:${ch.name}`;
    const r = g.roles.cache.get(v);
    if (r) return `#role:${r.name}`;
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => swapOut(x, g));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapOut(x, g)]));
  return v;
}

function swapIn(v: unknown, g: Guild, missing: string[]): unknown {
  if (typeof v === 'string' && v.startsWith('#channel:')) {
    const name = v.slice(9);
    const ch = g.channels.cache.find((c) => c.name === name);
    if (!ch) missing.push(`#${name}`);
    return ch?.id ?? null;
  }
  if (typeof v === 'string' && v.startsWith('#role:')) {
    const name = v.slice(6);
    const r = g.roles.cache.find((x) => x.name === name);
    if (!r) missing.push(`@${name}`);
    return r?.id ?? null;
  }
  if (Array.isArray(v)) return v.map((x) => swapIn(x, g, missing)).filter((x) => x !== null);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapIn(x, g, missing)]));
  return v;
}

export const backupCmd: Command = {
  name: 'backup',
  group: 'tools',
  admin: true,
  data: new SlashCommandBuilder().setName('backup').setDescription('Save this server\'s Texz setup to a file, or load one')
    .addSubcommand((c) => c.setName('export').setDescription('Download the setup as a file'))
    .addSubcommand((c) => c.setName('import').setDescription('Load a setup file').addAttachmentOption((o) => o.setName('file').setDescription('A texz setup file').setRequired(true)))
    .toJSON(),
  text: { aliases: ['setupfile'], sub: true },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Backups are per server.');
    const sub = ctx.sub() ?? 'export';
    if (sub === 'import') {
      const url = ctx.attachment?.('file');
      if (!url) return ctx.reply('Attach the setup file, `/tools view:backup` → import, or send it with `tz backup import`.');
      const raw = await fetch(url).then((r) => r.text()).catch(() => null);
      let data: { texz?: number; settings?: GuildSettings } | null = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!data?.texz || !data.settings) return ctx.reply('That doesn\'t look like a Texz setup file.');
      const missing: string[] = [];
      const settings = swapIn(data.settings, ctx.guild, missing) as GuildSettings;
      store.saveGuild(ctx.guild.id, { ...store.guild(ctx.guild.id), ...settings });
      return ctx.reply(`📥 Setup loaded.${missing.length ? `\nThese weren't found here and were left empty: ${[...new Set(missing)].slice(0, 20).join(', ')}` : ' Everything matched.'}`);
    }
    const file = JSON.stringify({ texz: 1, server: ctx.guild.name, at: new Date().toISOString(), settings: swapOut(store.guild(ctx.guild.id), ctx.guild) }, null, 2);
    return ctx.reply({ content: '📤 Here\'s the setup. Load it here or on another server with `/tools view:backup` → import.', files: [new AttachmentBuilder(Buffer.from(file), { name: `texz-setup-${ctx.guild.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json` })] });
  },
};
