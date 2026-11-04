import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Client, type Guild, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Bulletins, Feed, Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';
import { report } from '../ops.js';
import { SITE, bigSession, flagOf, home, nextRound, questions, schedule, type Round } from '../feeds/f1.js';
import { interesting, leagues, matches, scoreLine, type Match } from '../feeds/football.js';
import { airingOn, searchMedia, titleOf, type Media } from '../anime/anilist.js';

type Kind = 'f1' | 'football' | 'anime';
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const unix = (ms: number) => Math.floor(ms / 1000);
const HOUR = 3_600_000;

// names in the Agency's voice
export const names: Record<Kind, { channel: string; role: string; emoji: string; topic: string; color: number }> = {
  f1: { channel: '🏎️┃paddock-gossip', role: 'Paddock Informant', emoji: '🏎️', topic: 'Grand Prix results, race day pings and paddock trivia, filed by Texz', color: 0xe10600 },
  football: { channel: '⚽┃pitch-side-reports', role: 'Pitch Informant', emoji: '⚽', topic: 'Big matches, your clubs, kick-off pings and full-time scores, filed by Texz', color: 0x2e9b4f },
  anime: { channel: '📺┃yokohama-screenings', role: 'Screening Informant', emoji: '📺', topic: 'New episodes as they air and the day\'s schedule, filed by Texz', color: 0x8e6cd8 },
};
const CATEGORY = '🕵️ Agency Bulletin Board';

const pingRow = (kind: Kind) => row(new ButtonBuilder().setCustomId(`bul|${kind}`).setLabel(`Ping me (${names[kind].role})`).setEmoji('🔔').setStyle(ButtonStyle.Secondary));

// makes the category, three channels and three roles, reusing any that already exist
export async function buildBoard(store: Store, guild: Guild): Promise<string> {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) return 'I need Manage Channels and Manage Roles to set the board up.';
  const g = store.guild(guild.id);
  const b = g.bulletins;
  let cat = b.category ? await guild.channels.fetch(b.category).catch(() => null) : null;
  cat ??= guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY) ?? null;
  cat ??= await guild.channels.create({ name: CATEGORY, type: ChannelType.GuildCategory, reason: 'bulletin board from /setup' });
  b.category = cat.id;
  for (const kind of ['f1', 'football', 'anime'] as const) {
    const feed = b[kind];
    const n = names[kind];
    let role = feed.role ? guild.roles.cache.get(feed.role) ?? null : null;
    role ??= guild.roles.cache.find((r) => r.name === n.role) ?? await guild.roles.create({ name: n.role, colors: { primaryColor: n.color }, mentionable: false, reason: 'bulletin pings from /setup' });
    feed.role = role.id;
    // saved id first, so renames and moves don't matter, then the name, then a fresh one
    let ch = feed.channel ? await guild.channels.fetch(feed.channel).catch(() => null) : null;
    ch ??= guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === n.channel) ?? null;
    const fresh = !ch;
    ch ??= await guild.channels.create({ name: n.channel, type: ChannelType.GuildText, parent: cat.id, topic: n.topic, reason: 'bulletin board from /setup' });
    // members read and react, only Texz posts, this is reapplied every time so old channels get it too
    if ('permissionOverwrites' in ch) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: true }).catch(() => {});
      await ch.permissionOverwrites.edit(me.id, { SendMessages: true, EmbedLinks: true, MentionEveryone: true, AddReactions: true }).catch(() => {});
    }
    if (fresh && ch.isSendable()) {
      await ch.send({
        embeds: [card({ kind: 'bulletin', title: `${n.emoji} ${n.channel.split('┃')[1].replace(/-/g, ' ')}`, emoji: '', gif: 'off', body: `${n.topic}.\nPress the button to get the **${n.role}** role and a ping when it matters. Press again to drop it.` })],
        components: [pingRow(kind)],
      }).then((m) => m.pin().catch(() => {})).catch(() => {});
    }
    feed.channel = ch.id;
  }
  // the character of the day belongs with the screenings
  g.daily.channel = b.anime.channel;
  store.saveGuild(guild.id, g);
  return `🕵️ The board is up under **${CATEGORY}**: <#${b.f1.channel}>, <#${b.football.channel}> and <#${b.anime.channel}>.`;
}

