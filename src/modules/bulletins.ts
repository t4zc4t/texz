import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type Client, type Guild, type Interaction, type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Bulletins, Feed, Store } from '../db.js';
import type { Command, Module } from '../core/module.js';
import { bar, card } from '../theme.js';
import { pickDefault } from '../gifs.js';
import { predict, predictTop, scoreMatch, scoreRace } from './predict.js';
import { animeThisDay, footballThisDay } from '../feeds/thisday.js';
import { picksOf } from './profile.js';
import { f1Card, fixturesCard, matchCard, standingsCard, weekCard } from '../features/matchcard.js';
import { report } from '../ops.js';
import { SITE, bigSession, facts, flagOf, home, nextRound, onThisDay, questions, schedule, siteLink, teamDot, type Round } from '../feeds/f1.js';
import { quizButton, quizRound } from './f1quiz.js';
import { clubDot, interesting, leagues, matches, scoreLine, type Match } from '../feeds/football.js';
import { airingOn, searchMedia, titleOf, type Media } from '../anime/anilist.js';
import { fixText } from '../core/fixes.js';

type Kind = 'f1' | 'football' | 'anime';
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
const unix = (ms: number) => Math.floor(ms / 1000);
const HOUR = 3_600_000;

// names in the Agency's voice
export const names: Record<Kind, { channel: string; role: string; emoji: string; topic: string; color: number }> = {
  f1: { channel: '🏎️┃paddock-gossip', role: 'Paddock Informant', emoji: '🏎️', topic: 'Grand Prix results, race day pings and paddock trivia, filed by Texz', color: 0xc8283c },
  football: { channel: '⚽┃pitch-side-reports', role: 'Pitch Informant', emoji: '⚽', topic: 'Big matches, your clubs, kick-off pings and full-time scores, filed by Texz', color: 0x2e9b4f },
  anime: { channel: '📺┃yokohama-screenings', role: 'Screening Informant', emoji: '📺', topic: 'New episodes as they air and the day\'s schedule, filed by Texz', color: 0x8e6cd8 },
};
export const CATEGORY = '🕵️ Agency Bulletin Board';

const pingRow = (kind: Kind) => row(new ButtonBuilder().setCustomId(`bul|${kind}`).setLabel(`Ping me (${names[kind].role})`).setEmoji('🔔').setStyle(ButtonStyle.Secondary));

// makes the category, three channels and three roles, reusing any that already exist
export async function buildBoard(store: Store, guild: Guild): Promise<string> {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) return fixText(guild, { perms: ['ManageChannels', 'ManageRoles'], doing: 'set the board up' }) ?? 'I need Manage Channels and Manage Roles to set the board up.';
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

async function post(client: Client, feed: Feed, content: { text?: string; embed: EmbedBuilder; ping?: boolean; buttons?: ButtonBuilder[]; react?: string[]; users?: string[]; fanRoles?: string[]; image?: Buffer | null }) {
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
    // a drawn card replaces the gif when there is one
    embeds: [content.image ? content.embed.setImage('attachment://card.png') : content.embed],
    files: content.image ? [{ attachment: content.image, name: 'card.png' }] : [],
    components: content.buttons?.length ? [row(...content.buttons)] : [],
    allowedMentions: { roles: [...(ping && feed.role ? [feed.role] : []), ...fans], users },
  }).catch((e) => { report('bulletin post', e); return null; });
  // a reaction or two so people can follow along
  for (const r of content.react ?? []) await sent?.react(r).catch(() => {});
  return sent;
}

// one drawing per match or session, shared by every server that posts it
const drawn = new Map<string, Promise<Buffer | null>>();
const drawOnce = (key: string, make: () => Promise<Buffer>) => {
  if (!drawn.has(key)) {
    if (drawn.size > 200) drawn.delete(drawn.keys().next().value!);
    drawn.set(key, make().catch((e) => { report('card drawing', e); return null; }));
  }
  return drawn.get(key)!;
};
const sideOf = (t: Match['home'], played: boolean) => ({ name: t.name, short: t.short, color: t.color, logo: t.logo, ...(played ? { score: t.score, winner: t.winner } : {}) });
const matchImage = (m: Match, played: boolean) => drawOnce(`${m.id}:${played ? 'ft' : 'ko'}`, () => matchCard({
  home: sideOf(m.home, played), away: sideOf(m.away, played), league: leagues[m.league]?.name ?? m.league,
  status: played ? (m.detail || 'Full time') : `Kick-off ${new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST`,
  venue: m.venue, goals: played ? m.goals.map((g) => ({ who: g.who, clock: g.clock, home: g.team === m.home.id })) : [],
}));

