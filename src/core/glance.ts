import type { Store } from '../db.js';
import type { Ctx } from './ctx.js';
import { levelOf, perksFor, rankFor } from '../modules/levels.js';
import { winsOf } from '../modules/f1quiz.js';
import { missionOf } from '../modules/missions.js';

// how each menu line reads: emoji, a plain name, and a better description where the command's own is too general
export const menu: Record<string, [string, string, string?]> = {
  poll: ['📊', 'Start a poll'], choose: ['🎯', 'Pick for me'], roll: ['🎲', 'Roll dice'], coin: ['🪙', 'Flip a coin'],
  ship: ['💞', 'Ship test'], '8ball': ['🎱', 'Magic 8ball'], guess: ['🔎', 'Guess the anime', 'A picture, four names, first right answer wins yen'],
  quiz: ['🏁', 'F1 quiz', '20 seconds, one try each, harder questions pay more'], trivia: ['🗞️', 'F1 trivia'], onthisday: ['📅', 'On this day', 'F1, football and anime history for today'],
  'onthisday~topic=f1': ['📅', 'On this day in F1'], 'onthisday~topic=football': ['📅', 'On this day in football'], 'onthisday~topic=anime': ['📅', 'On this day in anime'],
  mission: ['🕵️', 'Today\'s mission', 'A daily challenge for bonus yen'],
  spawns: ['🔎', 'Claim help status', 'What Texz reads, the helper switch and your rare and type pings'], pokemon: ['🧩', 'Solve a hint', 'Type the hint, get the names that fit'],
  pings: ['🔔', 'Pings and reminders', 'Every ping and reminder Texz can send you, in one place'], remind: ['⏰', 'Remind me', 'A one-off reminder, like 2h drink water'], reminders: ['🎛️', 'OwO reminders', 'Which OwO timers ping you, where and when'],
  quote: ['🖼️', 'Make it a quote', 'Frame a message as a picture, reply with tz quote or paste a link'],
  'wish.list': ['💝', 'My Shoob wishlist'], 'wish.add': ['➕', 'Wish for a character'], 'wish.remove': ['➖', 'Drop a wish'],
  dex: ['📕', 'Server Pokédex', 'What\'s been caught here and what\'s missing'], race: ['🏃', 'Catch race', 'Who catches the most this week'],
  crestquiz: ['🛡️', 'Crest quiz', 'Guess the club from its crest, pays yen'],
  daily: ['💴', 'Daily yen'], wallet: ['👛', 'Wallet'], give: ['💸', 'Give yen'], rich: ['🏆', 'Richest'],
  'roleshop.view': ['🛍️', 'Role shop'], 'roleshop.buy': ['🛒', 'Buy a role'], 'roleshop.add': ['➕', 'Stock the shop'], 'roleshop.remove': ['➖', 'Take a role off sale'],
  watchparty: ['🍿', 'Plan a watch party'], recap: ['📺', 'This week in anime'],
  rank: ['🎖️', 'Rank card'], levels: ['🏆', 'Level leaderboard'], perks: ['✨', 'Rank perks'],
  'xp.give': ['➕', 'Give xp'], 'xp.take': ['➖', 'Take xp'], 'xp.level': ['🎚️', 'Set a level'], 'xp.reset': ['🧹', 'Reset xp'],
  avatar: ['🖼️', 'Avatar'], user: ['🕵️', 'User dossier'], 'profile.view': ['🪪', 'Profile card'], 'profile.edit': ['✏️', 'Edit my profile'],
  achievements: ['🎖️', 'Achievements', 'Every medal, and which ones show on your profile'],
  confess: ['🕯️', 'Confess', 'Post something anonymously in the confessional'],
  act: ['🤗', 'Hug, pat, bonk...', '25 ways to bother someone, each with an anime gif'],
  animehome: ['📺', 'What\'s on today', 'Airing today, your list and alerts at a glance'],
  server: ['🏛️', 'Server info'], afk: ['💤', 'Go afk'], ping: ['📡', 'Bot ping'], setup: ['🛠️', 'Setup desk', 'Features, channels, roles, welcome, logs, all with buttons'],
  'birthday.set': ['🎂', 'Set my birthday'], 'birthday.remove': ['🗑️', 'Forget my birthday'], 'birthday.list': ['📆', 'Upcoming birthdays'], 'birthday.check': ['🔍', 'Someone\'s birthday'],
  'f1~view=next': ['🏎️', 'Next Grand Prix', 'Every session with your local times'], 'f1~view=standings': ['🏆', 'F1 standings', 'Drivers and teams'],
  'f1~view=last': ['🏁', 'Last race', 'The top ten and the gaps'], 'f1~view=quiz': ['❓', 'F1 quiz', 'Win yen'],
  'f1~view=trivia': ['🗞️', 'F1 trivia', 'One fact from Parc Fermé'], 'f1~view=today': ['📅', 'On this day', 'F1 history for today\'s date'],
  predict: ['🔮', 'Predictions', 'Call the podium and big matches, right calls pay yen'], predtop: ['🏆', 'Best predictors'],
  'football.today': ['⚽', 'Today\'s matches'], 'football.fav': ['⭐', 'Add or remove a club'], 'football.favs': ['📋', 'Favourite clubs'],
  warn: ['⚠️', 'Warn'], timeout: ['🔇', 'Timeout'], kick: ['👢', 'Kick'], ban: ['🔨', 'Ban'], unban: ['🕊️', 'Unban'],
  purge: ['🧹', 'Purge messages'], lock: ['🔒', 'Lock or unlock'], slowmode: ['🐢', 'Slowmode'],
  'case.view': ['📂', 'Open a case'], 'case.list': ['🗄️', 'Case archive'], 'case.reason': ['✏️', 'Edit a case reason'], 'case.delete': ['🗑️', 'Delete a case'],
  rolepicker: ['🎭', 'Role picker'], 'giveaway.start': ['🎁', 'Start a giveaway'], 'giveaway.end': ['⏹️', 'End one now'],
  'giveaway.reroll': ['🔁', 'Reroll winners'], 'giveaway.cancel': ['✖️', 'Cancel one'], 'giveaway.list': ['📋', 'Running giveaways'],
  'announce.add': ['📣', 'Plan an announcement'], 'announce.list': ['🗓️', 'Planned posts'], 'announce.delete': ['🗑️', 'Drop a planned post'], serverstats: ['📊', 'Server activity'], 'backup.export': ['📤', 'Save the setup to a file'], 'backup.import': ['📥', 'Load a setup file'],
};

