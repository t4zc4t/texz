import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, FileUploadBuilder, LabelBuilder, ModalBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type MessageActionRowComponentBuilder, type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './module.js';
import type { Ctx } from './ctx.js';
import { card } from '../theme.js';
import { menu } from './glance.js';
import { argsOf, examples } from './examples.js';

// option types from discord
const SUB = 1, GROUP = 2, STR = 3, INT = 4, BOOL = 5, USER = 6, CHANNEL = 7, ROLE = 8, NUM = 10, FILE = 11;

export interface RawOpt { type: number; name: string; description: string; required?: boolean; choices?: { name: string; value: string | number }[]; options?: RawOpt[]; max_length?: number; min_value?: number; max_value?: number }

// one line in a dashboard menu: a command, one of its subcommands, or one fixed choice of its first option
export interface Entry { key: string; cmd: Command; label: string; about: string; emoji?: string; sub?: string; fixed?: Record<string, string>; opts: RawOpt[] }

export function entriesOf(cmd: Command): Entry[] {
  return rawEntries(cmd).map((e) => {
    const m = menu[e.key];
    return m ? { ...e, emoji: m[0], label: m[1], about: m[2] ?? e.about } : e;
  });
}

function rawEntries(cmd: Command): Entry[] {
  const opts = (cmd.data.options ?? []) as RawOpt[];
  const name = cmd.as ?? cmd.name;
  const subs = opts.filter((o) => o.type === SUB);
  if (subs.length) {
    return subs.map((s) => ({ key: `${cmd.name}.${s.name}`, cmd, sub: s.name, label: `${name} ${s.name}`, about: s.description, opts: s.options ?? [] }));
  }
  // "/f1 view" with a handful of choices reads better as one menu line each
  const first = opts[0];
  if (opts.length === 1 && first.type === STR && first.choices?.length && !first.required) {
    return first.choices.map((c) => ({ key: `${cmd.name}~${first.name}=${c.value}`, cmd, fixed: { [first.name]: String(c.value) }, label: `${name} ${c.name}`, about: cmd.data.description, opts: [] }));
  }
  if (opts.some((o) => o.type === GROUP)) return [];
  return [{ key: cmd.name, cmd, label: name, about: cmd.data.description, opts }];
}

export function parseKey(key: string): { name: string; sub?: string; fixed?: Record<string, string> } {
  if (key.includes('~')) {
    const [name, pair] = key.split('~');
    const [k, v] = pair.split('=');
    return { name, fixed: { [k]: v } };
  }
  const [name, sub] = key.split('.');
  return { name, sub };
}

// only a required option means the command can't just run
export const needsInput = (e: Entry) => e.opts.some((o) => o.required);

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// the form shown when a menu pick needs something typed or picked first
export function askModal(e: Entry, owner: string, back: string) {
  const modal = new ModalBuilder().setCustomId(`ask|${e.key}|owner=${owner},back=${back}`).setTitle(short(e.label.replace(/^./, (c) => c.toUpperCase()), 45));
  const fields = [...e.opts].sort((a, b) => Number(!!b.required) - Number(!!a.required)).slice(0, 5);
  for (const o of fields) {
    // the description reads better as the question, the option name is the fallback
    const ask = o.description.length <= 45 ? o.description : o.name.replace(/_/g, ' ');
    const label = new LabelBuilder().setLabel(ask.replace(/^./, (c) => c.toUpperCase())).setDescription(short(o.description, 100));
    const id = `f_${o.name}`;
    if (o.type === USER) label.setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1));
    else if (o.type === ROLE) label.setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1));
    else if (o.type === FILE) label.setFileUploadComponent(new FileUploadBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1));
    else if (o.type === CHANNEL) label.setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1));
    else if (o.type === BOOL || o.choices?.length) {
      const choices = o.type === BOOL ? [{ name: 'yes', value: 'yes' }, { name: 'no', value: 'no' }] : o.choices!.slice(0, 25);
      label.setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1)
        .addOptions(choices.map((c) => ({ label: short(c.name, 100), value: String(c.value) }))));
    } else {
      const input = new TextInputBuilder().setCustomId(id).setRequired(!!o.required)
        .setStyle(o.type === STR && (o.max_length ?? 0) > 120 ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setPlaceholder(o.type === INT || o.type === NUM ? 'a number' : short(o.description, 100));
      if (o.max_length) input.setMaxLength(Math.min(o.max_length, 4000));
      label.setTextInputComponent(input);
    }
    modal.addLabelComponents(label);
  }
  return modal;
}

