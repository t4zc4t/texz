import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder,
  type Client, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Command } from '../core/module.js';
import { card } from '../theme.js';

// the bot owner's own look at where Texz lives. Only the owner can run it and the answer only goes to their DMs.
// Invite links are only the ones a server made public itself (its vanity link), Texz never makes its own way in.

export async function ownerOf(c: Client) {
  const app = await c.application?.fetch().catch(() => null);
  return app?.owner && 'members' in app.owner ? app.owner.ownerId : app?.owner?.id ?? null;
}

const row = (...x: (ButtonBuilder | StringSelectMenuBuilder)[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...x);

async function page(c: Client) {
  const list = [...c.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount);
  const lines = await Promise.all(list.slice(0, 25).map(async (g) => {
    const owner = await g.fetchOwner().catch(() => null);
    const vanity = g.vanityURLCode ? ` · [discord.gg/${g.vanityURLCode}](https://discord.gg/${g.vanityURLCode})` : '';
    return `**${g.name}** · ${g.memberCount.toLocaleString()} members · owner ${owner?.user.username ?? '?'} · joined <t:${Math.floor((g.joinedTimestamp ?? Date.now()) / 1000)}:d>${vanity}\n-# ${g.id}`;
  }));
  const total = list.reduce((s, g) => s + g.memberCount, 0);
  const e = card({ kind: 'help', title: `Texz is in ${list.length} server${list.length === 1 ? '' : 's'}`, emoji: '🗺️', gif: 'off', line: '',
    body: `${total.toLocaleString()} members across all of them\n\n${lines.join('\n')}${list.length > 25 ? `\n\n…and ${list.length - 25} more` : ''}\n\n-# links only show for servers with a public vanity link`.slice(0, 4000) });
  const rows = list.length ? [row(new StringSelectMenuBuilder().setCustomId('own|leave').setPlaceholder('🚪 Leave a server')
    .addOptions(list.slice(0, 25).map((g) => ({ label: g.name.slice(0, 100), value: g.id, description: `${g.memberCount} members` }))))] : [];
  return { embeds: [e], components: rows };
}

export const servers: Command = {
  name: 'servers',
  hidden: true,
  data: { name: 'servers', description: 'Owner only' },
  text: { aliases: ['guilds'] },
  run: async (ctx) => {
    // anyone else gets the same answer as an unknown command would: nothing
    if (ctx.userId !== (await ownerOf(ctx.client))) return;
    const dm = await ctx.client.users.fetch(ctx.userId).then((u) => u.createDM()).catch(() => null);
    const sent = dm ? await dm.send(await page(ctx.client)).catch(() => null) : null;
    return ctx.reply({ content: sent ? '📬 Sent to your DMs.' : 'I couldn\'t DM you, open your DMs for this server and try again.', temp: true });
  },
};

export async function onOwnerButton(i: Interaction) {
  if (!i.isStringSelectMenu() || !i.customId.startsWith('own|')) return false;
  if (i.user.id !== (await ownerOf(i.client))) { await i.reply({ content: 'Not yours.', flags: MessageFlags.Ephemeral }); return true; }
  const id = i.values[0];
  const g = i.client.guilds.cache.get(id);
  if (i.customId === 'own|leave' && g) {
    // a second press to be sure, leaving can't be undone from here
    await i.reply({ content: `Leave **${g.name}**? Texz would need a new invite to come back.`, components: [row(
      new ButtonBuilder().setCustomId(`own|go|${id}`).setLabel(`Leave ${g.name}`.slice(0, 80)).setStyle(ButtonStyle.Danger),
    )] });
  }
  return true;
}

export async function onOwnerConfirm(i: Interaction) {
  if (!i.isButton() || !i.customId.startsWith('own|go|')) return false;
  if (i.user.id !== (await ownerOf(i.client))) { await i.reply({ content: 'Not yours.', flags: MessageFlags.Ephemeral }); return true; }
  const g = i.client.guilds.cache.get(i.customId.slice(7));
  const name = g?.name ?? 'that server';
  const ok = g ? await g.leave().then(() => true).catch(() => false) : false;
  await i.update({ content: ok ? `🚪 Left **${name}**.` : `Couldn't leave ${name}.`, components: [] });
  return true;
}
