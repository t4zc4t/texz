import type { Store } from '../db.js';
import { minigames } from '../owo/commands.js';
import { owoDay } from '../time.js';

export const checklistItems = ['daily', 'vote', 'cookie', 'quest', 'checklist'] as const;

const labels: Record<string, string> = {
  daily: '`owo daily`',
  vote: '`owo vote` (top.gg)',
  cookie: '`owo cookie @friend`',
  quest: '`owo quest`',
  checklist: '`owo cl` to claim the checklist reward',
  alastor: '`owo alastor feed`',
  babyyoda: '`owo babyyoda`',
  piku: '`owo piku`',
  run: '`owo run`',
  puppy: '`owo puppy`',
};

function weekAgo(now: Date): string {
  return owoDay(new Date(now.getTime() - 7 * 86_400_000));
}

// minigames only count once the user has played them in the last week
export function trackedItems(store: Store, userId: string, now = new Date()): string[] {
  const s = store.settings(userId);
  const items: string[] = [...checklistItems];
  if (s.minigames) items.push(...store.usedSince(userId, weekAgo(now), minigames));
  return items;
}

export function dayStatus(store: Store, userId: string, now = new Date()) {
  const done = store.doneOn(userId, owoDay(now));
  const items = trackedItems(store, userId, now);
  return items.map((what) => ({ what, label: labels[what] ?? what, done: done.has(what) }));
}

export function todoLines(store: Store, userId: string, now = new Date()): string[] {
  return dayStatus(store, userId, now).filter((i) => !i.done).map((i) => `• ${i.label}`);
}