// an embed with a drawn picture as its image, or just the embed when drawing failed
const withImage = (e: EmbedBuilder, image: Buffer | null, rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []) => ({
  embeds: [image ? e.setImage('attachment://card.png') : e],
  files: image ? [new AttachmentBuilder(image, { name: 'card.png' })] : [],
  components: rows,
});
// which look a server picked for its F1 cards in /setup, Port Mafia unless it asked for the light one
export const f1Look = (store: Store, gid: string | null) => (gid ? store.getKv(`f1theme:${gid}`) : null) ?? 'mafia';
const weekImage = (r: Round, tz: string, look = 'mafia') => drawOnce(`f1week:${r.round}:${tz}:${look}:${Math.floor(Date.now() / 3600_000)}`, () => weekCard({
  title: r.name, subtitle: `Round ${r.round} · ${r.circuit.name} · times in ${tz === 'Asia/Kolkata' ? 'IST' : tz}`, tz,
  next: Date.parse(r.sessions.find((x) => Date.parse(x.start) > Date.now())?.start ?? '') || undefined,
  sessions: r.sessions.map((x) => ({ label: x.label, start: Date.parse(x.start), big: bigSession(x.type) })),
}, look));

const link = (url: string, label: string) => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
const sessionWord: Record<string, string> = { Q: 'Qualifying', SQ: 'Sprint qualifying', S: 'Sprint', R: 'Grand Prix' };
// a small mark for each kind of session so the week reads at a glance
const sessionMark = (t: string) => (t === 'R' ? '🏁' : t === 'Q' ? '⏱️' : t === 'SQ' ? '⏲️' : t === 'S' ? '⚡' : '🔧');
const weekLines = (r: Round, rel = false) => r.sessions.map((s) => {
  const at = unix(Date.parse(s.start));
  return `${sessionMark(s.type)} ${bigSession(s.type) ? `**${s.label}**` : s.label} · <t:${at}:F>${rel ? ` (<t:${at}:R>)` : ''}`;
});
// a server's own gif for a moment, or the default
const gifIn = (store: Store, gid: string, moment: string) => store.guild(gid).gifs[moment] ?? pickDefault(moment) ?? undefined;
// league marks, so a list of matches is easy to scan
const leagueMark: Record<string, string> = { 'eng.1': '🦁', 'esp.1': '🇪🇸', 'ita.1': '🇮🇹', 'ger.1': '🇩🇪', 'fra.1': '🇫🇷', 'uefa.champions': '⭐', 'uefa.europa': '🟠', 'fifa.world': '🌍', 'uefa.euro': '🇪🇺', 'ind.1': '🇮🇳', 'usa.1': '🇺🇸', 'mex.1': '🇲🇽', 'ned.1': '🇳🇱', 'por.1': '🇵🇹', 'sco.1': '🏴', 'tur.1': '🇹🇷', 'sau.1': '🇸🇦', 'bra.1': '🇧🇷', 'arg.1': '🇦🇷', 'uefa.europa.conf': '🟢', 'eng.fa': '🏆', 'eng.league_cup': '🏆', 'esp.copa_del_rey': '🏆', 'concacaf.champions': '🌎', 'conmebol.libertadores': '🌎', 'fifa.cwc': '🌍', 'uefa.nations': '🇪🇺', 'fifa.friendly': '🤝' };

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
        await post(client, b.f1, {
          react: [flag, '🏎️'], image: await weekImage(r, 'Asia/Kolkata', f1Look(store, gid)),
          embed: card({ kind: 'f1Week', title: `${flag} ${r.name} · it's race week`, emoji: '', color: names.f1.color, gif: 'off', body: `Round ${r.round} · ${r.circuit.name}, ${r.circuit.locality}${r.sprint ? ' · ⚡ sprint weekend' : ''}\n${weekLines(r).filter((_, i, a) => i >= a.length - 2).join('\n')}` }),
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
          const pre = await post(client, b.f1, {
            ping: true, text: `${sessionWord[s.type] ?? s.label} <t:${unix(start)}:R>`,
            react: ['🚦', flag],
            embed: card({ kind: 'f1Soon', title: `${sessionMark(s.type)} ${r.name} · ${sessionWord[s.type] ?? s.label}`, emoji: '', color: names.f1.color, gif: gifIn(store, gid, 'f1soon'), body: `🔴🔴🔴🔴🔴 Lights out <t:${unix(start)}:t>, ${r.circuit.name}.` }),
          });
          // race day gets a live chat thread, closed with the podium once it's over
          if (s.type === 'R' && pre) {
            const thread = await pre.startThread({ name: `🏁 ${r.name} live`.slice(0, 100), autoArchiveDuration: 1440 }).catch(() => null);
            if (thread) {
              store.setKv(`f1thread:${gid}:${r.round}`, thread.id);
              await thread.send(`Lights out <t:${unix(start)}:R>. Predictions close at the start, \`tz predict\` if you haven't called the podium yet.`).catch(() => {});
            }
          }
        }
      }
      // results once Parc Fermé has them, only for fresh sessions so a new board doesn't get flooded
      if (bigSession(s.type) && s.top3?.length && now > end && now - end < 2 * 24 * HOUR) {
        for (const [gid, b] of live) {
          if (!store.firstTime(gid, `f1:res:${r.round}:${s.type}`)) continue;
          const medal = ['🥇', '🥈', '🥉'];
          let body = s.top3.map((d, i) => `${medal[i]} ${teamDot(d.team)} **${d.driver}** · ${d.team}`).join('\n');
          let rows = s.top3.map((d, i) => ({ pos: String(i + 1), driver: d.driver, team: d.team }));
          if (s.type === 'R') {
            const h = await home().catch(() => null);
            if (h && h.lastRace.round === r.round) {
              rows = h.lastRace.results.slice(0, 10).map((d) => ({ pos: d.pos, driver: d.driver, team: d.team, extra: d.pos === '1' ? undefined : d.gap }));
              const champ = h.standings.slice(0, 3).map((d) => `${d.pos}. ${teamDot(d.team)} ${d.driver} **${d.points}**`).join(' · ');
              body += `\n\n**Championship** · ${champ}`;
            }
          }
          // podium calls get paid the moment the result is in
          if (s.type === 'R') {
            const called = scoreRace(store, gid, r.round, s.top3.map((d) => d.driver));
            if (called.length) body += `\n\n${called.join('\n')}`;
            // the race thread gets the podium and is locked
            const tid = store.getKv(`f1thread:${gid}:${r.round}`);
            const thread = tid ? await client.channels.fetch(tid).catch(() => null) : null;
            if (thread?.isThread()) {
              await thread.send(`🏁 **Chequered flag.** ${s.top3.map((d, n) => `${['🥇', '🥈', '🥉'][n]} ${d.driver}`).join(' · ')}\nThread's closed, thanks for watching.`).catch(() => {});
              await thread.setLocked(true).catch(() => {});
              await thread.setArchived(true).catch(() => {});
            }
          }
          const win = s.type === 'Q' || s.type === 'SQ' ? `${s.top3[0].driver} takes pole` : `${s.top3[0].driver} wins`;
          const look = f1Look(store, gid);
          const image = await drawOnce(`f1:${r.round}:${s.type}:${rows.length}:${look}`, () => f1Card({ title: r.name, subtitle: `${sessionWord[s.type] ?? s.label} · round ${r.round} · ${r.circuit.name}`, rows }, look));
          await post(client, b.f1, {
            ping: s.type === 'R', text: s.type === 'R' ? `${win}!` : undefined, react: [flag, s.type === 'R' ? '🏆' : '⏱️'], image,
            embed: card({ kind: s.type === 'R' ? 'f1Win' : 'f1Result', title: `${flag} ${r.name} · ${sessionWord[s.type] ?? s.label}`, emoji: '', color: names.f1.color, gif: image ? 'off' : gifIn(store, gid, s.type === 'R' ? 'f1win' : s.type === 'Q' || s.type === 'SQ' ? 'f1quali' : 'f1result'), body }),
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
  // on this day in F1, mid morning in India, or as soon as the bot is up after that
  if (d.getUTCHours() >= 5) {
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

const leagueOf = (m: Match) => `${leagueMark[m.league] ?? '⚽'} ${leagues[m.league]?.name ?? m.league}`;

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
        const image = await drawOnce(`fbmorning:${today}:${upcoming.map((m) => m.id).join(',')}`, () => fixturesCard('Today on the pitch', upcoming.slice(0, 12).map((m) => ({
          home: sideOf(m.home, false), away: sideOf(m.away, false), league: leagues[m.league]?.name ?? m.league, state: m.state, when: m.date, detail: m.detail,
        })), 'Asia/Kolkata'));
        await post(client, b.football, {
          image,
          embed: card({ kind: 'fbDay', title: 'Today\'s matches worth watching', emoji: '🏟️', color: names.football.color, gif: image ? 'off' : gifIn(store, gid, 'matchday'),
            body: image ? `${upcoming.length} match${upcoming.length === 1 ? '' : 'es'} today, first one <t:${unix(upcoming[0].date)}:R>` : upcoming.slice(0, 15).map((m) => `<t:${unix(m.date)}:t> ${clubDot(m.home)} **${m.home.name}** vs **${m.away.name}** ${clubDot(m.away)} · ${leagueOf(m)}`).join('\n') }),
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
          embed: card({ kind: 'fbSoon', title: `${clubDot(m.home)} ${m.home.name} vs ${m.away.name} ${clubDot(m.away)}`, emoji: '', color: names.football.color, gif: 'off', body: `${leagueOf(m)}${m.venue ? `\n🏟️ ${m.venue}` : ''}\n⏰ Kick-off <t:${unix(m.date)}:t>` }),
          image: await matchImage(m, false),
        });
      }
      if (m.state === 'post' && now - m.date < 8 * HOUR && store.firstTime(gid, `fb:ft:${m.id}`)) {
        const scorers = m.goals.map((g) => `${g.clock} ${g.who} (${g.team === m.home.id ? m.home.short : m.away.short})`).join(' · ');
        const called = scoreMatch(store, gid, m);
        await post(client, b.football, {
          react: [m.home.winner ? '🏠' : m.away.winner ? '✈️' : '🤝'],
          embed: card({ kind: 'fbFull', title: `${clubDot(m.home)} ${m.home.name} ${m.home.score} - ${m.away.score} ${m.away.name} ${clubDot(m.away)}`, emoji: '', color: names.football.color, gif: 'off',
            body: `${leagueOf(m)} · ${m.detail}\n${m.home.winner ? `🏆 **${m.home.name}** win` : m.away.winner ? `🏆 **${m.away.name}** win` : '🤝 Honours even'}${scorers ? `\n\n⚽ ${scorers}` : ''}${called.length ? `\n\n${called.join('\n')}` : ''}` }),
          image: await matchImage(m, true),
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
          embed: card({ kind: 'anDay', title: 'Today\'s screenings', emoji: '🍿', color: names.anime.color, gif: gifIn(store, gid, 'screening'),
            body: list.slice(0, 20).map((a) => `<t:${a.airingAt}:t> ${b.anime.shows.some((x) => x.id === a.media.id) ? '⭐' : '📺'} **${titleOf(a.media)}** · ep ${a.episode}${a.media.episodes && a.episode === a.media.episodes ? ' · 🎬 finale' : a.episode === 1 ? ' · 🆕 premiere' : ''}`).join('\n') }),
        });
      }
    }
    for (const a of aired) {
      if (!wanted(a.media) || !store.firstTime(gid, `an:ep:${a.media.id}:${a.episode}`)) continue;
      const last = !!a.media.episodes && a.episode === a.media.episodes;
      const e = card({ kind: 'anEp', title: `${titleOf(a.media)} · episode ${a.episode}`, emoji: last ? '🎬' : a.episode === 1 ? '🆕' : '📺', color: names.anime.color,
        // the show's own banner beats any gif, the gif only fills in when there isn't one
        gif: a.media.bannerImage ? 'off' : gifIn(store, gid, 'episode'),
        body: `${last ? '🎬 **The finale is out.**' : a.episode === 1 ? '🆕 **Premiere, a new show starts today.**' : '▶️ Out now'}${a.media.episodes ? `\n${bar(a.episode, a.media.episodes)} ${a.episode}/${a.media.episodes}` : ''}` }).setURL(a.media.siteUrl);
      if (a.media.coverImage.large) e.setThumbnail(a.media.coverImage.large);
      if (a.media.bannerImage) e.setImage(a.media.bannerImage);
      const watch = (a.media.externalLinks ?? []).filter((l) => l.type === 'STREAMING' && !l.isDisabled && l.url.startsWith('https://')).slice(0, 3);
      const fans = await fanPing(client, store, gid, `show:${a.media.id}`, `${titleOf(a.media).slice(0, 80)} Watchers`, await membersAmong(client, gid, store.watchersOf(a.media.id)));
      await post(client, b.anime, { users: fans.users, fanRoles: fans.role ? [fans.role] : [], ping: true, react: last ? ['🎬', '😭'] : ['📺', '🔥'], embed: e, buttons: watch.map((l) => link(l.url, `Watch on ${l.site}`.slice(0, 80))) });
    }
  }
}

// football and anime history for the day, mid morning in India like the F1 one
const dayLabel = (d = new Date()) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export async function footballHistory() {
  const { events, born } = await footballThisDay();
  const fields = [
    events.length ? { name: '📜 It happened today', value: events.slice(0, 4).map((e) => `**${e.year}** · ${e.text}`).join('\n').slice(0, 1024), inline: false } : null,
    born.length ? { name: '🎂 Born today', value: born.slice(0, 6).map((e) => `**${e.year}** · ${e.text.split(',')[0]}${e.text.includes(',') ? ` · ${e.text.split(',').slice(1).join(',').trim()}` : ''}`).join('\n').slice(0, 1024), inline: false } : null,
  ].filter((f): f is { name: string; value: string; inline: boolean } => !!f);
  if (!fields.length) return null;
  return card({ kind: 'fbDay', title: `On this day in football · ${dayLabel()}`, emoji: '📅', color: names.football.color, gif: 'off', line: '', body: '', fields });
}

export async function animeHistory() {
  const { premieres, birthdays } = await animeThisDay();
  const year = new Date().getUTCFullYear();
  const fields = [
    premieres.length ? { name: '🎬 First aired today', value: premieres.slice(0, 5).map((p) => `**[${p.title}](${p.url})** · ${p.year}, ${year - p.year} year${year - p.year === 1 ? '' : 's'} ago`).join('\n').slice(0, 1024), inline: false } : null,
    birthdays.length ? { name: '🎂 Character birthdays', value: birthdays.slice(0, 6).map((c) => `**[${c.name}](${c.url})**${c.from ? ` · ${c.from}` : ''}`).join('\n').slice(0, 1024), inline: false } : null,
  ].filter((f): f is { name: string; value: string; inline: boolean } => !!f);
  if (!fields.length) return null;
  const e = card({ kind: 'anDay', title: `On this day in anime · ${dayLabel()}`, emoji: '📅', color: names.anime.color, gif: 'off', line: '', body: '', fields });
  const face = birthdays[0]?.image ?? premieres[0]?.cover;
  if (face) e.setThumbnail(face);
  return e;
}

// Sunday evening: what the server watched this week
export function animeRecap(store: Store, guild: Guild) {
  const rows = store.listActivity(Date.now() - 7 * 24 * HOUR).filter((r) => r.kind === 'ANIME' && guild.members.cache.has(r.user_id));
  if (!rows.length) return null;
  const count = <T,>(list: T[]) => [...list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1]);
  const shows = count(rows.map((r) => r.title));
  const finished = rows.filter((r) => r.status === 'completed');
  const people = count(rows.map((r) => r.user_id));
  const e = card({ kind: 'anDay', title: 'This week in anime', emoji: '📺', color: names.anime.color, gif: 'off', line: '', body: '',
    fields: [
      { name: '🔥 Most watched', value: shows.slice(0, 5).map(([t, n], i) => `${i + 1}. **${t}** · ${n} ${n === 1 ? 'person' : 'people'}`).join('\n'), inline: false },
      { name: '🎬 Finished this week', value: finished.length ? finished.slice(0, 6).map((r) => `<@${r.user_id}> · ${r.title}`).join('\n') : 'Nobody wrapped a show up this week.', inline: false },
      { name: '🏆 Busiest watcher', value: `<@${people[0][0]}> with ${people[0][1]} list update${people[0][1] === 1 ? '' : 's'}`, inline: false },
    ] });
  return e;
}

