import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/module.js';
import { searchMedia } from '../anime/anilist.js';
import { card } from '../theme.js';
import { parseWhen } from './server.js';

// a watch party: a server event, a ping for everyone who has the show on their list, and a spoiler thread for after
export const watchparty: Command = {
  name: 'watchparty',
  group: 'anime',
  data: new SlashCommandBuilder().setName('watchparty').setDescription('Plan a watch party for a show, with an event and a spoiler thread')
    .addStringOption((o) => o.setName('show').setDescription('The anime').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('when').setDescription('in 2h, 21:00, tomorrow 20:30 or a <t:unix> stamp').setRequired(true)).toJSON(),
  text: { aliases: ['wp', 'party'], args: ['when', 'show'] },
  run: async (ctx, store) => {
    if (!ctx.guild) return ctx.reply('Watch parties live in servers.');
    let when = (ctx.str('when') ?? '').trim();
    let show = (ctx.str('show') ?? '').trim();
    // typed: "tz wp tomorrow 21:00 frieren" or "tz wp in 2h frieren", the time can be two words
    if (ctx.viaText && /^(tomorrow|in)$/i.test(when)) { const [next, ...rest] = show.split(/\s+/); when = `${when} ${next ?? ''}`; show = rest.join(' '); }
    const at = parseWhen(when, store.settings(ctx.userId).timezone || 'Asia/Kolkata');
    if (!at || at < Date.now()) return ctx.reply('I couldn\'t read that time. Try `in 2h`, `21:00` or `tomorrow 20:30`.');
    if (!show) return ctx.reply('Which show? `tz wp 21:00 frieren`');
    const media = (await searchMedia(show, 'ANIME').catch(() => []))[0];
    if (!media) return ctx.reply(`No anime called **${show}** on AniList.`);
    const title = media.title.english ?? media.title.romaji ?? show;
    const minutes = Math.min(180, Math.max(30, (media.duration ?? 24) * 2 + 10));
    const me = ctx.guild.members.me;
    // the event shows up in the server's event list with an RSVP button, if Texz may make one
    const event = me?.permissions.has(PermissionFlagsBits.ManageEvents)
      ? await ctx.guild.scheduledEvents.create({
        name: `🍿 ${title} watch party`.slice(0, 100), scheduledStartTime: at, scheduledEndTime: at + minutes * 60_000,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: `#${'name' in (ctx.guild.channels.cache.get(ctx.channelId) ?? {}) ? ctx.guild.channels.cache.get(ctx.channelId)!.name : 'here'}` },
        description: `Hosted by ${ctx.displayName}. ${media.siteUrl}`, image: media.bannerImage ?? media.coverImage?.large ?? undefined,
      }).catch(() => null)
      : null;
    const fans = store.watchersOf(media.id).filter((u) => u !== ctx.userId && ctx.guild!.members.cache.has(u)).slice(0, 20);
    const e = card({ kind: 'anDay', title: `🍿 ${title} watch party`, emoji: '', gif: 'off', line: '',
      body: `<t:${Math.floor(at / 1000)}:F> · <t:${Math.floor(at / 1000)}:R>\nHosted by <@${ctx.userId}>${event ? `\n[Join the event](${event.url})` : ''}\n-# talk spoilers in the thread under this message, not in the channel` }).setURL(media.siteUrl);
    if (media.coverImage?.large) e.setThumbnail(media.coverImage.large);
    await ctx.reply({ content: fans.length ? `${fans.map((u) => `<@${u}>`).join(' ')} it's on your list, come watch` : undefined, embeds: [e], ping: fans, public: true });
    // the spoiler thread hangs off the announcement
    const ch = ctx.guild.channels.cache.get(ctx.channelId);
    if (ch?.isTextBased() && 'messages' in ch) {
      const msg = (await ch.messages.fetch({ limit: 5 }).catch(() => null))?.find((m) => m.author.id === ctx.client.user?.id && m.embeds[0]?.title?.includes('watch party'));
      await msg?.startThread({ name: `💬 ${title} spoilers`.slice(0, 100), autoArchiveDuration: 1440 }).catch(() => {});
    }
  },
};