// sections and the quick buttons of each generic dashboard
export const layout: Record<string, { sections: [string, string[]][]; quick: string[] }> = {
  admin: {
    sections: [
      ['⚖️ Deal with someone', ['warn', 'timeout', 'kick', 'ban', 'unban']],
      ['🧹 This channel', ['purge', 'lock', 'slowmode']],
      ['🗄️ Case files', ['case.list', 'case.view', 'case.reason', 'case.delete']],
      ['🎁 Giveaways and roles', ['giveaway.start', 'giveaway.list', 'giveaway.end', 'giveaway.reroll', 'rolepicker']],
      ['📣 Posts, xp and numbers', ['announce.add', 'announce.list', 'xp.give', 'xp.level', 'serverstats']],
      ['🛠️ The building itself', ['setup', 'backup.export', 'backup.import']],
    ],
    quick: ['setup', 'giveaway.start', 'rolepicker', 'case.list', 'serverstats'],
  },
  poketwo: {
    sections: [['🔎 Claim help', ['spawns', 'pokemon']], ['📕 The server', ['dex', 'race']], ['🔔 Pings', ['pings']]],
    quick: ['spawns', 'pokemon', 'dex', 'race', 'pings'],
  },
  shoob: {
    sections: [['💝 Your wishlist', ['wish.list', 'wish.add', 'wish.remove']], ['🔔 Rare drops', ['pings', 'spawns']]],
    quick: ['wish.list', 'wish.add', 'pings'],
  },
  fun: {
    sections: [['🏆 Games that pay yen', ['quiz', 'crestquiz', 'guess', 'trivia']], ['🫂 Hugs, pats and bonks', ['act']], ['🎉 For the channel', ['quote', 'ship', 'poll', 'onthisday', 'confess']], ['🎲 Small stuff', ['roll', 'coin', '8ball', 'choose']]],
    quick: ['act', 'quiz', 'crestquiz', 'guess', 'ship'],
  },
  profile: {
    sections: [
      ['🪪 Your file', ['profile.view', 'profile.edit', 'achievements', 'mission']],
      ['🎖️ Rank', ['rank', 'levels', 'perks']],
      ['🔔 Pings and birthdays', ['pings', 'birthday.set', 'birthday.list', 'birthday.check']],
    ],
    quick: ['profile.view', 'profile.edit', 'rank', 'achievements', 'pings'],
  },
  yen: {
    sections: [['💴 Your money', ['daily', 'wallet', 'give']], ['🛍️ Spend it', ['roleshop.view', 'roleshop.buy']], ['🏆 Rich list', ['rich']], ['🔧 Shop keeping', ['roleshop.add', 'roleshop.remove']]],
    quick: ['daily', 'wallet', 'give', 'roleshop.view', 'rich'],
  },
  misc: {
    sections: [['🔍 Look up', ['user', 'avatar', 'server']], ['⏰ You', ['remind', 'afk']], ['📡 The bot', ['ping']]],
    quick: ['user', 'server', 'remind', 'afk'],
  },
  sports: {
    sections: [['🏎️ Formula 1', ['f1~view=next', 'f1~view=standings', 'f1~view=last']], ['⚽ Football', ['football.today', 'football.favs', 'football.fav']], ['🔮 Predictions', ['predict', 'predtop']], ['🔔 Pings', ['pings']]],
    quick: ['f1~view=next', 'f1~view=standings', 'football.today', 'predict', 'pings'],
  },
};

