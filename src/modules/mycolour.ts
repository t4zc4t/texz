import { SlashCommandBuilder, type Guild, type GuildMember, type Role } from 'discord.js';
import type { Store } from '../db.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';

// a role of your own, bought with yen: your colour, your name for it, a gradient or an icon where the server allows it

export const PRICE = { buy: 5000, change: 300 };
const key = (g: string, u: string) => `myrole:${g}:${u}`;
const hexOf = (s: string | null | undefined) => {
  const m = s?.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return Number.parseInt(h, 16);
};

// the colour roles and the personal ones sit right under Texz, above the rank roles, so their colour shows
export async function liftColours(guild: Guild, store: Store, roles: Role[]) {
  const me = await guild.members.fetchMe();
  let at = me.roles.highest.position - 1;
  for (const r of roles) {
    if (!r.editable) continue;
    if (r.position !== at) await r.setPosition(at, { reason: 'colour roles sit above rank roles' }).catch(() => {});
    at = Math.max(1, at - 1);
  }
}

async function own(guild: Guild, store: Store, userId: string) {
  const id = store.getKv(key(guild.id, userId));
  return id ? guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null) : null;
}

export const mycolour: Command = {
  name: 'mycolour',
  data: new SlashCommandBuilder().setName('mycolour').setDescription('A role of your own with your colour, bought with yen')
    .addSubcommand((s) => s.setName('view').setDescription('Your role and what it costs'))
    .addSubcommand((s) => s.setName('buy').setDescription(`Get your own role, ¥${PRICE.buy}`)
      .addStringOption((o) => o.setName('colour').setDescription('A hex colour like #c8283c').setRequired(true))
      .addStringOption((o) => o.setName('name').setDescription('What the role is called, your name if empty').setMaxLength(40)))
    .addSubcommand((s) => s.setName('colour').setDescription(`Change the colour, ¥${PRICE.change}`)
      .addStringOption((o) => o.setName('colour').setDescription('A hex colour like #3fa7a3').setRequired(true))
      .addStringOption((o) => o.setName('second').setDescription('A second colour for a gradient, if the server has them')))
    .addSubcommand((s) => s.setName('name').setDescription(`Rename it, ¥${PRICE.change}`)
      .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('icon').setDescription(`Give it an icon, ¥${PRICE.change}, needs server boost level 2`)
      .addStringOption((o) => o.setName('emoji').setDescription('An emoji like 🦋').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete your role, no refund')).toJSON(),
  text: { aliases: ['mycolor', 'myrole'], sub: true, subArgs: { buy: ['colour', 'name'], colour: ['colour', 'second'], color: ['colour', 'second'], name: ['name'], icon: ['emoji'] } },
  example: 'buy #c8283c',
  run: async (ctx, store) => {
    if (!ctx.guild || !ctx.guildId) return ctx.reply('Personal roles live inside a server.');
    const guild = ctx.guild;
    const sub = (ctx.sub() ?? 'view').replace('color', 'colour');
    const role = await own(guild, store, ctx.userId);
    const me = await guild.members.fetchMe();
    if (!me.permissions.has('ManageRoles')) return ctx.reply('I need Manage Roles to make personal roles. An admin can fix that in Server Settings → Roles.');
    const cost = (n: number) => store.pay(ctx.guildId!, ctx.userId, -n);
    const yen = store.wallet(ctx.guildId, ctx.userId).yen;

    if (sub === 'view') {
      return ctx.reply(card({ kind: 'settings', title: 'Your own role', emoji: '🎨', gif: 'off', line: '',
        body: role
          ? `<@&${role.id}> · ${role.hexColor}\n\n\`tz mycolour colour #3fa7a3\` change it, ¥${PRICE.change}\n\`tz mycolour colour #c8283c #e8b04b\` a gradient${guild.features.includes('ENHANCED_ROLE_COLORS') ? '' : ', when the server has them'}\n\`tz mycolour name The Demon Prodigy\` rename, ¥${PRICE.change}\n\`tz mycolour icon 🦋\` an icon${guild.premiumTier >= 2 ? '' : ', at boost level 2'}, ¥${PRICE.change}\n\`tz mycolour remove\` delete it`
          : `A role only you have, in any colour you like, sitting above the rank roles so it shows.\n\n\`tz mycolour buy #c8283c\` · **¥${PRICE.buy.toLocaleString()}**, you have ¥${yen.toLocaleString()}\n-# then change the colour, name, a gradient or an icon whenever you like for ¥${PRICE.change}` }));
    }
    if (sub === 'buy') {
      if (role) return ctx.reply({ content: `You already have <@&${role.id}>. Change it with \`tz mycolour colour #hex\`.`, temp: true });
      const colour = hexOf(ctx.str('colour'));
      if (colour === null) return ctx.reply({ content: 'Give me a hex colour, like `tz mycolour buy #c8283c`. Any colour picker online shows one.', temp: true });
      if (!cost(PRICE.buy)) return ctx.reply({ content: `That's ¥${PRICE.buy.toLocaleString()} and you have ¥${yen.toLocaleString()}. \`tz daily\` and chatting earn more.`, temp: true });
      const name = (ctx.str('name') ?? `✦ ${ctx.member?.displayName ?? ctx.displayName}`).slice(0, 40);
      const made = await guild.roles.create({ name, colors: { primaryColor: colour }, permissions: [], hoist: false, mentionable: false, reason: `personal role bought by ${ctx.userId}` }).catch(() => null);
      if (!made) { store.pay(ctx.guildId, ctx.userId, PRICE.buy); return ctx.reply('Discord refused to make the role, your yen is back. An admin might need to move my role higher.'); }
      store.setKv(key(guild.id, ctx.userId), made.id);
      await liftColours(guild, store, [made]);
      await (ctx.member as GuildMember | null)?.roles.add(made, 'personal role').catch(() => {});
      return ctx.reply(card({ kind: 'settings', title: 'Yours now', emoji: '🎨', gif: 'off', line: '', body: `<@&${made.id}> is yours. ¥${PRICE.buy.toLocaleString()} paid.\nChange it any time, \`tz mycolour\` shows how.` }));
    }
    if (!role) return ctx.reply({ content: `You don't have one yet. \`tz mycolour buy #c8283c\` gets one for ¥${PRICE.buy.toLocaleString()}.`, temp: true });
    if (sub === 'remove') {
      await role.delete('owner removed their personal role').catch(() => {});
      store.setKv(key(guild.id, ctx.userId), null);
      return ctx.reply({ content: 'Gone. The colour fades, the memory stays.', temp: true });
    }
    if (yen < PRICE.change) return ctx.reply({ content: `Changes are ¥${PRICE.change} and you have ¥${yen}.`, temp: true });
    let done: string | null = null;
    if (sub === 'colour') {
      const a = hexOf(ctx.str('colour'));
      const b = hexOf(ctx.str('second'));
      if (a === null) return ctx.reply({ content: 'Like this: `tz mycolour colour #3fa7a3`, or two for a gradient.', temp: true });
      const gradient = b !== null && guild.features.includes('ENHANCED_ROLE_COLORS');
      done = await role.edit({ colors: gradient ? { primaryColor: a, secondaryColor: b! } : { primaryColor: a }, reason: 'personal role colour' }).then(() => (gradient ? 'Gradient on.' : b !== null ? 'Colour changed. Gradients need the server to have enhanced role colours, so it\'s one colour for now.' : 'Colour changed.')).catch(() => null);
    }
    if (sub === 'name') done = await role.setName(ctx.str('name')!.slice(0, 40), 'personal role name').then(() => 'Renamed.').catch(() => null);
    if (sub === 'icon') {
      if (guild.premiumTier < 2) return ctx.reply({ content: 'Role icons need the server at boost level 2.', temp: true });
      const emoji = ctx.str('emoji')?.trim() ?? '';
      done = await role.edit({ unicodeEmoji: emoji, reason: 'personal role icon' }).then(() => 'Icon set.').catch(() => null);
    }
    if (!done) return ctx.reply({ content: 'Discord didn\'t take that, nothing was charged.', temp: true });
    cost(PRICE.change);
    return ctx.reply({ content: `🎨 ${done} ¥${PRICE.change} paid.`, temp: true });
  },
};