export const recap: Command = {
  name: 'recap',
  group: 'anime',
  hidden: true,
  data: new SlashCommandBuilder().setName('recap').setDescription('What the server watched this week').toJSON(),
  text: { aliases: ['week'] },
  run: (ctx, store) => {
    if (!ctx.guild) return ctx.reply('The recap is per server.');
    const e = animeRecap(store, ctx.guild);
    return ctx.reply(e ? { embeds: [e] } : 'Nobody touched their list this week. Quiet week in Yokohama.');
  },
};

async function historyTick(client: Client, store: Store, guilds: [string, Bulletins][]) {
  const d = new Date();
  if (d.getUTCHours() < 5) return;
  const key = d.toISOString().slice(0, 10);
  const fb = guilds.filter(([gid, b]) => b.football.on && b.football.channel && store.firstTime(gid, `fb:otd:${key}`));
  if (fb.length) {
    const e = await footballHistory().catch(() => null);
    if (e) for (const [, b] of fb) await post(client, b.football, { embed: e, react: ['⚽'] });
  }
  // Sunday, mid evening in India
  if (d.getUTCDay() === 0 && d.getUTCHours() >= 13) {
    for (const [gid, b] of guilds.filter(([g, x]) => x.anime.on && x.anime.channel && store.firstTime(g, `an:recap:${key}`))) {
      const guild = client.guilds.cache.get(gid);
      const e = guild ? animeRecap(store, guild) : null;
      if (e) await post(client, b.anime, { embed: e, react: ['📺'] });
    }
  }
  const an = guilds.filter(([gid, b]) => b.anime.on && b.anime.channel && store.firstTime(gid, `an:otd:${key}`));
  if (an.length) {
    const e = await animeHistory().catch(() => null);
    if (e) for (const [, b] of an) await post(client, b.anime, { embed: e, react: ['🎂', '📺'] });
  }
}

