import { owoGlance } from '../modules/owo.js';
import type { Store } from '../db.js';
import type { Ctx } from './ctx.js';
import { levelOf, perksFor, rankFor } from '../modules/levels.js';
import { winsOf } from '../modules/f1quiz.js';
import { questGlance } from '../modules/missions.js';

// how each menu line reads: emoji, a plain name, and a better description where the command's own is too general
export const menu: Record<string, [string, string, string?]> = {
  poll: ['📊', 'Start a poll'], choose: ['🎯', 'Pick for me'], roll: ['🎲', 'Roll dice'], coin: ['🪙', 'Flip a coin'],
  ship: ['💞', 'Ship test'], '8ball': ['🎱', 'Magic 8ball'], guess: ['🔎', 'Guess the anime', 'A picture, four names, first right answer wins yen'],
  quiz: ['🏁', 'F1 quiz', '20 seconds, one try each, harder questions pay more'], trivia: ['🗞️', 'F1 trivia'], onthisday: ['📅', 'On this day', 'F1, football and anime history for today'],
  'onthisday~topic=f1': ['📅', 'On this day in F1', 'Races, wins and debuts that happened on today\'s date'], 'onthisday~topic=football': ['📅', 'On this day in football', 'Finals, transfers and famous matches from today\'s date'], 'onthisday~topic=anime': ['📅', 'On this day in anime', 'Premieres and finales from today\'s date'],
  quests: ['📜', 'Quests', 'Daily, weekly and rare quests with streaks'],
  spawns: ['🔎', 'Claim help status', 'What Texz reads, the helper switch, your rare, type and quest pings'], pokemon: ['🧩', 'Solve a hint', 'Type the hint, get the names that fit'],
  pings: ['🔔', 'Pings and reminders', 'Every ping and reminder Texz can send you, in one place'], remind: ['⏰', 'Remind me', 'Plain words: in 2h stretch, at 9pm call mum, tomorrow 8am gym'], reminders: ['🎛️', 'Reminder settings', 'Where reminders ping you, quiet hours and your time zone'],
  quote: ['🖼️', 'Make it a quote', 'Frame a message as a picture, reply with tz quote or paste a link'],
  'wish.list': ['💝', 'My Shoob wishlist'], 'wish.add': ['➕', 'Wish for a character'], 'wish.remove': ['➖', 'Drop a wish'],
  shiny: ['✨', 'Shiny hunt', 'Your chain, your odds and past shinies'], mydex: ['📔', 'Your Pokédex', 'Your progress by region and what\'s missing'],
  dex: ['📕', 'Server Pokédex', 'What\'s been caught here and what\'s missing'], race: ['🏃', 'Catch race', 'This week\'s race and 7-day spawn stats'],
  crestquiz: ['🛡️', 'Crest quiz', 'Guess the club from its crest, pays yen'],
  daily: ['💴', 'Daily yen'], work: ['💼', 'Agency shift'], crime: ['🖤', 'Port Mafia job'], fish: ['🎣', 'Go fishing'], beg: ['🥺', 'Beg'], bank: ['🏦', 'Your vault'], rob: ['🫳', 'Rob someone'], heist: ['🕶️', 'Crew heist'], roulette: ['🎡', 'Roulette'], scratch: ['🎟️', 'Scratch card'], rps: ['✊', 'Rock paper scissors'], wallet: ['👛', 'Wallet'], give: ['💸', 'Give yen'], rich: ['🏆', 'Richest'],
  'roleshop.view': ['🛍️', 'Role shop'], 'roleshop.buy': ['🛒', 'Buy a role'], 'roleshop.add': ['➕', 'Stock the shop'], 'roleshop.remove': ['➖', 'Take a role off sale'],
  watchparty: ['🍿', 'Plan a watch party'], recap: ['📺', 'This week in anime'],
  rank: ['🎖️', 'Rank card'], levels: ['🏆', 'Level leaderboard'], perks: ['✨', 'Rank perks'],
  'xp.give': ['➕', 'Give xp'], 'xp.take': ['➖', 'Take xp'], 'xp.level': ['🎚️', 'Set a level'], 'xp.reset': ['🧹', 'Reset xp'],
  avatar: ['🖼️', 'Avatar'], user: ['🕵️', 'User dossier'], 'profile.view': ['🪪', 'Profile card'], 'profile.edit': ['✏️', 'Edit my profile'],
  achievements: ['🎖️', 'Achievements', 'Every medal, and which ones show on your profile'],
  confess: ['🕯️', 'Confess', 'Post something anonymously in the confessional'],
  act: ['🤗', 'Hug, pat, bonk...', '25 ways to bother someone, each with an anime gif'],
  'mycolour.view': ['🎨', 'Your own role'], 'mycolour.buy': ['🎨', 'Buy your own role'], 'mycolour.colour': ['🎨', 'Recolour it'], 'mycolour.name': ['🎨', 'Rename it'], 'mycolour.icon': ['🎨', 'Give it an icon'], 'mycolour.remove': ['🎨', 'Delete it'],
  booth: ['🎙️', 'Private voice booth'],
  bonds: ['🫂', 'Closest people', 'Who you hug, pat and bonk the most here'],
  animehome: ['📺', 'What\'s on today', 'Airing today, your list and alerts at a glance'],
  server: ['🏛️', 'Server info'], afk: ['💤', 'Go afk'], ping: ['📡', 'Bot ping'], setup: ['🛠️', 'Setup desk', 'Features, channels, roles, welcome, logs, all with buttons'],
  'birthday.set': ['🎂', 'Set my birthday', 'No year needed, like 19 Feb'], 'birthday.remove': ['🗑️', 'Forget my birthday'], 'birthday.list': ['📆', 'Upcoming birthdays'], 'birthday.check': ['🔍', 'Someone\'s birthday'],
  'f1~view=next': ['🏎️', 'Next Grand Prix', 'Every session with your local times'], 'f1~view=standings': ['🏆', 'F1 standings', 'Drivers and teams'],
  'f1~view=last': ['🏁', 'Last race', 'The top ten and the gaps'], 'f1~view=quiz': ['❓', 'F1 quiz', 'Win yen'],
  'f1~view=trivia': ['🗞️', 'F1 trivia', 'One fact from Parc Fermé'], 'f1~view=today': ['📅', 'On this day', 'F1 history for today\'s date'],
  predict: ['🔮', 'Predictions', 'Call the podium and big matches, right calls pay yen'], predtop: ['🏆', 'Best predictors', 'All time and the football season'],
  'football.today': ['⚽', 'Today\'s matches'], 'football.fav': ['⭐', 'Add or remove a club'], 'football.favs': ['📋', 'Favourite clubs'],
  warn: ['⚠️', 'Warn'], timeout: ['🔇', 'Timeout'], kick: ['👢', 'Kick'], ban: ['🔨', 'Ban'], unban: ['🕊️', 'Unban'],
  purge: ['🧹', 'Purge messages'], lock: ['🔒', 'Lock or unlock'], slowmode: ['🐢', 'Slowmode'], 'vc.mute': ['🔇', 'Voice mute'], 'vc.unmute': ['🔊', 'Voice unmute'], 'vc.deafen': ['🙉', 'Deafen'], 'vc.undeafen': ['👂', 'Undeafen'], 'vc.kick': ['📵', 'Disconnect from voice'], 'vc.move': ['➡️', 'Move to a room'], 'vc.moveall': ['🚚', 'Move a whole room'], 'vc.ban': ['🚫', 'Ban from voice'], 'vc.unban': ['🎙️', 'Lift a voice ban'], 'vc.lock': ['🔒', 'Lock a voice room'], 'vc.unlock': ['🔓', 'Unlock a voice room'],
  'case.view': ['📂', 'Open a case'], 'case.list': ['🗄️', 'Case archive'], 'case.reason': ['✏️', 'Edit a case reason'], 'case.delete': ['🗑️', 'Delete a case'],
  rolepicker: ['🎭', 'Role picker'], 'giveaway.start': ['🎁', 'Start a giveaway'], 'giveaway.end': ['⏹️', 'End one now'],
  'giveaway.reroll': ['🔁', 'Reroll winners'], 'giveaway.cancel': ['✖️', 'Cancel one'], 'giveaway.list': ['📋', 'Running giveaways'],
  'announce.add': ['📣', 'Plan an announcement'], 'announce.list': ['🗓️', 'Planned posts'], 'announce.delete': ['🗑️', 'Drop a planned post'], serverstats: ['📊', 'Server activity'], 'backup.export': ['📤', 'Save the setup to a file'], 'backup.import': ['📥', 'Load a setup file'],
  'blackjack': ['🃏', 'Blackjack'],
  'coinflip': ['🪙', 'Coin flip bet'],
  'giveaway.weekly': ['🗓️', 'Weekly giveaway', 'Texz\'s own Sunday giveaway: switch it on or off, or move it'],
  'money.give': ['➕', 'Give someone yen'],
  'money.take': ['➖', 'Take yen away'],
  'money.set': ['🎚️', 'Set someone\'s yen'],
  'tree': ['🌳', 'Family tree'],
  'relation': ['🔗', 'How are we related'],
  'runaway': ['🎒', 'Run away from home'],
  'family': ['👪', 'Family'],
  'marry': ['💍', 'Marry'],
  'adopt': ['🍼', 'Adopt'],
  'divorce': ['💔', 'Divorce'],
  'disown': ['🚪', 'Disown'],
  'slots': ['🎰', 'Slots'],
  'count': ['🔢', 'Counting', 'Your counting record and the server\'s best'],
  'cotd': ['🎭', 'Character of the day'],
  'character': ['🧑', 'Character lookup'],
  'manga': ['📖', 'Manga lookup'],
  'search': ['🔍', 'Anime lookup'],
  'recommend~type=ANIME': ['🎲', 'Random anime', 'A popular anime picked at random, with where to start'],
  'recommend~type=MANGA': ['🎲', 'Random manga', 'A popular manga picked at random'],
  'watchlist.view': ['📋', 'Your list', 'Watching, planned, completed and dropped, yours or someone else\'s'],
  'watchlist.add': ['➕', 'Add to your list', 'Put a show on your list or move it, like watching or completed'],
  movie: ['🎬', 'Movie night', 'Find a movie, get ones like it, or pick one by genre, decade and length'],
  today: ['🎭', 'Character of the day', 'Today\'s anime character, with who they are and where they\'re from'],
  anime: ['🔍', 'Anime lookup', 'Score, episodes, studio, where to watch and the trailer'],
  alerts: ['🔔', 'Episode alerts', 'The shows you get a ping for when a new episode is out'],
  vc: ['🎙️', 'Voice moderation'], giveaway: ['🎁', 'Giveaways'], case: ['🗄️', 'Case files'], announce: ['📣', 'Planned posts'], xp: ['🎚️', 'Xp tools'],
  money: ['💴', 'Yen tools'], backup: ['💾', 'Setup backup'], birthday: ['🎂', 'Birthdays'], watchlist: ['📋', 'Your anime list'], mycolour: ['🎨', 'Your own role'],
  roleshop: ['🛍️', 'Role shop'], football: ['⚽', 'Football'], wish: ['💝', 'Shoob wishlist'], profile: ['🪪', 'Profile'], f1: ['🏎️', 'Formula 1'],
  recommend: ['🎲', 'Something random'],
  owosync: ['📡', 'What I know', 'Everything Texz has learnt about your OwO account and when it last saw it'],
  owoteam: ['🐾', 'Your teams', 'Your pets and weapons, plus advice on who should hold what, judged at equal level'],
  owoweapons: ['🗡️', 'Your weapons', 'Every weapon Texz knows, best first, with passives, wear and who holds it'],
  owozoo: ['🦁', 'Your zoo', 'Animals by rank, zoo points and everything you have ever caught'],
  owohb: ['🤖', 'Your HuntBot', 'What to upgrade next, what to skip, and what to sell or sacrifice'],
  owobattles: ['⚔️', 'Battle log', 'Win rate, xp a day, streaks and how long until each pet levels'],
  animelink: ['🔗', 'Link your list', 'AniList or MAL, your list and alerts follow it'],
  animelogin: ['🔑', 'AniList login', 'Changes you make here go to your AniList'],
  animewho: ['👥', 'Who\'s watching', 'Who in the server has a show on their list'],
  animecompare: ['🤝', 'Compare lists', 'Your list next to someone else\'s'],
  owogems: ['💎', 'Gems', 'What\'s running, how long it lasts, what to use next'],
  owoboard: ['🏆', 'Server board', 'This week\'s top hunters, rare catches and streaks'],
  owoxp: ['📈', 'Level forecast', 'Battles and days until a pet reaches a level'],
  owodex: ['📖', 'Dex', 'An animal\'s base stats, or two side by side'],
  owocatches: ['🏹', 'Catch log', 'Rare catches, totals by rank and your luck against OwO\'s odds'],
  owocollect: ['🎀', 'Collectibles', 'Alastor, Baby Yoda, run, carrots and puppies: what\'s done today'],
  owowall: ['🖼️', 'Wallpaper preview', 'Any shop wallpaper behind your profile, before you buy it'],
  owopings: ['🔔', 'Pings', 'HuntBot back, a new OwO day and the captcha alarm, each on or off'],
  owoweapon: ['🔎', 'One weapon in full', 'Each number against its range, how well it rolled and whether it is worth shards'],
  owodismantle: ['♻️', 'What can go', 'Weapons safe to dismantle for shards, with your keepers protected'],
  ororeroll: ['🎲', 'Reroll check', 'While you reroll, Texz says confirm or cancel and when to stop. On or off'],
  owoforget: ['🧹', 'Forget me', 'Wipe everything Texz learnt about your OwO account'],
};