// what was filled in, as plain strings keyed by option name
export function readModal(i: ModalSubmitInteraction, e: Entry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of e.opts) {
    const id = `f_${o.name}`;
    try {
      if (o.type === USER) { const u = i.fields.getSelectedUsers(id)?.first(); if (u) out[o.name] = u.id; continue; }
      if (o.type === ROLE) { const r = i.fields.getSelectedRoles(id)?.first(); if (r) out[o.name] = r.id; continue; }
      if (o.type === CHANNEL) { const c = i.fields.getSelectedChannels(id)?.first(); if (c) out[o.name] = c.id; continue; }
      if (o.type === FILE) { const f = i.fields.getUploadedFiles(id)?.first(); if (f) out[o.name] = f.url; continue; }
      if (o.type === BOOL || o.choices?.length) { const v = i.fields.getStringSelectValues(id)?.[0]; if (v) out[o.name] = v; continue; }
      const v = i.fields.getTextInputValue(id).trim();
      if (v) out[o.name] = v;
    } catch { /* not in the form */ }
  }
  return out;
}

export interface GroupInfo { label: string; emoji: string; about: string; extra?: string[] }
export interface Layout { sections: [string, string[]][]; quick: string[] }

const row = <T extends MessageActionRowComponentBuilder>(...c: T[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// things that only make sense typed, a click can't say who to hug or why you're away
const typedOnly = new Set(['afk', 'quote', 'act', 'remind', 'roll', 'choose', '8ball', 'give', 'warn', 'kick', 'ban', 'unban', 'timeout', 'purge', 'slowmode']);
export const isTyped = (e: Entry) => needsInput(e) || typedOnly.has(e.cmd.name);

// one line for a typed command: the example, then what each part means
function typedLine(e: Entry, prefix: string) {
  if (e.cmd.hint) return e.cmd.hint.replaceAll('{p}', prefix);
  const ex = examples(e.cmd, prefix).find((x) => !e.sub || x.label === e.sub) ?? examples(e.cmd, prefix)[0];
  const parts = argsOf(e.cmd, e.sub).slice(0, 3).map((a) => `${a.shown}${a.required ? '' : '?'} ${a.about.toLowerCase()}`);
  return `\`${ex?.typed ?? `${prefix} ${e.cmd.call ?? e.cmd.name}`}\`${parts.length ? `\n-# ${parts.join(' · ')}` : ''}`;
}

// fields hold 1024 characters, a long list is split over a few
function chunks(title: string, lines: string[]) {
  const out: { name: string; value: string; inline: boolean }[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if ([...cur, l].join('\n').length > 1000) { out.push({ name: out.length ? '\u200b' : title, value: cur.join('\n'), inline: false }); cur = []; }
    cur.push(l);
  }
  if (cur.length) out.push({ name: out.length ? '\u200b' : title, value: cur.join('\n'), inline: false });
  return out;
}

const cap = (x: string) => x.replace(/^./, (c) => c.toUpperCase());
const tidy = (x: string) => x.trim().replace(/\.$/, '');

// the shortest thing to type for a command, "tz w" beats "tz work"
export function shortest(c: Command): string {
  const all = [c.call ?? c.name, ...(c.text?.aliases ?? [])].filter((a) => !a.includes(' '));
  return all.sort((a, b) => a.length - b.length)[0] ?? c.name;
}
// what to type for one menu line: "w", "gw start", "f1 next"
function wordOf(e: Entry) {
  const base = shortest(e.cmd);
  if (e.sub) return `${base} ${e.sub}`;
  if (e.fixed) return `${base} ${Object.values(e.fixed)[0].toLowerCase()}`;
  return base;
}

// the entries of a group in the order its sections give, with anything left over at the end
function sectioned(entries: Entry[], layout?: Layout): [string, Entry[]][] {
  const used = new Set<string>();
  const out: [string, Entry[]][] = [];
  for (const [title, keys] of layout?.sections ?? []) {
    const list = keys.flatMap((k) => entries.filter((e) => e.key === k || (e.cmd.name === k && !used.has(e.key) && (e.sub || e.fixed ? !keys.some((x) => x === e.key) : true))));
    const fresh = list.filter((e) => !used.has(e.key));
    fresh.forEach((e) => used.add(e.key));
    if (fresh.length) out.push([title, fresh]);
  }
  const rest = entries.filter((e) => !used.has(e.key));
  if (rest.length) out.push([out.length ? '📎 Also here' : '📂 Everything', rest]);
  return out;
}

// a group's desk: what's in it at a glance, each command with its short name and a line on what it does,
// the everyday ones as buttons and the rest in a menu that explains them
export function deskPage(ctx: Ctx, home: string, info: GroupInfo, entries: Entry[], o: { layout?: Layout; glance?: string | null; off?: string[]; prefix?: string; group: string; page?: number }) {
  const prefix = o.prefix ?? 'tz';
  const show = entries.filter((e) => !e.cmd.admin || ctx.isAdmin);
  const line = (e: Entry) => `**${cap(e.label)}** · \`${prefix} ${wordOf(e)}\`\n-# ${short(tidy(e.about), 80)}`;
  // whole sections per page, a page stops before it gets long enough to scroll
  const pages: { name: string; value: string; inline: boolean }[][] = [[]];
  let size = 0;
  for (const [title, list] of sectioned(show, o.layout)) {
    const f = chunks(title, list.map(line));
    const add = f.reduce((n, x) => n + x.name.length + x.value.length, 0);
    if (size && size + add > 1400) { pages.push([]); size = 0; }
    pages[pages.length - 1].push(...f);
    size += add;
  }
  const n = Math.min(Math.max(0, o.page ?? 0), pages.length - 1);
  const notes = n === 0 ? [
    o.glance,
    info.about,
    o.off?.length ? `-# ${o.off.join(', ')} ${o.off.length === 1 ? 'is' : 'are'} switched off here${ctx.isAdmin ? ', switch it on in \`/setup\`' : ''}.` : null,
  ].filter(Boolean) : [];
  const owner = `owner=${ctx.userId},back=${home}`;
  const rows = [];
  // the desk explains, typing runs: one menu for a closer look at any command, nothing to press that just repeats it
  const menuList = show;
  for (let m = 0; m < menuList.length && rows.length < 3; m += 25) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`nav|info|${owner},m=${m}`).setPlaceholder(m ? '📖 Even more' : '📖 Pick a command to see how it works').addOptions(
      menuList.slice(m, m + 25).map((e) => ({ label: short(cap(e.label), 100), value: e.key, description: short(`${prefix} ${wordOf(e)} · ${tidy(e.about)}`, 100), ...(e.emoji ? { emoji: e.emoji } : {}) })),
    )));
  }
  // page arrows only when there's more than one page, the directory always
  rows.push(row(
    ...(pages.length > 1 ? [
      new ButtonBuilder().setCustomId(`nav|${home}|owner=${ctx.userId},page=${n - 1}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(n === 0),
      new ButtonBuilder().setCustomId(`nav|${home}|owner=${ctx.userId},page=${n + 1}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(n >= pages.length - 1),
    ] : []),
    new ButtonBuilder().setCustomId(`nav|help|owner=${ctx.userId}`).setLabel('Directory').setEmoji('🗂️').setStyle(ButtonStyle.Secondary),
  ));
  const e = card({ kind: 'help', title: info.label, emoji: info.emoji, gif: 'off', body: notes.join('\n') || '​', fields: pages[n] });
  e.setFooter({ text: `${pages.length > 1 ? `Page ${n + 1} of ${pages.length} · ` : ''}type any of these · /${o.group} works too · the menu explains one in detail` });
  return { embeds: [e], components: rows };
}