export function startBulletins(client: Client, store: Store) {
  const tick = async () => {
    const guilds = [...client.guilds.cache.keys()].filter((id) => store.rules(id, 'bulletins').enabled).map((id) => [id, store.guild(id).bulletins] as [string, Bulletins]);
    if (!guilds.length) return;
    await f1Tick(client, store, guilds).catch((e) => report('f1 feed', e));
    await footballTick(client, store, guilds).catch((e) => report('football feed', e));
    await animeTick(client, store, guilds).catch((e) => report('anime feed', e));
    await historyTick(client, store, guilds).catch((e) => report('history feed', e));
    store.forgetOldSent(Date.now() - 30 * 24 * HOUR);
  };
  setInterval(() => void tick(), 10 * 60_000);
  setTimeout(() => void tick(), 30_000);
  // goals for people's own clubs are checked every two minutes while those clubs are playing
  setInterval(() => void goalTick(client, store).catch((e) => report('goal pings', e)), 2 * 60_000);
}

const norm = (x: string) => x.toLowerCase();
async function goalTick(client: Client, store: Store) {
  const picks = store.allPicks().filter((p) => p.club && p.ping !== false);
  if (!picks.length) return;
  const clubs = [...new Set(picks.map((p) => norm(p.club!)))];
  const hit = (name: string) => clubs.some((c) => norm(name).includes(c));
  for (const l of Object.keys(leagues)) {
    // the cached list says who is live, then only those leagues get a fresh look
    const cached = await matches(l, new Date()).catch(() => [] as Match[]);
    if (!cached.some((m) => m.state === 'in' && (hit(m.home.name) || hit(m.away.name)))) continue;
    const fresh = await matches(l, new Date(), 60_000).catch(() => [] as Match[]);
    for (const m of fresh.filter((x) => (x.state === 'in' || x.state === 'post') && (hit(x.home.name) || hit(x.away.name)))) {
      const seen = Number(store.getKv(`goals:${m.id}`) ?? -1);
      store.setKv(`goals:${m.id}`, String(m.goals.length));
      // the first look at a match only notes the count, so joining mid game doesn't replay old goals
      if (seen < 0 || m.goals.length <= seen) continue;
      for (const g of m.goals.slice(seen)) {
        const side = g.team === m.home.id ? m.home : m.away;
        const fans = picks.filter((p) => norm(side.name).includes(norm(p.club!)));
        if (!fans.length) continue;
        for (const guild of client.guilds.cache.values()) {
          const b = store.guild(guild.id).bulletins.football;
          if (!b.on || !b.channel || !store.rules(guild.id, 'bulletins').enabled) continue;
          const here = fans.filter((f) => guild.members.cache.has(f.user)).map((f) => f.user);
          if (!here.length) continue;
          const ch = client.channels.cache.get(b.channel);
          if (!ch?.isSendable()) continue;
          await ch.send({
            content: `⚽ **GOAL ${side.name}!** ${g.who} ${g.clock}\n${clubDot(m.home)} ${m.home.name} **${m.home.score} - ${m.away.score}** ${m.away.name} ${clubDot(m.away)}\n${here.map((u) => `<@${u}>`).join(' ')}`,
            allowedMentions: { users: here },
          }).catch(() => {});
        }
      }
    }
  }
}

