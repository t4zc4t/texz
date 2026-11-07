import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, LabelBuilder, ModalBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type MessageActionRowComponentBuilder, type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './module.js';
import type { Ctx } from './ctx.js';
import { card } from '../theme.js';

// option types from discord
const SUB = 1, GROUP = 2, STR = 3, INT = 4, BOOL = 5, USER = 6, CHANNEL = 7, ROLE = 8, NUM = 10;

export interface RawOpt { type: number; name: string; description: string; required?: boolean; choices?: { name: string; value: string | number }[]; options?: RawOpt[]; max_length?: number; min_value?: number; max_value?: number }

// one line in a dashboard menu: a command, one of its subcommands, or one fixed choice of its first option
export interface Entry { key: string; cmd: Command; label: string; about: string; sub?: string; fixed?: Record<string, string>; opts: RawOpt[] }

export function entriesOf(cmd: Command): Entry[] {
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
    const label = new LabelBuilder().setLabel(short(o.name.replace(/_/g, ' '), 45)).setDescription(short(o.description, 100));
    const id = `f_${o.name}`;
    if (o.type === USER) label.setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1));
    else if (o.type === ROLE) label.setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId(id).setRequired(!!o.required).setMaxValues(1));
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
      if (o.type === BOOL || o.choices?.length) { const v = i.fields.getStringSelectValues(id)?.[0]; if (v) out[o.name] = v; continue; }
      const v = i.fields.getTextInputValue(id).trim();
      if (v) out[o.name] = v;
    } catch { /* not in the form */ }
  }
  return out;
}

export interface GroupInfo { label: string; emoji: string; about: string; extra?: string[] }

const row = <T extends MessageActionRowComponentBuilder>(...c: T[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// the front page of a group: everything it can do, buttons for the quick ones and a menu for the rest
export function homePage(ctx: Ctx, home: string, info: GroupInfo, entries: Entry[], blurb?: string) {
  const show = entries.filter((e) => !e.cmd.admin || ctx.isAdmin);
  const quick = show.filter((e) => !needsInput(e)).slice(0, 5);
  const lines = show.map((e) => `${needsInput(e) ? '📝' : '▫️'} **${e.label}** · ${short(e.about, 80)}`);
  const body = [info.about, blurb, '', ...lines, '-# 📝 asks you a question first, the rest open straight away'].filter((x) => x !== undefined).join('\n').slice(0, 4000);
  const owner = `owner=${ctx.userId},back=${home}`;
  const rows = [];
  if (quick.length) rows.push(row(...quick.map((e) => new ButtonBuilder().setCustomId(`nav|pick|${owner},key=${e.key}`).setLabel(short(e.label, 80)).setStyle(ButtonStyle.Secondary))));
  for (let n = 0; n < show.length && rows.length < 5; n += 25) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`nav|pick|${owner},m=${n}`).setPlaceholder(n ? '📂 More' : '📂 Open anything').addOptions(
      show.slice(n, n + 25).map((e) => ({ label: short(e.label, 100), value: e.key, description: short(`${needsInput(e) ? 'asks first · ' : ''}${e.about}`, 100) })),
    )));
  }
  return {
    embeds: [card({ kind: 'help', title: info.label, emoji: info.emoji, gif: 'off', body })],
    components: rows,
  };
}