// one command explained: what it does, how to type it, the slash form, what goes after it and its short names,
// with a button to run it and one back to where you came from
export function commandCard(ctx: Ctx, cmd: Command, o: { prefix: string; back: string; entry?: Entry }) {
  const prefix = o.prefix;
  const entries = entriesOf(cmd).filter((e) => !e.cmd.admin || ctx.isAdmin);
  const e = o.entry ?? (entries.length === 1 ? entries[0] : undefined);
  const exs = examples(cmd, prefix);
  const fields: { name: string; value: string; inline: boolean }[] = [];
  if (cmd.hint && !e?.sub) fields.push({ name: 'Type it', value: cmd.hint.replaceAll('{p}', prefix).slice(0, 1024), inline: false });
  else {
    const list = e?.sub ? exs.filter((x) => x.label === e.sub) : exs;
    fields.push({ name: 'Type it', value: list.map((x) => `\`${x.typed}\`${list.length > 1 && x.about ? `\n-# ${tidy(x.about)}` : ''}`).join('\n').slice(0, 1024) || `\`${prefix} ${cmd.call ?? cmd.name}\``, inline: false });
    if (!cmd.hidden && list.length === 1) fields.push({ name: 'Or with slash', value: `\`${list[0].slash}\``, inline: false });
  }
  const args = argsOf(cmd, e?.sub);
  if (args.length && !cmd.hint) fields.push({ name: 'What goes after it', value: args.map((a) => `\`${a.shown}\` ${a.about}${a.required ? '' : ' · *optional*'}`).join('\n').slice(0, 1024), inline: false });
  const names = [cmd.call ?? cmd.name, ...(cmd.text?.aliases ?? [])].filter((a, n, all) => !a.includes(' ') && all.indexOf(a) === n).sort((a, b) => a.length - b.length).slice(0, 5);
  if (names.length > 1) fields.push({ name: 'Short names', value: names.map((a) => `\`${prefix} ${a}\``).join(' · '), inline: true });
  if (cmd.admin || cmd.group === 'admin') fields.push({ name: 'Who', value: 'Admins and the staff role', inline: true });
  const label = e ? cap(e.label) : menu[cmd.name]?.[1] ?? cap(cmd.name);
  const about = tidy(e?.about ?? cmd.data.description);
  // just the explanation and a way back, running it is typing it
  const rows = [row(new ButtonBuilder().setCustomId(`nav|${o.back}|owner=${ctx.userId}`).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary))];
  return {
    embeds: [card({ kind: 'help', title: label, emoji: e?.emoji ?? '', gif: 'off', body: `${about}.\n-# Slash replies only show to you, typed ones to the channel.`, fields })],
    components: rows,
  };
}
