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

// the front page of a group: things that work with a click up top, things you type below with an example each
export function homePage(ctx: Ctx, home: string, info: GroupInfo, entries: Entry[], o: { layout?: Layout; glance?: string | null; off?: string[]; prefix?: string } = {}) {
  const prefix = o.prefix ?? 'tz';
  const show = entries.filter((e) => !e.cmd.admin || ctx.isAdmin);
  const click = show.filter((e) => !isTyped(e));
  const typed = show.filter(isTyped);
  const byKey = new Map(click.map((e) => [e.key, e]));
  const used = new Set<string>();
  const fields: { name: string; value: string; inline: boolean }[] = [];
  for (const [title, keys] of o.layout?.sections ?? []) {
    const list = keys.map((k) => byKey.get(k)).filter((e): e is Entry => !!e);
    list.forEach((e) => used.add(e.key));
    if (list.length) fields.push({ name: title.replace(/^\S+\s/, ''), value: list.map((e) => e.label).join('\n'), inline: true });
  }
  const rest = click.filter((e) => !used.has(e.key));
  if (rest.length) fields.push({ name: fields.length ? 'More' : 'Click to open', value: rest.map((e) => e.label).join('\n').slice(0, 1024), inline: true });
  if (typed.length) fields.push(...chunks('Type these', typed.map((e) => typedLine(e, prefix))));
  const quickKeys = (o.layout?.quick ?? click.map((e) => e.key)).filter((k) => byKey.has(k));
  const quick = quickKeys.map((k) => byKey.get(k)!).slice(0, 5);
  const notes = [
    o.glance,
    info.about,
    o.off?.length ? `-# ${o.off.join(', ')} ${o.off.length === 1 ? 'is' : 'are'} switched off here${ctx.isAdmin ? ', turn it on in \`/setup\` → Features' : ''}.` : null,
  ].filter(Boolean);
  const owner = `owner=${ctx.userId},back=${home}`;
  const rows = [];
  if (quick.length) rows.push(row(...quick.map((e) => new ButtonBuilder().setCustomId(`nav|pick|${owner},key=${e.key}`).setLabel(short(e.label, 80)).setStyle(ButtonStyle.Secondary))));
  for (let n = 0; n < click.length && rows.length < 3; n += 25) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`nav|pick|${owner},m=${n}`).setPlaceholder(n ? 'More' : 'Open something').addOptions(
      click.slice(n, n + 25).map((e) => ({ label: short(e.label, 100), value: e.key, description: short(e.about, 100) })),
    )));
  }
  if (!show.length) notes.push('Nothing to open here yet.');
  return {
    embeds: [card({ kind: 'help', title: info.label, emoji: info.emoji, gif: 'off', body: `${notes.join('\n')}${typed.length ? '\n-# ? means you can leave it out' : ''}`, fields })],
    components: rows,
  };
}

