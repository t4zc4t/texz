import type { Store } from '../db.js';
import type { Ctx } from './ctx.js';
import { levelOf, perksFor, rankFor } from '../modules/levels.js';
import { fmtDate } from '../modules/birthdays.js';
import { picksOf } from '../modules/profile.js';
import { winsOf } from '../modules/f1quiz.js';

// how each menu line reads: emoji, a plain name, and a better description where the command's own is too general
export const menu: Record<string, [string, string, string?]> = {
  poll: ['📊', 'Start a poll'], choose: ['🎯', 'Pick for me'], roll: ['🎲', 'Roll dice'], coin: ['🪙', 'Flip a coin'],
  ship: ['💞', 'Ship test'], '8ball': ['🎱', 'Magic 8ball'], guess: ['🔎', 'Guess the anime', 'A picture, four names, first right answer wins yen'],
  quiz: ['🏁', 'F1 quiz', '20 seconds, one try each, harder questions pay more'], trivia: ['🗞️', 'F1 trivia'], onthisday: ['📅', 'On this day in F1'],
  spawns: ['🃏', 'Spawn pings', 'Pokétwo, and Shoob by tier'], pokemon: ['🔎', 'Who\'s that pokémon', 'Solve a Pokétwo hint like p_k_ch_'],
  daily: ['💴', 'Daily yen'], balance: ['👛', 'Balance'], give: ['💸', 'Give yen'], rich: ['🏆', 'Richest'],
  'roleshop.view': ['🛍️', 'Role shop'], 'roleshop.buy': ['🛒', 'Buy a role'], 'roleshop.add': ['➕', 'Stock the shop'], 'roleshop.remove': ['➖', 'Take a role off sale'],
  rank: ['🎖️', 'Rank card'], levels: ['🏆', 'Level leaderboard'], perks: ['✨', 'Rank perks'],
  'xp.give': ['➕', 'Give xp'], 'xp.take': ['➖', 'Take xp'], 'xp.level': ['🎚️', 'Set a level'], 'xp.reset': ['🧹', 'Reset xp'],
  avatar: ['🖼️', 'Avatar'], user: ['🕵️', 'User dossier'], 'profile.view': ['🪪', 'Profile card'], 'profile.edit': ['✏️', 'Edit my profile'],
  server: ['🏛️', 'Server info'], afk: ['💤', 'Go afk'], pings: ['🔔', 'My pings'],
  'birthday.set': ['🎂', 'Set my birthday'], 'birthday.remove': ['🗑️', 'Forget my birthday'], 'birthday.list': ['📆', 'Upcoming birthdays'], 'birthday.check': ['🔍', 'Someone\'s birthday'],
  'f1~view=next': ['🏎️', 'Next Grand Prix', 'Every session with your local times'], 'f1~view=standings': ['🏆', 'F1 standings', 'Drivers and teams'],
  'f1~view=last': ['🏁', 'Last race', 'The top ten and the gaps'], 'f1~view=quiz': ['❓', 'F1 quiz', 'Win yen'],
  'f1~view=trivia': ['🗞️', 'F1 trivia', 'One fact from Parc Fermé'], 'f1~view=today': ['📅', 'On this day', 'F1 history for today\'s date'],
  'football.today': ['⚽', 'Today\'s matches'], 'football.fav': ['⭐', 'Add or remove a club'], 'football.favs': ['📋', 'Favourite clubs'],
  warn: ['⚠️', 'Warn'], timeout: ['🔇', 'Timeout'], kick: ['👢', 'Kick'], ban: ['🔨', 'Ban'], unban: ['🕊️', 'Unban'],
  purge: ['🧹', 'Purge messages'], lock: ['🔒', 'Lock or unlock'], slowmode: ['🐢', 'Slowmode'],
  'case.view': ['📂', 'Open a case'], 'case.list': ['🗄️', 'Case archive'], 'case.reason': ['✏️', 'Edit a case reason'], 'case.delete': ['🗑️', 'Delete a case'],
  rolepicker: ['🎭', 'Role picker'], 'giveaway.start': ['🎁', 'Start a giveaway'], 'giveaway.end': ['⏹️', 'End one now'],
  'giveaway.reroll': ['🔁', 'Reroll winners'], 'giveaway.cancel': ['✖️', 'Cancel one'], 'giveaway.list': ['📋', 'Running giveaways'],
  'announce.add': ['📣', 'Plan an announcement'], 'announce.list': ['🗓️', 'Planned posts'], 'announce.delete': ['🗑️', 'Drop a planned post'], serverstats: ['📊', 'Server activity'],
};