// ---------- commands ----------

const f1: Command = {
  name: 'f1',
  group: 'sports',
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
        const [a, b] = h.standings;
        const look = f1Look(store, ctx.guildId);
        const image = await drawOnce(`f1stand:${h.season}:${h.afterRound}:${look}`, () => standingsCard({ title: `${h.season} Championship`, subtitle: `After round ${h.afterRound}`, drivers: h.standings, teams: h.teams }, look));
        const e = card({ kind: 'f1Result', title: `${h.season} standings`, emoji: '🏆', color: names.f1.color, gif: 'off', line: '',
          body: a && b ? `${teamDot(a.team)} **${a.driver}** leads by **${a.points - b.points}** after round ${h.afterRound}` : `After round ${h.afterRound}` });
        return ctx.reply(withImage(e, image, [site]));
      }
      if (view.startsWith('last')) {
        const h = await home();
        const rows = h.lastRace.results.slice(0, 10).map((d) => ({ pos: d.pos, driver: d.driver, team: d.team, extra: d.pos === '1' ? undefined : d.gap }));
        const look = f1Look(store, ctx.guildId);
        const image = await drawOnce(`f1last:${h.lastRace.round}:${look}`, () => f1Card({ title: h.lastRace.name, subtitle: `Race result · ${h.lastRace.dateLabel}`, rows }, look));
        const e = card({ kind: 'f1Win', title: `${h.lastRace.name}`, emoji: '🏁', color: names.f1.color, gif: 'off', line: '', body: `${rows[0] ? `${teamDot(rows[0].team)} ` : ''}**${rows[0]?.driver}** won for ${rows[0]?.team} · ${h.lastRace.dateLabel}` });
        return ctx.reply(withImage(e, image, [site]));
      }
      const { rounds } = await schedule();
      const r: Round | null = nextRound(rounds);
      if (!r) return ctx.reply('The season is over. The paddock sleeps, and so do I.');
      const tz = store.settings(ctx.userId).timezone || 'Asia/Kolkata';
      const image = await weekImage(r, tz, f1Look(store, ctx.guildId));
      const next = r.sessions.find((x) => Date.parse(x.start) > Date.now());
      const e = card({ kind: 'f1Week', title: `${flagOf[r.circuit.country] ?? '🏁'} ${r.name}`, emoji: '', color: names.f1.color, gif: image ? 'off' : undefined, line: '',
        body: `Round ${r.round} · ${r.circuit.name}${r.sprint ? ' · ⚡ sprint weekend' : ''}${next ? `\n${sessionMark(next.type)} **${next.label}** <t:${unix(Date.parse(next.start))}:R>` : ''}` });
      return ctx.reply(withImage(e, image, [site]));
    } catch { return ctx.reply('Parc Fermé didn\'t answer, try again in a moment.'); }
  },
};

