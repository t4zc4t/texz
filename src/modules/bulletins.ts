import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Client, type Guild, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Bulletins, Feed, Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { card } from '../theme.js';
import { report } from '../ops.js';
import { SITE, bigSession, facts, flagOf, home, nextRound, onThisDay, questions, schedule, siteLink, teamDot, type Round } from '../feeds/f1.js';
import { quizButton, quizRound } from './f1quiz.js';
import { clubDot, interesting, leagues, matches, scoreLine, type Match } from '../feeds/football.js';
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

// at most this many posts per channel an hour, and at most a few role pings, so a bad data day can't flood it
const sentLog = new Map<string, number[]>();
const lostLog = new Map<string, string>();
function allowed(channel: string, ping: boolean) {
  const now = Date.now();
  const recent = (sentLog.get(channel) ?? []).filter((t) => now - t < HOUR);
  const pings = (sentLog.get(`${channel}:ping`) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= 8 || (ping && pings.length >= 3)) return { post: recent.length < 8, ping: false };
  return { post: true, ping };
}
function remember(channel: string, ping: boolean) {
  sentLog.set(channel, [...(sentLog.get(channel) ?? []), Date.now()].slice(-20));
  if (ping) sentLog.set(`${channel}:ping`, [...(sentLog.get(`${channel}:ping`) ?? []), Date.now()].slice(-20));
}