// sections and the quick buttons of each generic dashboard
export const layout: Record<string, { sections: [string, string[]][]; quick: string[] }> = {
  admin: {
    sections: [
      ['⚖️ Deal with someone', ['warn', 'timeout', 'kick', 'ban', 'unban']],
      ['🎙️ Voice', ['vc.mute', 'vc.unmute', 'vc.deafen', 'vc.undeafen', 'vc.kick', 'vc.move', 'vc.moveall', 'vc.ban', 'vc.unban', 'vc.lock', 'vc.unlock']],
      ['🧹 This channel', ['purge', 'lock', 'slowmode']],
      ['🗄️ Case files', ['case.list', 'case.view', 'case.reason', 'case.delete']],
      ['🎁 Giveaways and roles', ['giveaway.start', 'giveaway.list', 'giveaway.end', 'giveaway.reroll', 'giveaway.cancel', 'giveaway.weekly', 'rolepicker']],
      ['📣 Posts, xp, yen and numbers', ['announce.add', 'announce.list', 'announce.delete', 'xp.give', 'xp.take', 'xp.level', 'money.give', 'money.take', 'money.set', 'serverstats']],
      ['🛠️ The building itself', ['setup', 'backup.export', 'backup.import']],
    ],
    quick: ['setup', 'giveaway.start', 'rolepicker', 'case.list', 'serverstats'],
  },
  poketwo: {
    sections: [['🔎 Claim help', ['spawns', 'pokemon']], ['✨ You', ['shiny', 'mydex']], ['📕 The server', ['dex', 'race']], ['🔔 Pings', ['pings']]],
    quick: ['spawns', 'pokemon', 'dex', 'race', 'pings'],
  },
  shoob: {
    sections: [['💝 Your wishlist', ['wish.list', 'wish.add', 'wish.remove']], ['🔔 Rare drops', ['pings', 'spawns']]],
    quick: ['wish.list', 'wish.add', 'pings'],
  },
  fun: {
    sections: [['🏆 Games that pay yen', ['quiz', 'crestquiz', 'guess', 'trivia']], ['🫂 Hugs, pats and bonks', ['act']], ['👪 Family', ['family', 'tree', 'marry', 'adopt', 'relation', 'divorce', 'disown', 'runaway']], ['🎉 For the channel', ['quote', 'ship', 'poll', 'onthisday', 'confess', 'count']], ['🎲 Small stuff', ['roll', 'coin', '8ball', 'choose']]],
    quick: ['act', 'quiz', 'crestquiz', 'guess', 'ship'],
  },
  profile: {
    sections: [
      ['🪪 Your file', ['profile.view', 'profile.edit', 'birthday.set', 'achievements', 'quests']],
      ['🎖️ Rank', ['rank', 'levels', 'perks']],
      ['🫂 Bonds', ['bonds']],
      ['🔔 Pings and birthdays', ['pings', 'birthday.list', 'birthday.check', 'birthday.remove']],
    ],
    quick: ['profile.view', 'profile.edit', 'birthday.set', 'rank', 'pings'],
  },
  yen: {
    sections: [['💴 Your money', ['daily', 'wallet', 'give', 'bank']], ['💼 Earn it', ['work', 'crime', 'fish', 'beg', 'rob', 'heist']], ['🎰 The back room', ['coinflip', 'slots', 'blackjack', 'roulette', 'scratch', 'rps']], ['🛍️ Spend it', ['mycolour.view', 'mycolour.buy', 'mycolour.colour', 'mycolour.name', 'mycolour.icon', 'mycolour.remove', 'roleshop.view', 'roleshop.buy']], ['🏆 Rich list', ['rich']], ['🔧 Shop keeping', ['roleshop.add', 'roleshop.remove']]],
    quick: ['daily', 'wallet', 'give', 'roleshop.view', 'rich'],
  },
  misc: {
    sections: [['🔍 Look up', ['user', 'avatar', 'server']], ['⏰ You', ['remind', 'reminders', 'afk', 'booth']], ['📡 The bot', ['ping']]],
    quick: ['user', 'server', 'remind', 'afk'],
  },
  owo: {
    sections: [
      ['📡 What I know', ['owosync']],
      ['🐾 Your account', ['owoteam', 'owozoo', 'owohb', 'owogems', 'owopings']],
      ['📒 Logs and dailies', ['owobattles', 'owoxp', 'owodex', 'owocatches', 'owocollect', 'owowall', 'owoboard']],
      ['🗡️ Weapons', ['owoweapons', 'owoweapon', 'owodismantle', 'ororeroll']],
      ['🧹 Your data', ['owoforget']],
    ],
    quick: [],
  },
  anime: {
    sections: [
      ['🔍 Look it up', ['anime', 'manga', 'character', 'today']],
      ['📋 Your shows', ['watchlist.view', 'watchlist.add', 'alerts', 'animehome']],
      ['🔗 AniList and MAL', ['animelink', 'animelogin', 'animewho', 'animecompare']],
      ['🍿 Watch together', ['watchparty', 'movie']],
      ['🎲 Something new', ['recommend~type=ANIME', 'recommend~type=MANGA']],
    ],
    quick: ['animehome', 'watchlist.view', 'watchparty', 'movie'],
  },
  sports: {
    sections: [['🏎️ Formula 1', ['f1~view=next', 'f1~view=standings', 'f1~view=last', 'f1~view=quiz', 'f1~view=trivia', 'f1~view=today']], ['⚽ Football', ['football.today', 'football.favs', 'football.fav']], ['🔮 Predictions', ['predict', 'predtop']], ['🔔 Pings', ['pings']]],
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
      return `${r.emoji} **${r.name}** · level **${l.level}** · 👛 **¥${w.yen.toLocaleString()}** · ${ready ? '💴 daily **ready**' : '💴 daily done'}${w.streak ? ` · 🔥 ${w.streak}` : ''}\n${questGlance(store, g, ctx.userId)}`;
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
    if (group === 'owo') return owoGlance(store, ctx.userId);
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