// the command list of a group, the way people use it: the typed command, the slash one, and what goes after
interface RefItem { key: string; name: string; text: string }
function refItems(entries: Entry[], group: string, prefix: string): RefItem[] {
  const seen = new Set<string>();
  const out: RefItem[] = [];
  const cap = (x: string) => x.replace(/^./, (c) => c.toUpperCase());
  for (const e of entries) {
    // a command with a few fixed choices, like on this day f1, football or anime, is one line
    if (e.fixed) {
      if (seen.has(e.cmd.name)) continue;
      seen.add(e.cmd.name);
      const word = e.cmd.call ?? e.cmd.name;
      const vals = entries.filter((x) => x.cmd.name === e.cmd.name && x.fixed).map((x) => Object.values(x.fixed!)[0]);
      const label = menu[e.cmd.name]?.[1] ?? cap(e.cmd.as ?? e.cmd.name);
      out.push({ key: e.key, name: e.cmd.name, text: `**${label}**\n\`${prefix} ${word} ${vals[0]}\`${e.cmd.hidden ? '' : ` · \`/${group} view:${e.cmd.as ?? e.cmd.name} input:${vals[0]}\``}\n-# ${vals.join(', ')}` });
      continue;
    }
    if (e.cmd.hint) {
      if (seen.has(e.cmd.name)) continue;
      seen.add(e.cmd.name);
      out.push({ key: e.key, name: e.cmd.name, text: `**${e.label}**\n${e.cmd.hint.replaceAll('{p}', prefix)}` });
      continue;
    }
    const all = examples(e.cmd, prefix);
    const ex = (e.sub ? all.find((x) => x.label === e.sub) : all[0]) ?? all[0];
    const word = e.cmd.call ?? e.cmd.name;
    const typed = ex?.typed ?? `${prefix} ${word}`;
    const slash = e.cmd.hidden ? null : ex?.slash ?? `/${group} view:${e.cmd.as ?? e.cmd.name}`;
    const args = argsOf(e.cmd, e.sub);
    const what = args.length ? args.slice(0, 3).map((a) => `${a.shown}${a.required ? '' : '?'} ${a.about.toLowerCase()}`).join(' · ') : e.about.toLowerCase() === e.label.toLowerCase() ? '' : e.about;
    // the short names, only for the plain command so subcommands don't repeat them
    const short = !e.sub ? (e.cmd.text?.aliases ?? []).filter((a) => !a.includes(' ') && a.length < (e.cmd.call ?? e.cmd.name).length).slice(0, 3) : [];
    const also = short.length ? ` · also ${short.map((a) => `\`${prefix} ${a}\``).join(' ')}` : '';
    out.push({ key: e.key, name: e.cmd.name, text: `**${cap(e.label)}**${also}\n\`${typed}\`${slash ? ` · \`${slash}\`` : ''}${what ? `\n-# ${what}` : ''}` });
  }
  return out;
}

// pages by length, so a page never gets long enough to scroll past
function paginate(items: RefItem[], max = 1000) {
  const pages: RefItem[][] = [[]];
  let len = 0;
  for (const it of items) {
    if (len + it.text.length > max && pages[pages.length - 1].length) { pages.push([]); len = 0; }
    pages[pages.length - 1].push(it);
    len += it.text.length + 2;
  }
  return pages;
}

export function refPageOf(entries: Entry[], group: string, prefix: string, name: string) {
  const pages = paginate(refItems(entries, group, prefix));
  return Math.max(0, pages.findIndex((p) => p.some((x) => x.name === name)));
}

// the reference page of a group: every command with both ways to run it, a few per page
export function refPage(ctx: Ctx, home: string, info: GroupInfo, entries: Entry[], o: { group: string; prefix: string; page?: number; focus?: string; glance?: string | null; off?: string[] }) {
  const pages = paginate(refItems(entries.filter((e) => !e.cmd.admin || ctx.isAdmin), o.group, o.prefix));
  const n = Math.min(Math.max(0, o.page ?? 0), pages.length - 1);
  const list = pages[n].map((x) => (x.name === o.focus ? `▸ ${x.text}` : x.text)).join('\n\n');
  const head = n === 0 ? [o.glance, info.about, o.off?.length ? `-# ${o.off.join(', ')} ${o.off.length === 1 ? 'is' : 'are'} switched off here${ctx.isAdmin ? ', turn it on in \`/setup\` → Features' : ''}.` : null].filter(Boolean).join('\n') : null;
  const owner = `owner=${ctx.userId}`;
  const nav = row(
    new ButtonBuilder().setCustomId(`nav|${home}|${owner},page=${n - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(n === 0),
    new ButtonBuilder().setCustomId(`nav|${home}|${owner},page=${n},x=1`).setLabel(`${n + 1} / ${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`nav|${home}|${owner},page=${n + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(n >= pages.length - 1),
    new ButtonBuilder().setCustomId(`nav|help|${owner}`).setLabel('Home').setStyle(ButtonStyle.Primary),
  );
  return {
    embeds: [card({ kind: 'help', title: info.label, emoji: info.emoji, gif: 'off', body: `${head ? `${head}\n\n` : ''}${list || 'Nothing here yet.'}\n\n-# ? means you can leave it out · slash replies only show to you` })],
    components: [nav],
  };
}
