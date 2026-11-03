import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, type MessageActionRowComponentBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type GuildMember, type Message, type StringSelectMenuInteraction,
} from 'discord.js';

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
// slash answers are only shown to whoever asked, unless public is set (polls, buddy pings)
// temp marks a throwaway answer, typed ones get cleaned up after the server's timer
export type Reply = string | EmbedBuilder | {
  content?: string; embeds?: EmbedBuilder[]; private?: boolean; public?: boolean; temp?: boolean; ping?: string[]; components?: Row[]; files?: AttachmentBuilder[];
};

// one shape for both slash commands and "tz" text commands, so each command is written once
export interface Ctx {
  userId: string;
  guildId: string | null;
  guild: Guild | null;
  channelId: string;
  member: GuildMember | null;
  isAdmin: boolean;
  viaText: boolean;
  latency(): number;
  sub(): string | null;
  str(name: string): string | null;
  int(name: string): number | null;
  bool(name: string): boolean | null;
  user(name: string): string | null;
  channel(name: string): string | null;
  role(name: string): string | null;
  reply(r: Reply): Promise<unknown>;
}

function normalise(r: Reply) {
  const files = [] as AttachmentBuilder[];
  if (typeof r === 'string') return { content: r, embeds: [] as EmbedBuilder[], public: false, temp: true, ping: [] as string[], components: [] as Row[], files };
  if (r instanceof EmbedBuilder) return { content: undefined, embeds: [r], public: false, temp: false, ping: [] as string[], components: [] as Row[], files };
  return { content: r.content, embeds: r.embeds ?? [], public: !!r.public, temp: r.temp ?? (!r.embeds?.length && !r.files?.length && !r.components?.length), ping: r.ping ?? [], components: r.components ?? [], files: r.files ?? files };
}

// sub is passed in for grouped commands, where discord's own subcommand is the command itself
export function fromSlash(i: ChatInputCommandInteraction, sub?: string | null): Ctx {
  const member = (i.member && 'permissions' in i.member && typeof i.member.permissions !== 'string') ? (i.member as GuildMember) : null;
  return {
    userId: i.user.id,
    guildId: i.guildId,
    guild: i.guild,
    channelId: i.channelId,
    member,
    isAdmin: !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
    viaText: false,
    latency: () => i.client.ws.ping,
    sub: () => (sub === undefined ? i.options.getSubcommand(false) : sub),
    str: (n) => i.options.getString(n),
    int: (n) => i.options.getInteger(n),
    bool: (n) => i.options.getBoolean(n),
    user: (n) => i.options.getUser(n)?.id ?? null,
    channel: (n) => i.options.getChannel(n)?.id ?? null,
    role: (n) => i.options.getRole(n)?.id ?? null,
    reply: (r) => {
      const n = normalise(r);
      const payload = !n.public
        ? { content: n.content, embeds: n.embeds, components: n.components, files: n.files, flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] } }
        : { content: n.content, embeds: n.embeds, components: n.components, files: n.files, allowedMentions: { parse: [], users: n.ping } };
      return i.replied || i.deferred ? i.followUp(payload) : i.reply({ ...payload, withResponse: true });
    },
  };
}

// a button or menu press that runs a command, with optional fixed option values
export function fromComponent(i: ButtonInteraction | StringSelectMenuInteraction, opts: Record<string, string> = {}, edit = false): Ctx {
  const member = (i.member && 'permissions' in i.member && typeof i.member.permissions !== 'string') ? (i.member as GuildMember) : null;
  return {
    userId: i.user.id,
    guildId: i.guildId,
    guild: i.guild,
    channelId: i.channelId,
    member,
    isAdmin: !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
    viaText: true,
    latency: () => i.client.ws.ping,
    sub: () => opts.sub ?? null,
    str: (n) => opts[n] ?? null,
    int: (n) => (opts[n] ? Number.parseInt(opts[n], 10) : null),
    bool: () => null,
    user: () => null,
    channel: () => null,
    role: () => null,
    reply: (r) => {
      const n = normalise(r);
      // edit mode swaps the page in place, like flipping through a book
      if (edit) {
        // pages opened from another screen get a way back to it
        const rows = [...n.components];
        if (opts.back && rows.length < 5) {
          rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`nav|${opts.back}|owner=${opts.owner}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
          ));
        }
        return i.update({ content: n.content ?? null, embeds: n.embeds, components: rows, ...(n.files.length ? { files: n.files } : { attachments: [] }) });
      }
      return i.reply({ content: n.content, embeds: n.embeds, components: n.components, files: n.files, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    },
  };
}

// text args are positional, the last named arg soaks up the rest of the line
export function fromText(m: Message, tokens: string[], argNames: string[], hasSub: boolean, afterSend?: (sent: Message, temp: boolean) => void): Ctx {
  const rest = [...tokens];
  const sub = hasSub ? (rest.shift()?.toLowerCase() ?? null) : null;
  const values = new Map<string, string>();
  argNames.forEach((name, idx) => {
    if (!rest.length) return;
    values.set(name, idx === argNames.length - 1 ? rest.splice(0).join(' ') : rest.shift()!);
  });
  const id = (n: string, re: RegExp) => values.get(n)?.match(re)?.[1] ?? null;
  return {
    userId: m.author.id,
    guildId: m.guildId,
    guild: m.guild,
    channelId: m.channelId,
    member: m.member,
    isAdmin: !!m.member?.permissions.has(PermissionFlagsBits.ManageGuild),
    viaText: true,
    latency: () => m.client.ws.ping,
    sub: () => sub,
    str: (n) => values.get(n) ?? null,
    int: (n) => {
      const v = Number.parseInt(values.get(n) ?? '', 10);
      return Number.isNaN(v) ? null : v;
    },
    bool: (n) => {
      const v = values.get(n)?.toLowerCase();
      if (v === undefined) return null;
      return ['on', 'yes', 'true', 'enable', '1'].includes(v);
    },
    user: (n) => id(n, /^<@!?(\d+)>$/) ?? values.get(n)?.match(/^(\d{15,})$/)?.[1] ?? null,
    channel: (n) => id(n, /^<#(\d+)>$/) ?? values.get(n)?.match(/^(\d{15,})$/)?.[1] ?? null,
    role: (n) => id(n, /^<@&(\d+)>$/) ?? values.get(n)?.match(/^(\d{15,})$/)?.[1] ?? null,
    reply: (r) => {
      const n = normalise(r);
      return m.reply({ content: n.content, embeds: n.embeds, components: n.components, files: n.files, allowedMentions: { repliedUser: false, parse: [], users: n.ping } })
        .then((sent) => { afterSend?.(sent, n.temp); return sent; });
    },
  };
}