// the trivia side of /f1, also on the fun dashboard
const asView = (name: string, view: string, about: string, aliases: string[]): Command => ({
  name,
  group: 'games',
  data: new SlashCommandBuilder().setName(name).setDescription(about).toJSON(),
  text: { aliases },
  run: (ctx, store) => f1.run({ ...ctx, str: (n) => (n === 'view' ? view : ctx.str(n)) }, store),
});
export const f1Quiz = asView('quiz', 'quiz', 'F1 quiz, first right answer wins yen', ['f1quiz', 'fq']);
export const f1Trivia = asView('trivia', 'trivia', 'A random bit of F1 trivia', ['fact', 'f1fact']);
const f1Story = asView('f1otd', 'today', 'What happened in F1 on this day', []);
// history for today: F1 from Parc Fermé, football from Wikipedia, anime from AniList
export const f1Today: Command = {
  name: 'onthisday',
  group: 'games',
  data: new SlashCommandBuilder().setName('onthisday').setDescription('F1, football and anime history for today')
    .addStringOption((o) => o.setName('topic').setDescription('Which one').addChoices({ name: 'F1', value: 'f1' }, { name: 'football', value: 'football' }, { name: 'anime', value: 'anime' })).toJSON(),
  call: 'history',
  example: 'f1',
  text: { aliases: ['otd', 'history'], args: ['topic'] },
  run: async (ctx, store) => {
    const topic = (ctx.str('topic') ?? '').toLowerCase();
    if (topic.startsWith('f1')) return f1Story.run(ctx, store);
    const which = topic.startsWith('foot') || topic.startsWith('soc') ? 'football' : topic.startsWith('ani') ? 'anime' : null;
    const embeds = (await Promise.all([
      !which || which === 'football' ? footballHistory().catch(() => null) : null,
      !which || which === 'anime' ? animeHistory().catch(() => null) : null,
    ])).filter((e): e is EmbedBuilder => !!e);
    if (!embeds.length) return ctx.reply('Nothing on file for today, or the history books are closed for a minute. Try again soon.');
    const buttons = row(
      new ButtonBuilder().setCustomId(`nav|onthisday|owner=${ctx.userId},topic=f1`).setLabel('F1').setEmoji('🏎️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`nav|onthisday|owner=${ctx.userId},topic=football`).setLabel('Football').setEmoji('⚽').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`nav|onthisday|owner=${ctx.userId},topic=anime`).setLabel('Anime').setEmoji('📺').setStyle(ButtonStyle.Secondary),
    );
    return ctx.reply({ embeds, components: [buttons] });
  },
};

const football: Command = {
  name: 'football',
  group: 'sports',
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
    if (sub === 'favs') return ctx.reply({ content: g.bulletins.football.favs.length ? `⭐ ${g.bulletins.football.favs.join(', ')}` : 'No favourites yet. `/sports view:football` adds one.', temp: true });
    const now = Date.now();
    const all: Match[] = [];
    for (const lg of Object.keys(leagues)) all.push(...await matches(lg, new Date(now)).catch(() => []));
    // the server's clubs plus the asker's own club
    const own = picksOf(store, ctx.userId).club;
    const mine = all.filter((m) => interesting(m, [...g.bulletins.football.favs, ...(own ? [own] : [])], g.bulletins.football.big)).sort((a, c) => a.date - c.date);
    const favs = g.bulletins.football.favs;
    if (!mine.length) return ctx.reply({ embeds: [card({ kind: 'fbDay', title: 'Today on the pitch', emoji: '🏟️', color: names.football.color, gif: 'off', body: 'Nothing big today. A rest day for everyone\'s nerves.' })] });
    // live first, then what's still to come, then the finished ones
    const order = { in: 0, pre: 1, post: 2 } as const;
    const sorted = [...mine].sort((x, y) => order[x.state] - order[y.state] || x.date - y.date);
    const tz = store.settings(ctx.userId).timezone || 'Asia/Kolkata';
    const image = await drawOnce(`fbday:${sorted.map((m) => `${m.id}${m.state}${m.home.score}${m.away.score}`).join(',')}:${tz}`, () => fixturesCard('Today on the pitch', sorted.map((m) => ({
      home: sideOf(m.home, m.state !== 'pre'), away: sideOf(m.away, m.state !== 'pre'), league: leagues[m.league]?.name ?? m.league, state: m.state, when: m.date, detail: m.detail,
    })), tz));
    const live = sorted.filter((m) => m.state === 'in').length;
    const e = card({ kind: 'fbDay', title: 'Today on the pitch', emoji: '🏟️', color: names.football.color, gif: 'off', line: '',
      body: `${sorted.length} match${sorted.length === 1 ? '' : 'es'} worth watching${live ? ` · 🔴 ${live} live` : ''}${favs.length ? `\n⭐ Following ${favs.join(', ')}` : ''}` });
    return ctx.reply(withImage(e, image, [row(...['eng.1', 'esp.1', 'uefa.champions'].map((l) => link(`https://www.espn.com/soccer/scoreboard/_/league/${l}`, `${leagueMark[l]} ${leagues[l].name}`)))]));
  },
};

// moved into /setup → Bulletins, the typed form still works for admins
const track: Command = {
  name: 'track',
  hidden: true,
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
  commands: [f1, football, track, predict, predictTop, recap],
};

