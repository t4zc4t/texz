import { EmbedBuilder } from 'discord.js';

// sand coat and old bandages
export const COLOR = 0xc2a46e;
export const DARK = 0x3b3128;
export const RED = 0xb5523b;

export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// Texz talks like the Agency's laziest genius: teasing, theatrical, never actually mean.
// All lines are written for this bot, in the spirit of the character.
const bank = {
  footer: [
    'Armed Detective Agency · on a well deserved break',
    'Texz · bandages, crab, and the occasional good idea',
    'Kunikida says I should be working. I am, technically.',
    'Filed under: things I solved while lying down',
    'Agency case notes · do not show Kunikida',
  ],
  help: [
    'Ah, a client! Sit, sit. I solve OwO problems, server problems, and occasionally my own boredom.',
    'You want to know what I can do? Everything, obviously. But here is the polite version.',
    'Kunikida made me write a list of my duties. I lost it twice, so here is the third one.',
  ],
  ping: [
    'Awake. Barely. I was dreaming of a crab buffet.',
    'Present, unfortunately. I had a perfect nap going.',
    'Here! Don\'t tell Kunikida you found me this quickly, he\'ll expect it every time.',
    'Pong. You see? I can be reliable when nobody is watching.',
  ],
  status: [
    'Let me read your case file. Hmm, hmm, yes, I see everything.',
    'A detective always knows where his client stands. Here is where you stand.',
    'Your timers, your duties, your little OwO empire. Summarised, because I\'m kind.',
  ],
  huntbot: [
    'Your little robot is hunting while you rest. I approve of that philosophy entirely.',
    'I studied your huntbot. Honestly, the answer was obvious, but I\'ll explain anyway.',
    'Essence math. Kunikida would make a spreadsheet, I just know the answer.',
  ],
  gems: [
    'Gems are like plans: pair them properly and they all finish at the same moment.',
    'I sorted your gems. Matching sets, nothing wasted, very elegant if I say so myself.',
  ],
  zoo: [
    'A zoo full of spare animals. The ones you love stay, the extras become essence. Simple.',
    'I counted your animals. Twice. The second time was out of boredom.',
  ],
  armoury: [
    'An armoury! Let me see which of these are treasures and which are scrap.',
    'Weapons tell you a lot about a person. Yours say "hoarder", fondly.',
  ],
  team: [
    'Your team, inspected. A detective notices which weapon sits on the wrong hands.',
    'Three partners and their weapons. Partnerships matter, trust me, I\'ve had some terrible ones.',
  ],
  weapon: [
    'Let me run the numbers. A genius does it in his head, but I\'ll write them down for you.',
    'Which pet should hold this? I already know. Here\'s the proof, for the sceptics.',
  ],
  questsDone: [
    'All quests done. How diligent. You make me look bad, please stop.',
    'Finished everything? Then you\'ve earned a nap. I\'ve earned three.',
  ],
  quests: [
    'Your quest log. Some of these need friends, luckily you know a charming detective.',
    'Quests! Small mysteries, small rewards. Here\'s what\'s still open.',
  ],
  stats: [
    'Your week, in numbers. I counted every hunt while pretending to sleep.',
  ],
  leaderboard: [
    'The Agency\'s most dedicated hunters this week. I am not on it, by choice.',
    'Rankings! Someone has been working far too hard. Admirable. Exhausting to watch.',
  ],
  remindAdd: [
    'Noted. I\'ll remember so you don\'t have to, that\'s what partners are for.',
    'Leave it to me. I may nap, but I never forget a promise. Mostly.',
  ],
  remindCancel: ['Cancelled. Consider it forgotten, I\'m very good at forgetting things.'],
  buddyJoin: ['Welcome to the network. Informants are the backbone of any good detective agency.'],
  buddyLeave: ['Leaving the network? Fine. I\'ll pretend I didn\'t notice.'],
  ask: [
    'calling in a favour from the network.',
    'needs a small kindness. The Agency runs on these.',
  ],
  askCooldown: ['Patience. You asked recently, and pestering informants makes them disappear.'],
  settings: ['Your preferences, filed neatly. Kunikida would be proud of me for once.'],
  missing: [
    'I can\'t solve a case without evidence.',
    'No evidence yet, and I refuse to guess. Well, I could guess, but I\'d be right and you\'d learn nothing.',
  ],
  off: [
    'That door is locked here. Someone with the keys decided I deserve a holiday.',
    'Not in this server, I\'m afraid. They switched it off, and I\'m happily resting.',
  ],
  wrongChannel: [
    'Wrong room, partner. Try it in {where}, I\'ll be lying down there.',
    'I only take that case in {where}. Even I follow some rules.',
  ],
  noRole: [
    'That case is for a select few. Not you, not today.',
    'You need a certain role for that one. I don\'t make the rules, I just enjoy watching them.',
  ],
  noPerm: [
    'You\'d need Manage Server for that. Nice try though, very bold.',
    'Admin business. Fetch me an admin and some crab, in that order.',
  ],
  error: [
    'Something slipped. Even a genius trips on his own coat sometimes. Try again?',
    'That broke on my side. How embarrassing. Don\'t tell Chuuya, he\'ll never let it go.',
  ],
  // reminders, sent as DMs
  huntbotBack: [
    'Your huntbot is home, carrying gifts like a loyal little hound.',
    'Ding! The robot returns. Collect its haul before it gets ideas.',
  ],
  prayReady: [
    'Your prayers and curses are recharged. Use them wisely, or chaotically, I won\'t judge.',
    'Pray and curse are ready. Bless a friend, curse a rival, live a little.',
  ],
  voteReady: [
    'Voting is open again. Democracy, crab money, everyone wins.',
    'Twelve hours passed. Your vote awaits, and so does the cowoncy.',
  ],
  huntReady: ['Hunt and battle are ready. Off you go.'],
  newDay: [
    'A new OwO day! Fresh duties, fresh rewards. Kunikida would want you to start now.',
    'The clock reset. I\'ve already planned your day, it\'s on the list below.',
  ],
  lastCall: [
    'Two hours until the reset and these are still open. I\'d hurry, I wouldn\'t, but you should.',
    'Last call, partner. These slip away at the reset:',
  ],
  custom: ['You asked me to remind you, so here I am, as promised:'],
  captcha: [
    'Urgent! OwO wants proof you\'re human in {where}. Solve it now, ignoring it gets you banned from the bot.',
  ],
};

export type Kind = keyof typeof bank;

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
