import { EmbedBuilder } from 'discord.js';
import { cached, momentOf, pickDefault } from './gifs.js';

// sand coat and old bandages
export const COLOR = 0xc2a46e;
export const DARK = 0x3b3128;
export const RED = 0xb5523b;

export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// Texz talks like the Agency's laziest genius: teasing, theatrical, never actually mean.
// All lines are written for this bot, in the spirit of the character.
const bank = {
  footer: [
    'Armed Detective Agency · currently on an extended break',
    'Texz · bandages, crab, and a frightening amount of foresight',
    'Kunikida-kun says I should be working. I am. Spiritually.',
    'Filed under: mysteries I solved without getting up',
    'Agency case notes · please hide these from Kunikida-kun',
    'Sponsored by nobody. Crab donations welcome.',
    'Written by a humble detective with a terrible work ethic',
    'Ranpo-san solved this first. He always does. Rude.',
  ],
  help: [
    'Ahh, a client! Come in, come in. Don\'t mind the bandages, they\'re fashion.',
    'You want my services? How flattering. Here\'s everything this humble detective does~',
    'Kunikida-kun made me write a list of my duties. I lost it twice. This is attempt number three.',
    'Detective, informant, professional napper. Pick a service, any service.',
    'The Agency is at your disposal. Well, I am. The others are busy being responsible.',
  ],
  ping: [
    'Haah~ you woke me. I was dreaming of an all-you-can-eat crab buffet.',
    'Present! Don\'t tell Kunikida-kun you found me this fast, he\'ll start expecting it.',
    'Alive and well. Disappointingly punctual, even.',
    'Pong~ Kunikida-kun timed that. He wrote it in his notebook. Twice.',
    'Ara, checking if I\'m awake? I\'m always watching. Mostly with my eyes closed.',
  ],
  status: [
    'Let\'s open your case file... hmm, hmm. I see everything. Including that daily you skipped.',
    'Atsushi-kun would read this twice. One glance was enough for me~',
    'Case file opened. The suspect: you. The crime: unfinished dailies.',
    'Your whole little empire on one page. Mine would just say "napped, ate crab".',
    'A good detective always knows where his client stands. You stand... right here.',
  ],
  huntbot: [
    'Your little robot hunts while you rest. I admire that philosophy deeply.',
    'I studied your huntbot. The answer was obvious, but I\'ll pretend it took effort.',
    'Essence maths. Kunikida-kun would build a spreadsheet. I just know.',
    'If only Kunikida-kun followed my schedule as loyally as this huntbot follows yours.',
  ],
  gems: [
    'Gems are like a good scheme. Pair them right and everything falls into place at once~',
    'Ranpo-san would call this obvious. He\'s right. I\'m just prettier about it.',
    'Shiny little stones, perfectly matched. I\'d make a lovely jeweller, if jewellers napped more.',
  ],
  zoo: [
    'So many spare animals... the ones you love stay. The rest can pay rent in essence.',
    'I counted your zoo. Twice. The second time purely out of boredom.',
    'Kyouka-chan asked me to be gentle with the animals. I promised. Mostly.',
  ],
  armoury: [
    'An armoury! Let\'s see which of these are treasures and which are... decoration.',
    'An arsenal worthy of the Port Mafia. Please don\'t tell them I said that.',
    'Weapons say a lot about a person. Yours say "hoarder". Affectionately.',
  ],
  armouryAll: [
    'Every blade, staff and... fish? you own, lined up for inspection. I don\'t judge.',
    'The full arsenal. Kunikida-kun would alphabetise it. I sorted it by sparkle.',
  ],
  team: [
    'Partners are everything. Trust me, I once had a hat-wearing chibi for one.',
    'Let\'s see who holds what. A sword in the wrong hands is a tragedy. Or a comedy.',
    'Your trio, inspected. Better teamwork than the Agency on a Monday, I\'ll admit.',
  ],
  weapon: [
    'Numbers never lie. People do, constantly, delightfully. But numbers? Never.',
    'Who should wield this? Let\'s let the evidence decide, like proper detectives.',
    'A genius does this in his head. I wrote it down anyway, for the sceptics.',
  ],
  questsDone: [
    'Every quest done? How diligent. You\'re making me look bad, please stop.',
    'All finished. You\'ve earned a nap. I\'ve earned three, for supervising.',
  ],
  quests: [
    'Little mysteries, little rewards. Here\'s what\'s still open on your board.',
    'Some of these need friends. Lucky you, you know a very charming detective.',
  ],
  stats: [
    'Your week in numbers. I counted every hunt while pretending to sleep.',
    'Statistics! Kunikida-kun\'s favourite bedtime story.',
  ],
  leaderboard: [
    'The most dedicated hunters this week. I\'m not on it. By choice. Obviously.',
    'Someone here works far too hard. Admirable. Exhausting just to look at.',
    'A ranking! Chuuya would demand a recount. He always loses those.',
  ],
  remindAdd: [
    'Noted~ I\'ll remember so you don\'t have to. That\'s what partners are for.',
    'Leave it to me. I may nap, but I never forget a promise. Mostly.',
  ],
  remindCancel: ['Cancelled. Consider it forgotten. I\'m wonderfully good at forgetting things.'],
  buddyJoin: ['Welcome to my network of informants. Every great detective needs a few~'],
  buddyLeave: ['Leaving the network? Fine. I\'ll pretend I didn\'t notice. I noticed.'],
  ask: [
    'is calling in a favour from the network~',
    'needs a small kindness. The Agency runs on these.',
    'sent word through my informants. Who answers first gets my eternal respect.',
  ],
  askCooldown: ['Patience, partner. Pester informants too often and they vanish into the night.'],
  settings: [
    'Your preferences, filed and stamped. Look at me, doing paperwork voluntarily.',
    'Every switch and lever, right here. Kunikida-kun would weep with pride.',
  ],
  missing: [
    'I can\'t crack a case without evidence, partner.',
    'Even a genius needs one tiny clue first.',
    'No evidence. I could guess, I\'d be right, but you\'d learn nothing~',
  ],
  off: [
    'That door\'s locked here. Someone with the keys decided I deserve a holiday.',
    'Closed for today. The Agency needs its rest. Mostly me.',
    'Not in this server, I\'m afraid. They switched it off, and I\'m happily lounging.',
  ],
  wrongChannel: [
    'Wrong room, partner. Try it in {where}, I\'ll be lying down there.',
    'I only take that case in {where}. Even I follow a rule or two.',
  ],
  noRole: [
    'That case is for a select few. Not you, not today~',
    'You need a certain role for that. I don\'t make the rules, I just enjoy watching them.',
  ],
  noPerm: [
    'You\'d need Manage Server for that. Bold attempt though, I respect it.',
    'Admin business. Fetch me an admin and some crab. In that order.',
  ],
  error: [
    'Ah. That slipped. Even a genius trips over his own coat sometimes.',
    'That broke on my side. How embarrassing. Don\'t tell Chuuya, he\'ll never let it go.',
    'Well, that didn\'t go to plan. Plans rarely survive contact with me. Try again?',
  ],
  gif: ['A moving picture for the moment. Taste matters, even for detectives.'],
  huntbotBackShort: [
    'your huntbot is home, collect the loot before it gets ideas.',
    'the little robot is back, tail wagging.',
    'huntbot returned. Loyal thing. Unlike some partners I could name.',
  ],
  prayShort: ['prayers recharged~ go bless someone. Or curse them. I won\'t tell.', 'pray and curse are ready again.'],
  voteShort: ['voting\'s open again, crab money awaits.', 'twelve hours passed, go vote~'],
  newDayShort: ['a brand new OwO day! Today\'s duties:', 'the clock reset, here\'s the list:'],
  lastCallShort: ['two hours left and these are still open:', 'last call before the reset, partner:'],
  customShort: ['you asked me to remind you:', 'as promised~'],
  anime: [
    'An anime case! I\'ve gathered the evidence. Spoiler-free, I\'m not a monster.',
    'Ah, a fellow connoisseur. Here\'s everything worth knowing~',
    'I investigated this one personally. During work hours. Don\'t tell Kunikida-kun.',
  ],
  manga: [
    'A manga! Atsushi-kun reads these when he thinks no one\'s looking.',
    'Ink, paper and drama. My favourite kind of evidence.',
  ],
  character: [
    'A person of interest. Let\'s see what the file says about them~',
    'Every character hides something. Here\'s what they didn\'t manage to hide.',
  ],
  season: [
    'This season\'s most talked about suspects, ranked by popularity.',
    'The season\'s lineup. Kunikida-kun says I can\'t watch all of them. Watch me.',
  ],
  trending: [
    'What everyone\'s obsessed with right now. I was into it before it was cool, obviously.',
    'The current craze, investigated and ranked.',
  ],
  alerts: ['Every show you\'ve asked me to watch for. I never miss a premiere~'],
  episode: ['New episode, partner! It\'s out right now.', 'Drop everything. A new episode just aired~'],
  avatar: ['A face worth investigating. Here, in full resolution.', 'Hm, a handsome profile. Not as handsome as mine, but close.'],
  user: ['A dossier on this one. Every detective keeps files on everyone. Hypothetically.', 'Background check complete~'],
  server: ['The whole establishment, inspected. Nice place. Could use more crab.', 'Everything about this server, at a glance.'],
  poll: ['A vote! Democracy, how exciting. I\'ve already guessed the winner.', 'Cast your votes. I promise not to rig it. Probably.'],
  choose: ['After careful deduction, and absolutely no coin tossing...', 'The answer was obvious from the start~'],
  roll: ['The dice have spoken. I may or may not have nudged them.', 'Rolling... fate is fun when it\'s random.'],
  coin: ['Heads or tails, fate decides. Or physics. Or me.', 'Flipped. Caught. Revealed~'],
  eightball: [
    'Without a doubt. I already knew, of course.',
    'Absolutely. Even Kunikida-kun would agree.',
    'Signs point to yes. And I\'m very good at reading signs.',
    'Yes~ but don\'t tell anyone I said so.',
    'Probably. I\'d bet a crab on it.',
    'Hmm. Ask me after my nap.',
    'The future is cloudy. Like Chuuya\'s judgement.',
    'Better not tell you now. Suspense is half the fun.',
    'Unlikely. Even my schemes have limits.',
    'No. And I say that with love.',
    'Ranpo-san says no, and he\'s never wrong. Annoyingly.',
  ],
  afkReason: [
    'Buying more bandages, back soon~',
    'Napping. Do not disturb the genius.',
    'Hiding from Kunikida-kun\'s schedule.',
    'Crab hunting.',
    'On a very important stakeout (lying on a bench).',
    'Reading a suspicious novel somewhere quiet.',
    'Off annoying a certain hat-wearing chibi.',
  ],
  afkSet: ['Off on a break? Very wise. I\'ll tell anyone who comes looking.', 'Away you go. I\'ll guard your seat~'],
  afkBack: ['Welcome back! Did you nap? Tell me you napped.', 'Ah, you\'ve returned. The Agency missed you. I did, a little.'],
  afkMention: ['is away right now', 'stepped out for a bit'],
  huntbotBack: [
    'Your huntbot is home, carrying gifts like a loyal little hound.',
    'Ding! The robot returns. Collect its haul before it develops a personality.',
  ],
  prayReady: [
    'Prayers and curses recharged. Use them wisely. Or chaotically. I won\'t judge.',
    'Pray and curse are ready. Bless a friend, curse a rival, live a little~',
  ],
  voteReady: ['Voting is open again. Democracy and crab money, everybody wins.', 'Twelve hours passed. Your vote awaits~'],
  huntReady: ['Hunt and battle are ready. Off you go~'],
  newDay: [
    'A brand new OwO day! Kunikida-kun would want you to start right now. I\'d want you to nap first.',
    'The clock reset. I planned your whole day already, it\'s right below.',
  ],
  lastCall: [
    'Two hours until the reset and these are still open. I wouldn\'t hurry. You should.',
    'Last call, partner. These slip away at the reset:',
  ],
  custom: ['You asked me to remind you, so here I am, as promised~'],
  captcha: ['Urgent! OwO wants proof you\'re human in {where}. Answer it now, ignoring it gets you banned from the bot.'],
};