const ago = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;

// a line or two about the person looking, so a dashboard says something before anyone clicks
export function glance(group: string, ctx: Ctx, store: Store): string | null {
  const g = ctx.guildId;
  try {
    if (group === 'profile' && g) {
      const w = store.wallet(g, ctx.userId);
      const l = levelOf(store.xpOf(g, ctx.userId).xp);
      const r = rankFor(l.level);
      const ready = w.daily_day !== new Date().toISOString().slice(0, 10);
      const m = missionOf(g);
      const done = Number(store.getKv(`mission:${g}:${new Date().toISOString().slice(0, 10)}:${ctx.userId}`) ?? 0) >= m.need;
      return `${r.emoji} **${r.name}** · level **${l.level}** · 👛 **¥${w.yen.toLocaleString()}** · ${ready ? '💴 daily **ready**' : '💴 daily done'}${w.streak ? ` · 🔥 ${w.streak}` : ''}\n🕵️ Mission: **${m.text}** ${done ? '✅' : ''}`;
    }
    if (group === 'yen' && g) {
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
    if (group === 'admin' && g) {
      const { total } = store.findCases(g, {}, 1);
      const gw = store.activeGiveaways(g).length;
      const posts = store.schedules(g).length;
      return `🗄️ **${total}** case${total === 1 ? '' : 's'} on file · 🎁 **${gw}** giveaway${gw === 1 ? '' : 's'} running · 📣 **${posts}** planned post${posts === 1 ? '' : 's'}`;
    }
    if (group === 'fun' && g && store.rules(g, 'economy').enabled) {
      const w = store.wallet(g, ctx.userId);
      const wins = winsOf(store, g, ctx.userId);
      return `👛 **¥${w.yen.toLocaleString()}** · 🏆 **${wins}** quiz and guess win${wins === 1 ? '' : 's'} · the quiz pays up to ¥60 a question`;
    }
  } catch { /* a glance is never worth failing the page over */ }
  return null;
}
