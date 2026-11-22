import { MessageFlags, type MessageContextMenuCommandInteraction } from 'discord.js';
import type { Store } from '../db.js';
import { runFor } from '../core/registry.js';
import * as read from './read.js';
import { rerollCard } from './listen.js';
import { OwoState } from './state.js';

export { OWO_MENU } from './menudef.js';

// which page fits the OwO message, and what to open it with
export function pageFor(s: read.Said): { cmd: string; opts?: Record<string, string> } {
  const w = read.weapon(s);
  if (w?.id) return { cmd: 'owoweapon', opts: { id: w.id } };
  const d = read.dex(s);
  if (d) return { cmd: 'owodex', opts: { animal: d.animal } };
  const wp = read.wallpaper(s);
  if (wp) return { cmd: 'owowall', opts: { id: String(wp.id) } };
  if (read.team(s) || read.pets(s)) return { cmd: 'owoteam' };
  if (read.huntbot(s) || read.huntbotNote(s)) return { cmd: 'owohb' };
  if (read.zoo(s)) return { cmd: 'owozoo' };
  if (read.weaponList(s)) return { cmd: 'owoweapons' };
  if (read.battle(s)) return { cmd: 'owobattles' };
  if (read.hunt(s)) return { cmd: 'owocatches' };
  const n = read.note(s);
  if (n && (n.kind === 'pet' || n.kind === 'minigame')) return { cmd: 'owocollect' };
  return { cmd: 'owosync' };
}

export async function onOwoMenu(store: Store, i: MessageContextMenuCommandInteraction) {
  const m = i.targetMessage;
  if (m.author.id !== '408785106942164992') return i.reply({ content: 'That one isn\'t from OwO.', flags: MessageFlags.Ephemeral });
  const s = read.said({ content: m.content, embeds: m.embeds.map((e) => e.toJSON()), components: m.components.map((c) => c.toJSON()) });
  const r = read.reroll(s);
  if (r) return i.reply({ embeds: [rerollCard(new OwoState(store.db), r)], flags: MessageFlags.Ephemeral });
  const page = pageFor(s);
  return runFor(store, i, page.cmd, page.opts ?? {});
}