export type Kind = keyof typeof bank;

// set once the bot logs in, used as the little icon on every card
export const look = { avatar: null as string | null };

export const bar = (have: number, need: number, width = 12) => {
  const n = need > 0 ? Math.max(0, Math.min(width, Math.round((have / need) * width))) : 0;
  return '▰'.repeat(n) + '▱'.repeat(width - n);
};

export interface CardOptions {
  kind: Kind;
  title: string;
  emoji?: string;
  color?: number;
  body?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  gif?: string | null;
  at?: number;
  vars?: Record<string, string>;
}

// the house style: Agency header, a line in Texz's voice, then the actual content
export function card(o: CardOptions): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(o.color ?? COLOR)
    .setAuthor({ name: 'Texz · Armed Detective Agency', iconURL: look.avatar ?? undefined })
    .setTitle(`${o.emoji ? `${o.emoji}  ` : ''}${o.title}`)
    .setDescription(`> *${say(o.kind, o.vars)}*${o.body ? `\n\n${o.body}` : ''}`.slice(0, 4096))
    .setFooter({ text: say('footer') })
    .setTimestamp(o.at ?? Date.now());
  for (const f of (o.fields ?? []).slice(0, 25)) {
    if (f.value) e.addFields({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: f.inline });
  }
  // a server's own pick wins, "off" hides it, otherwise the default for that moment
  const gif = o.gif === 'off' ? null : cached(o.gif ?? null) ?? (o.gif === undefined || o.gif === null ? cached(pickDefault(momentOf[o.kind] ?? '')) : null);
  if (gif) e.setImage(gif);
  return e;
}

export const say = (kind: Kind, vars: Record<string, string> = {}) =>
  pick(bank[kind]).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

export const embed = (title?: string) => {
  const e = new EmbedBuilder().setColor(COLOR).setFooter({ text: say('footer') });
  return title ? e.setTitle(title) : e;
};

// an embed that opens with a line in Texz's voice
export const agency = (title: string, kind: Kind, body: string) =>
  embed(title).setDescription(`*${say(kind)}*\n\n${body}`.slice(0, 4096));

// kept for older call sites
export const lines = {
  off: bank.off,
  wrongChannel: (where: string) => say('wrongChannel', { where }),
  noRole: bank.noRole,
  noPerm: bank.noPerm,
  error: bank.error,
};
