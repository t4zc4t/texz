import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, FileUploadBuilder, LabelBuilder, ModalBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type MessageActionRowComponentBuilder, type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './module.js';
import type { Ctx } from './ctx.js';
import { card } from '../theme.js';
import { menu } from './glance.js';

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
// just the name, the menu below carries the descriptions, so the page stays short
const line = (e: Entry) => `${e.emoji ?? '▫️'} ${e.label}${needsInput(e) ? ' 📝' : ''}`;

// the front page of a group: a line about you, everything sorted into sections, buttons for the quick ones and a menu for all of it
export function homePage(ctx: Ctx, home: string, info: GroupInfo, entries: Entry[], o: { layout?: Layout; glance?: string | null; off?: string[] } = {}) {
  const show = entries.filter((e) => !e.cmd.admin || ctx.isAdmin);
  const byKey = new Map(show.map((e) => [e.key, e]));
  const used = new Set<string>();
  const fields: { name: string; value: string; inline: boolean }[] = [];
  for (const [title, keys] of o.layout?.sections ?? []) {
    const list = keys.map((k) => byKey.get(k)).filter((e): e is Entry => !!e);
    list.forEach((e) => used.add(e.key));
    if (list.length) fields.push({ name: title, value: list.map(line).join('\n'), inline: true });
  }
  const rest = show.filter((e) => !used.has(e.key));
  if (rest.length) fields.push({ name: fields.length ? '📂 More' : '📂 Everything', value: rest.map(line).join('\n').slice(0, 1024), inline: true });
  const quickKeys = o.layout?.quick ?? show.filter((e) => !needsInput(e)).map((e) => e.key);
  const quick = quickKeys.map((k) => byKey.get(k)).filter((e): e is Entry => !!e).slice(0, 5);
  const notes = [
    o.glance,
    info.about,
    o.off?.length ? `-# ${o.off.join(', ')} ${o.off.length === 1 ? 'is' : 'are'} switched off here${ctx.isAdmin ? ', turn it on in `/setup` → Features' : ''}.` : null,
  ].filter(Boolean);
  const owner = `owner=${ctx.userId},back=${home}`;
  const rows = [];
  if (quick.length) rows.push(row(...quick.map((e) => {
    const b = new ButtonBuilder().setCustomId(`nav|pick|${owner},key=${e.key}`).setLabel(short(e.label, 80)).setStyle(ButtonStyle.Secondary);
    return e.emoji ? b.setEmoji(e.emoji) : b;
  })));
  for (let n = 0; n < show.length && rows.length < 5; n += 25) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`nav|pick|${owner},m=${n}`).setPlaceholder(n ? '📂 More' : '📂 Open anything').addOptions(
      show.slice(n, n + 25).map((e) => ({ label: short(e.label, 100), value: e.key, description: short(`${needsInput(e) ? 'asks first · ' : ''}${e.about}`, 100), ...(e.emoji ? { emoji: e.emoji } : {}) })),
    )));
  }
  if (!show.length) notes.push('Nothing to open here yet.');
  return {
    embeds: [card({ kind: 'help', title: info.label, emoji: info.emoji, gif: 'off', body: `${notes.join('\n')}\n-# 📝 asks first · use the buttons or the menu`, fields })],
    components: rows,
  };
}