async function post(client: Client, feed: Feed, content: { text?: string; embed: EmbedBuilder; ping?: boolean; buttons?: ButtonBuilder[]; react?: string[]; users?: string[]; fanRoles?: string[] }) {
  if (!feed.channel) return;
  const ok = allowed(feed.channel, !!content.ping);
  if (!ok.post) return;
  const ch = await client.channels.fetch(feed.channel).catch(() => null);
  if (!ch?.isSendable()) {
    // never falls back to another channel, it says so once a day and waits for /setup to repair it
    const day = new Date().toISOString().slice(0, 10);
    if (lostLog.get(feed.channel) !== day) { lostLog.set(feed.channel, day); report('bulletins', new Error(`channel ${feed.channel} is gone or I can't post there, press Set up the board in /setup to repair it`)); }
    return;
  }
  const ping = ok.ping && feed.role ? `<@&${feed.role}>` : '';
  // personal picks get their own mention, a handful at most
  const users = (content.users ?? []).slice(0, 15);
  remember(feed.channel, !!ping || users.length > 0);
  const fans = content.fanRoles ?? [];
  const fan = fans.map((r) => `<@&${r}>`).join(' ');
  const sent = await ch.send({
    content: [ping, fan, users.map((u) => `<@${u}>`).join(' '), content.text].filter(Boolean).join(' ') || undefined,
    embeds: [content.embed],
    components: content.buttons?.length ? [row(...content.buttons)] : [],
    allowedMentions: { roles: [...(ping && feed.role ? [feed.role] : []), ...fans], users },
  }).catch((e) => { report('bulletin post', e); return null; });
  // a reaction or two so people can follow along
  for (const r of content.react ?? []) await sent?.react(r).catch(() => {});
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
          let body = s.top3.map((d, i) => `${medal[i]} ${teamDot(d.team)} **${d.driver}** · ${d.team}`).join('\n');
          if (s.type === 'R') {
            const h = await home().catch(() => null);
            if (h && h.lastRace.round === r.round) {
              const rest = h.lastRace.results.slice(3, 10).map((d) => `\`${d.pos.padStart(2)}\` ${teamDot(d.team)} ${d.driver} · ${d.team}`).join('\n');
              const champ = h.standings.slice(0, 3).map((d) => `${d.pos}. ${d.driver} **${d.points}**`).join(' · ');
              body += `${rest ? `\n${rest}` : ''}\n\n**Championship** · ${champ}`;
            }
          }
          const win = s.type === 'Q' || s.type === 'SQ' ? `${s.top3[0].driver} takes pole` : `${s.top3[0].driver} wins`;
          await post(client, b.f1, {
            ping: s.type === 'R', text: s.type === 'R' ? `${win}!` : undefined, react: [flag, s.type === 'R' ? '🏆' : '⏱️'],
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
    // the site's questions mixed with a few worked out from the latest standings, so the evenings don't repeat as fast
    const h = await home().catch(() => null);
    const made: { q: string; answer: string; body: string }[] = [];
    if (h?.standings.length) {
      const [a, b2] = h.standings;
      const most = [...h.standings].sort((x, y) => y.wins - x.wins)[0];
      if (b2) made.push({ q: 'How big is the lead?', answer: `${a.driver} leads ${b2.driver} by ${a.points - b2.points} points.`, body: `After round ${h.afterRound}, ${a.driver} has ${a.points} points and ${a.wins} wins for ${a.team}.` });
      if (most) made.push({ q: 'Who wins the most this year?', answer: `${most.driver}, with ${most.wins} wins.`, body: `That's ${most.wins} of the ${h.afterRound} rounds so far.` });
      const climb = [...h.lastRace.results].filter((d) => d.grid > 0).sort((x, y) => (y.grid - Number(y.pos)) - (x.grid - Number(x.pos)))[0];
      if (climb && climb.grid - Number(climb.pos) > 3) made.push({ q: `Who climbed the most in ${h.lastRace.name}?`, answer: `${climb.driver}, from P${climb.grid} to P${climb.pos}.`, body: `${climb.grid - Number(climb.pos)} places gained in one afternoon for ${climb.team}.` });
    }
    const day = Math.floor(now / (24 * HOUR));
    // every other evening is one of the site's short trivia facts, the rest are questions
    const fs = (await facts().catch(() => null))?.facts ?? [];
    const pool = [...qs, ...made];
    let embed: ReturnType<typeof card> | null = null;
    let more = `${SITE}/questions`;
    if (fs.length && (day % 2 === 0 || !pool.length)) {
      const f = fs[Math.floor(day / 2) % fs.length];
      embed = card({ kind: 'f1Fact', title: 'Paddock trivia', emoji: '🗞️', color: names.f1.color, gif: 'off', body: f.text.slice(0, 900) });
      more = siteLink(f.link);
    } else if (pool.length) {
      const q = pool[day % pool.length];
      embed = card({ kind: 'f1Fact', title: q.q, emoji: '🗞️', color: names.f1.color, gif: 'off', body: `**${q.answer}**\n\n${q.body.slice(0, 700)}` });
    }
    if (embed) {
      for (const [gid, b] of live) {
        if (!b.f1.facts || !store.firstTime(gid, `f1:fact:${day}`)) continue;
        await post(client, b.f1, { embed, buttons: [link(more, 'More on Parc Fermé'), quizButton()] });
      }
    }
  }
  // on this day in F1, mid morning in India
  if (d.getUTCHours() === 5) {
    const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const list = (await onThisDay().catch(() => null))?.days[key] ?? [];
    if (list.length) {
      const picks = [...list].sort((a, b) => a.year - b.year).slice(-4);
      const body = picks.map((e) => `**${e.year}** · ${e.text}`).join('\n\n').slice(0, 1500);
      for (const [gid, b] of live) {
        if (!b.f1.facts || !store.firstTime(gid, `f1:otd:${key}:${d.getUTCFullYear()}`)) continue;
        await post(client, b.f1, {
          embed: card({ kind: 'f1Fact', title: `On this day in F1 · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`, emoji: '📅', color: names.f1.color, gif: 'off', body }),
          buttons: [link(siteLink(picks.at(-1)?.link), 'Read on Parc Fermé'), quizButton()],
        });
      }
    }
  }
}

// more than three people for the same club or show get a role of their own, so the post pings one role
async function fanPing(client: Client, store: Store, guildId: string, key: string, label: string, ids: string[]): Promise<{ users: string[]; role: string | null }> {
  if (ids.length <= 3) return { users: ids, role: null };
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { users: ids, role: null };
  const kvKey = `fanrole:${guildId}:${key}`;
  let role = store.getKv(kvKey) ? guild.roles.cache.get(store.getKv(kvKey)!) ?? null : null;
  if (!role) {
    const made = Number(store.getKv(`fanroles:${guildId}`) ?? 0);
    // a sensible cap, servers have a role limit
    if (made >= 25) return { users: ids, role: null };
    role = await guild.roles.create({ name: label.slice(0, 100), mentionable: false, reason: 'fans of the same club or show' }).catch(() => null);
    if (!role) return { users: ids, role: null };
    store.setKv(kvKey, role.id);
    store.setKv(`fanroles:${guildId}`, String(made + 1));
  }
  for (const id of ids) {
    const m = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    if (m && !m.roles.cache.has(role.id)) await m.roles.add(role, 'follows this').catch(() => {});
  }
  return { users: [], role: role.id };
}

// only people who are actually in that server, and haven't switched personal pings off
async function membersAmong(client: Client, guildId: string, ids: string[]) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild || !ids.length) return [];
  const found = await guild.members.fetch({ user: ids.slice(0, 50) }).catch(() => null);
  return found ? [...found.keys()] : [];
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
    // the server's clubs plus everyone's own picks
    const clubs = [...b.football.favs, ...store.allPicks().filter((p) => p.club && p.ping !== false).map((p) => p.club!)];
    const mine = all.filter((m) => interesting(m, clubs, b.football.big));
    // the morning list, around 9 in India
    if (new Date().getUTCHours() >= 3 && store.firstTime(gid, `fb:day:${today}`)) {
      const upcoming = mine.filter((m) => m.state === 'pre' && m.date - now < 24 * HOUR).sort((a, c) => a.date - c.date);
      if (upcoming.length) {
        await post(client, b.football, {
          embed: card({ kind: 'fbDay', title: 'Today\'s matches worth watching', emoji: '⚽', color: names.football.color, gif: 'off',
            body: upcoming.slice(0, 15).map((m) => `<t:${unix(m.date)}:t> ${clubDot(m.home)} **${m.home.name}** vs **${m.away.name}** ${clubDot(m.away)} · ${leagueOf(m)}`).join('\n') }),
        });
      }
    }
    for (const m of mine) {
      if (m.state === 'pre' && m.date - now < 30 * 60_000 && m.date > now && store.firstTime(gid, `fb:ko:${m.id}`)) {
        const norm = (x: string) => x.toLowerCase();
        const picks = store.allPicks().filter((p) => p.club && p.ping !== false && [m.home.name, m.away.name].some((n) => norm(n).includes(norm(p.club!))));
        // fans of each side get grouped by club
        const users: string[] = [];
        const fanRoles: string[] = [];
        for (const side of [m.home, m.away]) {
          const ids = await membersAmong(client, gid, picks.filter((p) => norm(side.name).includes(norm(p.club!))).map((p) => p.user));
          const f = await fanPing(client, store, gid, `club:${side.id}`, `${side.name} Informants`, ids);
          users.push(...f.users);
          if (f.role) fanRoles.push(f.role);
        }
        await post(client, b.football, {
          users, fanRoles,
          ping: true, text: `kick-off <t:${unix(m.date)}:R>`, react: [clubDot(m.home), clubDot(m.away), '⚽'].filter((x, i, a) => a.indexOf(x) === i),
          embed: card({ kind: 'fbSoon', title: `${m.home.name} vs ${m.away.name}`, emoji: '⚽', color: names.football.color, gif: 'off', body: `${leagueOf(m)}${m.venue ? ` · ${m.venue}` : ''}` }),
        });
      }
      if (m.state === 'post' && now - m.date < 8 * HOUR && store.firstTime(gid, `fb:ft:${m.id}`)) {
        const scorers = m.goals.map((g) => `${g.clock} ${g.who} (${g.team === m.home.id ? m.home.short : m.away.short})`).join(' · ');
        await post(client, b.football, {
          react: [m.home.winner ? '🏠' : m.away.winner ? '✈️' : '🤝'],
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
    const wanted = (m: Media) => b.anime.shows.some((s) => s.id === m.id) || (b.anime.popular && (m.popularity ?? 0) >= 60_000) || store.watchersOf(m.id).length > 0;
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
      const fans = await fanPing(client, store, gid, `show:${a.media.id}`, `${titleOf(a.media).slice(0, 80)} Watchers`, await membersAmong(client, gid, store.watchersOf(a.media.id)));
      await post(client, b.anime, { users: fans.users, fanRoles: fans.role ? [fans.role] : [], ping: true, react: ['📺', '🔥'], embed: e, buttons: watch.map((l) => link(l.url, `Watch on ${l.site}`.slice(0, 80))) });
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
      .addChoices({ name: 'next race', value: 'next' }, { name: 'standings', value: 'standings' }, { name: 'last race', value: 'last' },
        { name: 'quiz (win yen)', value: 'quiz' }, { name: 'trivia fact', value: 'trivia' }, { name: 'on this day', value: 'today' })).toJSON(),
  text: { aliases: ['gp'], args: ['view'] },
  run: async (ctx, store) => {
    const view = (ctx.str('view') ?? 'next').toLowerCase();
    const site = row(link(SITE, 'Parc Fermé'));
    try {
      if (view.startsWith('quiz')) {
        const r = await quizRound(ctx.channelId, !!ctx.guildId && store.rules(ctx.guildId, 'economy').enabled);
        if (r.busy) return ctx.reply({ content: 'A question is already running here, answer that one first.', temp: true });
        return ctx.reply({ embeds: r.embeds, components: r.components, public: true });
      }
      if (view.startsWith('triv') || view.startsWith('fact')) {
        const fs = (await facts()).facts;
        const f = fs[Math.floor(Math.random() * fs.length)];
        return ctx.reply({ embeds: [card({ kind: 'f1Fact', title: 'Paddock trivia', emoji: '🗞️', color: names.f1.color, gif: 'off', body: f.text })], components: [row(link(siteLink(f.link), 'More on Parc Fermé'), quizButton())] });
      }
      if (view.startsWith('today') || view.startsWith('otd')) {
        const d = new Date();
        const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const list = [...((await onThisDay()).days[key] ?? [])].sort((a, b) => a.year - b.year);
        if (!list.length) return ctx.reply('Nothing on file for today. A quiet day in the paddock, for once.');
        const body = list.slice(-6).map((e) => `**${e.year}** · ${e.text}`).join('\n\n').slice(0, 3500);
        return ctx.reply({ embeds: [card({ kind: 'f1Fact', title: `On this day in F1 · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`, emoji: '📅', color: names.f1.color, gif: 'off', body })], components: [row(link(siteLink(list.at(-1)?.link), 'Parc Fermé'), quizButton())] });
      }
      if (view.startsWith('stand')) {
        const h = await home();
        const body = h.standings.slice(0, 10).map((d) => `\`${d.pos.padStart(2)}\` ${teamDot(d.team)} **${d.driver}** · ${d.team} · **${d.points}**${d.wins ? ` · ${d.wins}W` : ''}`).join('\n');
        const teams = h.teams.slice(0, 5).map((t) => `${t.pos}. ${teamDot(t.team)} ${t.team} **${t.points}**`).join(' · ');
        return ctx.reply({ embeds: [card({ kind: 'f1Result', title: `${h.season} standings · after round ${h.afterRound}`, emoji: '🏆', color: names.f1.color, gif: 'off', body, fields: [{ name: 'Teams', value: teams, inline: false }] })], components: [site] });
      }
      if (view.startsWith('last')) {
        const h = await home();
        const body = h.lastRace.results.slice(0, 10).map((d) => `\`${d.pos.padStart(2)}\` ${teamDot(d.team)} **${d.driver}** · ${d.team} · ${d.gap}`).join('\n');
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
    const sub = ctx.sub() ?? 'today';
    // outside a server it still lists the big matches, just without anyone's favourites
    if (!ctx.guildId && sub !== 'today') return ctx.reply('Favourites belong to a server.');
    const g = store.guild(ctx.guildId ?? 'none');
    if (sub === 'fav') {
      if (!ctx.isAdmin) return ctx.reply('Only admins pick the server\'s clubs.');
      const club = ctx.str('club')?.trim();
      if (!club) return ctx.reply('Which club?');
      const favs = g.bulletins.football.favs;
      const at = favs.findIndex((f) => f.toLowerCase() === club.toLowerCase());
      if (at >= 0) favs.splice(at, 1); else favs.push(club);
      store.saveGuild(ctx.guildId!, g);
      return ctx.reply({ content: at >= 0 ? `➖ ${club} is off the list.` : `⭐ ${club} added, every match gets a kick-off ping and the final score.`, temp: true });
    }
    if (sub === 'favs') return ctx.reply({ content: g.bulletins.football.favs.length ? `⭐ ${g.bulletins.football.favs.join(', ')}` : 'No favourites yet. `/football fav` adds one.', temp: true });
    const now = Date.now();
    const all: Match[] = [];
    for (const lg of Object.keys(leagues)) all.push(...await matches(lg, new Date(now)).catch(() => []));
    const mine = all.filter((m) => interesting(m, g.bulletins.football.favs, g.bulletins.football.big)).sort((a, c) => a.date - c.date);
    const body = mine.length
      ? mine.slice(0, 20).map((m) => m.state === 'pre' ? `<t:${unix(m.date)}:t> ${clubDot(m.home)} **${m.home.name}** vs **${m.away.name}** ${clubDot(m.away)} · ${leagueOf(m)}` : `${m.state === 'in' ? '🔴' : '🏁'} ${scoreLine(m)} · ${m.detail}`).join('\n')
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

