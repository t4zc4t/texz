import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, type Guild, type MessageActionRowComponentBuilder, type PermissionResolvable, type Role } from 'discord.js';

// error messages that say exactly what's wrong and how to put it right

const nice = (flag: string) => flag.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Guild/g, 'Server');

// what Texz is missing, in this channel when one is given
export function missingPerms(guild: Guild, perms: PermissionResolvable[], channelId?: string | null): string[] {
  const me = guild.members.me;
  if (!me) return [];
  const ch = channelId ? guild.channels.cache.get(channelId) : null;
  const have = ch ? me.permissionsIn(ch) : me.permissions;
  return have.missing(new PermissionsBitField(perms).toArray()).map(nice);
}

// the roles Texz can't touch because they sit at or above its own
export function rolesAbove(guild: Guild, roles: (Role | string)[]): Role[] {
  const top = guild.members.me?.roles.highest.position ?? 0;
  return roles.map((r) => (typeof r === 'string' ? guild.roles.cache.get(r) : r)).filter((r): r is Role => !!r && r.position >= top);
}

// one sentence: which permissions to tick and which roles to drag Texz above
export function fixText(guild: Guild, o: { perms?: PermissionResolvable[]; channelId?: string | null; roles?: (Role | string)[]; doing?: string }): string | null {
  const missing = o.perms ? missingPerms(guild, o.perms, o.channelId) : [];
  const above = o.roles ? rolesAbove(guild, o.roles) : [];
  if (!missing.length && !above.length) return null;
  const mine = guild.members.me?.roles.highest.name ?? 'Texz';
  const parts = [
    missing.length ? `I need **${missing.join('**, **')}**${o.channelId ? ' in this channel' : ''}` : null,
    above.length ? `my role **${mine}** has to sit above ${above.map((r) => `**${r.name}**`).join(', ')} (Server Settings → Roles, drag it up)` : null,
  ].filter(Boolean);
  return `🔧 ${o.doing ? `To ${o.doing}, ` : ''}${parts.join(', and ')}.`;
}

// a button that opens the /setup page that deals with it, only worth showing to admins
export function setupButton(owner: string, page = 'home', label = 'Open /setup') {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`nav|setup|owner=${owner},page=${page}`).setLabel(label).setEmoji('🛠️').setStyle(ButtonStyle.Primary),
  );
}

// the permissions Texz asks for in its invite, used to explain a "Missing Permissions" error
export const usualPerms: PermissionResolvable[] = [
  'ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis',
];