// sections and the quick buttons of each generic dashboard
export const layout: Record<string, { sections: [string, string[]][]; quick: string[] }> = {
  fun: {
    sections: [['🏆 Games that pay yen', ['quiz', 'guess']], ['🎉 For the channel', ['ship', 'poll', 'trivia', 'onthisday']], ['🎲 Small stuff', ['roll', 'coin', '8ball', 'choose']], ['🔔 Spawns', ['spawns', 'pokemon']]],
    quick: ['quiz', 'guess', 'ship', 'spawns', 'roll'],
  },
  eco: {
    sections: [['👛 Your yen', ['daily', 'balance', 'give', 'rich']], ['🛍️ Role shop', ['roleshop.view', 'roleshop.buy', 'roleshop.add', 'roleshop.remove']], ['🏆 Earn more', ['quiz', 'guess']]],
    quick: ['daily', 'balance', 'rich', 'roleshop.view', 'quiz'],
  },
  levels: {
    sections: [['🎖️ You', ['rank', 'perks']], ['🏆 Everyone', ['levels']], ['🛠️ Admins', ['xp.give', 'xp.take', 'xp.level', 'xp.reset']]],
    quick: ['rank', 'levels', 'perks'],
  },
  info: {
    sections: [['🪪 You', ['profile.view', 'profile.edit', 'pings', 'afk']], ['🎂 Birthdays', ['birthday.set', 'birthday.list', 'birthday.check', 'birthday.remove']], ['🔍 Look up', ['user', 'avatar', 'server']]],
    quick: ['profile.view', 'profile.edit', 'pings', 'birthday.list', 'server'],
  },
  sports: {
    sections: [['🏎️ Formula 1', ['f1~view=next', 'f1~view=standings', 'f1~view=last']], ['❓ F1 trivia', ['f1~view=quiz', 'f1~view=trivia', 'f1~view=today']], ['⚽ Football', ['football.today', 'football.favs', 'football.fav']]],
    quick: ['f1~view=next', 'f1~view=standings', 'f1~view=last', 'football.today', 'f1~view=quiz'],
  },
  mod: {
    sections: [['⚖️ Act on someone', ['warn', 'timeout', 'kick', 'ban', 'unban']], ['🧹 This channel', ['purge', 'lock', 'slowmode']], ['🗄️ Case archive', ['case.list', 'case.view', 'case.reason', 'case.delete']]],
    quick: ['warn', 'timeout', 'case.list', 'lock'],
  },
  tools: {
    sections: [['🎁 Giveaways', ['giveaway.start', 'giveaway.list', 'giveaway.end', 'giveaway.reroll', 'giveaway.cancel']], ['📣 Announcements', ['announce.add', 'announce.list', 'announce.delete']], ['🧰 Other', ['rolepicker', 'serverstats']]],
    quick: ['giveaway.start', 'giveaway.list', 'announce.add', 'serverstats', 'rolepicker'],
  },
};

const ago = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

// a line or two about the person looking, so a dashboard says something before anyone clicks
export function glance(group: string, ctx: Ctx, store: Store): string | null {
  const g = ctx.guildId;
  try {
    if (group === 'eco' && g) {
      const w = store.wallet(g, ctx.userId);
      const ready = w.daily_day !== new Date().toISOString().slice(0, 10);
      return `👛 **¥${w.yen.toLocaleString()}** · ${ready ? '💴 daily is **ready**' : `daily again ${ago(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000)}`}${w.streak ? ` · 🔥 ${w.streak} day streak` : ''}`;
    }
    if (group === 'levels' && g) {
      const l = levelOf(store.xpOf(g, ctx.userId).xp);
      const r = rankFor(l.level);
      const p = perksFor(l.level);
      return `${r.emoji} **${r.name}** · level **${l.level}** · ${l.into.toLocaleString()}/${l.need.toLocaleString()} xp to the next${p.xp > 1 ? ` · ✨ ${p.xp}x xp` : ''}`;
    }
    if (group === 'info') {
      const b = store.birthday(ctx.userId);
      const p = picksOf(store, ctx.userId);
      const picks = [p.club && `⚽ ${p.club}`, p.team && `🏎️ ${p.team}`, p.anime && `📺 ${p.anime}`].filter(Boolean).join(' · ');
      return `🎂 ${b ? fmtDate(b.month, b.day) : '*no birthday saved*'} · ${picks || '*no picks yet, Edit my profile adds them*'}`;
    }
    if (group === 'mod' && g) {
      const { total } = store.findCases(g, {}, 1);
      return `🗄️ **${total}** case${total === 1 ? '' : 's'} on file`;
    }
    if (group === 'tools' && g) {
      const gw = store.activeGiveaways(g).length;
      const posts = store.schedules(g).length;
      return `🎁 **${gw}** giveaway${gw === 1 ? '' : 's'} running · 📣 **${posts}** planned post${posts === 1 ? '' : 's'}`;
    }
    if (group === 'fun' && g && store.rules(g, 'economy').enabled) {
      const w = store.wallet(g, ctx.userId);
      const wins = winsOf(store, g, ctx.userId);
      return `👛 **¥${w.yen.toLocaleString()}** · 🏆 **${wins}** quiz and guess win${wins === 1 ? '' : 's'} · the quiz pays up to ¥60 a question`;
    }
  } catch { /* a glance is never worth failing the page over */ }
  return null;
}