export async function onBulletinButton(i: Interaction, store: Store): Promise<boolean> {
  if (!i.isButton() || !i.customId.startsWith('bul|') || !i.guild) return false;
  const kind = i.customId.split('|')[1] as Kind;
  const roleId = store.guild(i.guild.id).bulletins[kind]?.role;
  const m = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!roleId || !m) { await i.reply({ content: 'That board isn\'t set up any more.', flags: MessageFlags.Ephemeral }); return true; }
  const has = m.roles.cache.has(roleId);
  const ok = await (has ? m.roles.remove(roleId) : m.roles.add(roleId)).then(() => true).catch(() => false);
  await i.reply({ content: ok ? (has ? `🔕 No more pings from <@&${roleId}>.` : `🔔 You're an informant now, <@&${roleId}> gets pinged when it matters.`) : 'I couldn\'t change that role, my role might sit below it.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  return true;
}

// ---------- posting ----------

async function post(client: Client, feed: Feed, content: { text?: string; embed: EmbedBuilder; ping?: boolean; buttons?: ButtonBuilder[] }) {
  if (!feed.channel) return;
  const ch = await client.channels.fetch(feed.channel).catch(() => null);
  if (!ch?.isSendable()) return;
  const ping = content.ping && feed.role ? `<@&${feed.role}>` : '';
  await ch.send({
    content: [ping, content.text].filter(Boolean).join(' ') || undefined,
    embeds: [content.embed],
    components: content.buttons?.length ? [row(...content.buttons)] : [],
    allowedMentions: { roles: ping && feed.role ? [feed.role] : [] },
  }).catch((e) => report('bulletin post', e));
}

const link = (url: string, label: string) => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
const sessionWord: Record<string, string> = { Q: 'Qualifying', SQ: 'Sprint qualifying', S: 'Sprint', R: 'Grand Prix' };

async function f1Tick(client: Client, store: Store, guilds: [string, Bulletins][]) {
  const live = guilds.filter(([, b]) => b.f1.on && b.f1.channel);
  if (!live.length) return;
  const { rounds } = await schedule();
  const now = Date.now();
  for (const r of rounds) {
    const flag = flagOf[r.circuit.country] ?? '🏁';
    const first = Math.min(...r.sessions.map((s) => Date.parse(s.start)));
    // race week heads-up, a day before the first session
    if (now > first - 24 * HOUR && now < first) {
      for (const [gid, b] of live) {
        if (!store.firstTime(gid, `f1:week:${r.round}`)) continue;
        const lines = r.sessions.map((s) => `${bigSession(s.type) ? '**' : ''}${s.label}${bigSession(s.type) ? '**' : ''} · <t:${unix(Date.parse(s.start))}:F>`);
        await post(client, b.f1, {
          embed: card({ kind: 'f1Week', title: `${flag} ${r.name} · round ${r.round}`, emoji: '', color: names.f1.color, gif: 'off', body: `${r.circuit.name}, ${r.circuit.locality}\n\n${lines.join('\n')}` }),
          buttons: [link(`${SITE}/schedule`, 'Full schedule')],
        });
      }
    }
    for (const s of r.sessions) {
      const start = Date.parse(s.start);
      const end = Date.parse(s.end);
      // an hour before the sessions that matter, with the ping
      if (bigSession(s.type) && now > start - HOUR && now < start) {
        for (const [gid, b] of live) {
          if (!store.firstTime(gid, `f1:pre:${r.round}:${s.type}`)) continue;
          await post(client, b.f1, {
            ping: true, text: `${sessionWord[s.type] ?? s.label} <t:${unix(start)}:R>`,
            embed: card({ kind: 'f1Soon', title: `${flag} ${r.name} · ${sessionWord[s.type] ?? s.label}`, emoji: '', color: names.f1.color, gif: 'off', body: `Lights out <t:${unix(start)}:t>, ${r.circuit.name}.` }),
          });
        }
      }
      // results once Parc Fermé has them, only for fresh sessions so a new board doesn't get flooded
      if (bigSession(s.type) && s.top3?.length && now > end && now - end < 2 * 24 * HOUR) {
        for (const [gid, b] of live) {
          if (!store.firstTime(gid, `f1:res:${r.round}:${s.type}`)) continue;
          const medal = ['🥇', '🥈', '🥉'];
          let body = s.top3.map((d, i) => `${medal[i]} **${d.driver}** · ${d.team}`).join('\n');
          if (s.type === 'R') {
            const h = await home().catch(() => null);
            if (h && h.lastRace.round === r.round) {
              const rest = h.lastRace.results.slice(3, 10).map((d) => `\`${d.pos.padStart(2)}\` ${d.driver} · ${d.team}`).join('\n');
              const champ = h.standings.slice(0, 3).map((d) => `${d.pos}. ${d.driver} **${d.points}**`).join(' · ');
              body += `${rest ? `\n${rest}` : ''}\n\n**Championship** · ${champ}`;
            }
          }
          const win = s.type === 'Q' || s.type === 'SQ' ? `${s.top3[0].driver} takes pole` : `${s.top3[0].driver} wins`;
          await post(client, b.f1, {
            ping: s.type === 'R', text: s.type === 'R' ? `${win}!` : undefined,
            embed: card({ kind: s.type === 'R' ? 'f1Win' : 'f1Result', title: `${flag} ${r.name} · ${sessionWord[s.type] ?? s.label}`, emoji: '', color: names.f1.color, gif: 'off', body }),
            buttons: [link(`${SITE}/races`, 'Full result on Parc Fermé')],
          });
        }
      }
    }
  }
  // one paddock fact a day, early evening in India
  const d = new Date();
  if (d.getUTCHours() === 12) {
    const qs = (await questions().catch(() => null))?.questions ?? [];
    const day = Math.floor(now / (24 * HOUR));
    const q = qs.length ? qs[day % qs.length] : null;
    if (q) {
      for (const [gid, b] of live) {
        if (!b.f1.facts || !store.firstTime(gid, `f1:fact:${day}`)) continue;
        await post(client, b.f1, {
          embed: card({ kind: 'f1Fact', title: q.q, emoji: '🗞️', color: names.f1.color, gif: 'off', body: `**${q.answer}**\n\n${q.body.slice(0, 700)}` }),
          buttons: [link(`${SITE}/questions`, 'More on Parc Fermé')],
        });
      }
    }
  }
}

const leagueOf = (m: Match) => leagues[m.league]?.name ?? m.league;

async function footballTick(client: Client, store: Store, guilds: [string, Bulletins][]) {
  const live = guilds.filter(([, b]) => b.football.on && b.football.channel);
  if (!live.length) return;
  const now = Date.now();
  const days = [new Date(now - 24 * HOUR), new Date(now)];
  const all: Match[] = [];
  for (const lg of Object.keys(leagues)) {
    for (const day of days) all.push(...await matches(lg, day).catch(() => []));
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const [gid, b] of live) {
    const mine = all.filter((m) => interesting(m, b.football.favs, b.football.big));
    // the morning list, around 9 in India
    if (new Date().getUTCHours() >= 3 && store.firstTime(gid, `fb:day:${today}`)) {
      const upcoming = mine.filter((m) => m.state === 'pre' && m.date - now < 24 * HOUR).sort((a, c) => a.date - c.date);
      if (upcoming.length) {
        await post(client, b.football, {
          embed: card({ kind: 'fbDay', title: 'Today\'s matches worth watching', emoji: '⚽', color: names.football.color, gif: 'off',
            body: upcoming.slice(0, 15).map((m) => `<t:${unix(m.date)}:t> **${m.home.name}** vs **${m.away.name}** · ${leagueOf(m)}`).join('\n') }),
        });
      }
    }
    for (const m of mine) {
      if (m.state === 'pre' && m.date - now < 30 * 60_000 && m.date > now && store.firstTime(gid, `fb:ko:${m.id}`)) {
        await post(client, b.football, {
          ping: true, text: `kick-off <t:${unix(m.date)}:R>`,
          embed: card({ kind: 'fbSoon', title: `${m.home.name} vs ${m.away.name}`, emoji: '⚽', color: names.football.color, gif: 'off', body: `${leagueOf(m)}${m.venue ? ` · ${m.venue}` : ''}` }),
        });
      }
      if (m.state === 'post' && now - m.date < 8 * HOUR && store.firstTime(gid, `fb:ft:${m.id}`)) {
        const scorers = m.goals.map((g) => `${g.clock} ${g.who} (${g.team === m.home.id ? m.home.short : m.away.short})`).join(' · ');
        await post(client, b.football, {
          embed: card({ kind: 'fbFull', title: `${m.home.name} ${m.home.score} - ${m.away.score} ${m.away.name}`, emoji: '🏁', color: names.football.color, gif: 'off',
            body: `${leagueOf(m)} · ${m.detail}${scorers ? `\n\n⚽ ${scorers}` : ''}` }),
        });
      }
    }
  }
}

async function animeTick(client: Client, store: Store, guilds: [string, Bulletins][]) {
  const live = guilds.filter(([, b]) => b.anime.on && b.anime.channel);
  if (!live.length) return;
  const now = Date.now();
  const from = unix(now - 20 * 60_000);
  const aired = await airingOn(from, unix(now)).catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  // the day's schedule, once, around 9 in India
  let schedule: { episode: number; airingAt: number; media: Media }[] | null = null;
  for (const [gid, b] of live) {
    const wanted = (m: Media) => b.anime.shows.some((s) => s.id === m.id) || (b.anime.popular && (m.popularity ?? 0) >= 60_000);
    if (new Date().getUTCHours() >= 3 && store.firstTime(gid, `an:day:${today}`)) {
      schedule ??= await airingOn(unix(now), unix(now) + 24 * 3600).catch(() => []);
      const list = schedule.filter((a) => wanted(a.media));
      if (list.length) {
        await post(client, b.anime, {
          embed: card({ kind: 'anDay', title: 'Screening schedule', emoji: '🗓️', color: names.anime.color, gif: 'off',
            body: list.slice(0, 20).map((a) => `<t:${a.airingAt}:t> **${titleOf(a.media)}** · ep ${a.episode}`).join('\n') }),
        });
      }
    }
    for (const a of aired) {
      if (!wanted(a.media) || !store.firstTime(gid, `an:ep:${a.media.id}:${a.episode}`)) continue;
      const e = card({ kind: 'anEp', title: `${titleOf(a.media)} · episode ${a.episode}`, emoji: '📺', color: names.anime.color, gif: 'off',
        body: `Out now${a.media.episodes ? `, ${a.episode} of ${a.media.episodes}` : ''}.` }).setURL(a.media.siteUrl);
      if (a.media.coverImage.large) e.setThumbnail(a.media.coverImage.large);
      const watch = (a.media.externalLinks ?? []).filter((l) => l.type === 'STREAMING' && !l.isDisabled && l.url.startsWith('https://')).slice(0, 3);
      await post(client, b.anime, { ping: true, embed: e, buttons: watch.map((l) => link(l.url, `Watch on ${l.site}`.slice(0, 80))) });
    }
  }
}

export function startBulletins(client: Client, store: Store) {
  const tick = async () => {
    const guilds = [...client.guilds.cache.keys()].filter((id) => store.rules(id, 'bulletins').enabled).map((id) => [id, store.guild(id).bulletins] as [string, Bulletins]);
    if (!guilds.length) return;
    await f1Tick(client, store, guilds).catch((e) => report('f1 feed', e));
    await footballTick(client, store, guilds).catch((e) => report('football feed', e));
    await animeTick(client, store, guilds).catch((e) => report('anime feed', e));
    store.forgetOldSent(Date.now() - 30 * 24 * HOUR);
  };
  setInterval(() => void tick(), 10 * 60_000);
  setTimeout(() => void tick(), 30_000);
}

// ---------- commands ----------

const f1: Command = {
  name: 'f1',
  data: new SlashCommandBuilder().setName('f1').setDescription('Grand Prix: the next race, standings and the last result')
    .addStringOption((o) => o.setName('view').setDescription('Next race if empty')
      .addChoices({ name: 'next race', value: 'next' }, { name: 'standings', value: 'standings' }, { name: 'last race', value: 'last' })).toJSON(),
  text: { aliases: ['gp'], args: ['view'] },
  run: async (ctx) => {
    const view = (ctx.str('view') ?? 'next').toLowerCase();
    const site = row(link(SITE, 'Parc Fermé'));
    try {
      if (view.startsWith('stand')) {
        const h = await home();
        const body = h.standings.slice(0, 10).map((d) => `\`${d.pos.padStart(2)}\` **${d.driver}** · ${d.team} · **${d.points}**${d.wins ? ` · ${d.wins}W` : ''}`).join('\n');
        const teams = h.teams.slice(0, 5).map((t) => `${t.pos}. ${t.team} **${t.points}**`).join(' · ');
        return ctx.reply({ embeds: [card({ kind: 'f1Result', title: `${h.season} standings · after round ${h.afterRound}`, emoji: '🏆', color: names.f1.color, gif: 'off', body, fields: [{ name: 'Teams', value: teams, inline: false }] })], components: [site] });
      }
      if (view.startsWith('last')) {
        const h = await home();
        const body = h.lastRace.results.slice(0, 10).map((d) => `\`${d.pos.padStart(2)}\` **${d.driver}** · ${d.team} · ${d.gap}`).join('\n');
        return ctx.reply({ embeds: [card({ kind: 'f1Win', title: `${h.lastRace.name} · ${h.lastRace.dateLabel}`, emoji: '🏁', color: names.f1.color, gif: 'off', body })], components: [site] });
      }
      const { rounds } = await schedule();
      const r: Round | null = nextRound(rounds);
      if (!r) return ctx.reply('The season is over. The paddock sleeps, and so do I.');
      const lines = r.sessions.map((s) => `${bigSession(s.type) ? '**' : ''}${s.label}${bigSession(s.type) ? '**' : ''} · <t:${unix(Date.parse(s.start))}:F> (<t:${unix(Date.parse(s.start))}:R>)`);
      return ctx.reply({ embeds: [card({ kind: 'f1Week', title: `${flagOf[r.circuit.country] ?? '🏁'} ${r.name} · round ${r.round}`, emoji: '', color: names.f1.color, gif: 'off', body: `${r.circuit.name}, ${r.circuit.locality}\n\n${lines.join('\n')}` })], components: [site] });
    } catch { return ctx.reply('Parc Fermé didn\'t answer, try again in a moment.'); }
  },
};

const football: Command = {
  name: 'football',
  data: new SlashCommandBuilder().setName('football').setDescription('Matches today and the server\'s favourite clubs')
    .addSubcommand((s) => s.setName('today').setDescription('Big matches and favourites today'))
    .addSubcommand((s) => s.setName('fav').setDescription('Add or remove a favourite club (admins)')
      .addStringOption((o) => o.setName('club').setDescription('Club name, like Real Madrid').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('favs').setDescription('The server\'s favourite clubs')).toJSON(),
  text: { aliases: ['fb', 'soccer'], sub: true, subArgs: { fav: ['club'] } },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Server only.');
    const g = store.guild(ctx.guildId);
    const sub = ctx.sub() ?? 'today';
    if (sub === 'fav') {
      if (!ctx.isAdmin) return ctx.reply('Only admins pick the server\'s clubs.');
      const club = ctx.str('club')?.trim();
      if (!club) return ctx.reply('Which club?');
      const favs = g.bulletins.football.favs;
      const at = favs.findIndex((f) => f.toLowerCase() === club.toLowerCase());
      if (at >= 0) favs.splice(at, 1); else favs.push(club);
      store.saveGuild(ctx.guildId, g);
      return ctx.reply({ content: at >= 0 ? `➖ ${club} is off the list.` : `⭐ ${club} added, every match gets a kick-off ping and the final score.`, temp: true });
    }
    if (sub === 'favs') return ctx.reply({ content: g.bulletins.football.favs.length ? `⭐ ${g.bulletins.football.favs.join(', ')}` : 'No favourites yet. `/football fav` adds one.', temp: true });
    const now = Date.now();
    const all: Match[] = [];
    for (const lg of Object.keys(leagues)) all.push(...await matches(lg, new Date(now)).catch(() => []));
    const mine = all.filter((m) => interesting(m, g.bulletins.football.favs, g.bulletins.football.big)).sort((a, c) => a.date - c.date);
    const body = mine.length
      ? mine.slice(0, 20).map((m) => m.state === 'pre' ? `<t:${unix(m.date)}:t> **${m.home.name}** vs **${m.away.name}** · ${leagueOf(m)}` : `${m.state === 'in' ? '🔴' : '🏁'} ${scoreLine(m)} · ${m.detail}`).join('\n')
      : 'Nothing big today. A rest day for everyone\'s nerves.';
    return ctx.reply({ embeds: [card({ kind: 'fbDay', title: 'Today on the pitch', emoji: '⚽', color: names.football.color, gif: 'off', body })] });
  },
};

const track: Command = {
  name: 'track',
  group: 'anime',
  data: new SlashCommandBuilder().setName('track').setDescription('Shows the server gets episode pings for (admins)')
    .addStringOption((o) => o.setName('title').setDescription('Add or remove this show, empty lists them').setMaxLength(100)).toJSON(),
  text: { aliases: ['tracked'], args: ['title'] },
  run: async (ctx, store) => {
    if (!ctx.guildId) return ctx.reply('Server only.');
    const g = store.guild(ctx.guildId);
    const shows = g.bulletins.anime.shows;
    const title = ctx.str('title');
    if (!title) return ctx.reply({ content: shows.length ? `📺 ${shows.map((s) => s.title).join(', ')}` : 'Nothing tracked yet, popular shows still get posted.', temp: true });
    if (!ctx.isAdmin) return ctx.reply('Only admins pick the server\'s shows.');
    const [m] = await searchMedia(title, 'ANIME').catch(() => []);
    if (!m) return ctx.reply(`Nothing called "${title}" on AniList.`);
    const at = shows.findIndex((s) => s.id === m.id);
    if (at >= 0) shows.splice(at, 1); else shows.push({ id: m.id, title: titleOf(m) });
    store.saveGuild(ctx.guildId, g);
    return ctx.reply({ content: at >= 0 ? `➖ ${titleOf(m)} won't get pings any more.` : `📺 ${titleOf(m)} gets a ping every new episode.`, temp: true });
  },
};

export const bulletins: Module = {
  name: 'bulletins',
  label: 'Bulletins',
  about: 'Grand Prix results and race day pings, big football matches and your clubs, new anime episodes, each in its own channel with a role to get pinged. Set up in /setup',
  commands: [f1, football, track],
};

