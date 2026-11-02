# texz

texz is a Discord bot I made to keep up with OwO without missing anything. It sits in the same server as OwO, reads my OwO commands and OwO's replies, and reminds me when things are ready. It never runs OwO commands for me, everything is still typed by hand, it just keeps track so I don't have to.

## What it does

It reminds me when my huntbot is back (with what to upgrade next and the exact restart command), when pray and curse are ready again, when I can vote again 12 hours after the last one, and when the OwO day resets. Two hours before the reset it sends a last call with whatever is still open that day, the checklist parts and any of the patreon minigames I've been doing (alastor, babyyoda, piku, run, puppy). If OwO asks me for a captcha it pings me right away, since ignoring one gets you banned from the bot.

It also reads a few OwO screens when I open them and turns them into advice:

- `owo hb` goes into `/huntbot`, which says which trait to put essence in next and how much
- `owo inv` goes into `/gems`, which groups my gems into same-tier sets so they run out together
- `owo team` and `owo weapon <id>` go into `/weapon` and `/team`, which work out how much damage a weapon does on each of my pets and flag a pet holding a weapon that uses its weaker stat

It reads a few more screens too. `owo zoo` feeds `/zoo`, which works out what to sacrifice or sell and how much essence or cowoncy that gives (the pets themselves always stay). Flipping through `owo weapon` feeds `/armoury`, one screen with pages, filters and sorting (`tz a`, `tz a held`, `tz a mythic`, `tz a junk`) that also picks the best damage weapon for each pet by its stronger stat and lists the weaker rare duplicates that are safe to dismantle, never touching anything equipped, empowered or epic and up. `owo quest`, `owo cl`, `owo daily`, `owo vote` and `owo cookie` tick off today's list on their own, and `owo cash` and `owo ws` show up in `/status`.

Some quests need other people, so there are quest buddies: `tz buddy join` to opt in, and `tz ask pray` pings the buddies in the server when you need a pray, curse, cookie or battle. `/leaderboard` ranks the week's hunters and battlers in the server.

`/status` shows the timers and today's list in one place, with buttons to jump to the huntbot, armoury, zoo, the week's hunt and battle counts, and reminders. `tz r 30 restart huntbot` sets a quick reminder of my own. `tz settings` opens a control panel where each reminder type is a button to switch on or off. Each one can go to DM or the channel on its own, channel reminders are a short ping instead of a card, and they can delete themselves after a while so the channel stays clean. `tz remind` shows everything queued, with a menu to cancel one and a button to add a new one. The hunt/battle one is off by default because every 15 seconds gets annoying.

## Anime and manga

`tz anime <title>` and `tz manga <title>` pull the full card from AniList (score, episodes or chapters, studio, genres, a spoiler-free blurb and the next episode countdown), with a menu for other matches if it picked the wrong one. `tz char <name>` looks up characters, `tz season` shows the season's most popular shows, `tz trending` what everyone is watching or reading, and `tz rec` throws a random popular pick at you. Pressing 🔔 on a show that's airing gets you an alert when each new episode comes out, `tz alerts` lists them.

AniList's api is free with no key, but it only allows 30 requests a minute right now, so Texz paces itself and keeps answers for half an hour.

## Utility

`tz av`, `tz user` and `tz server` for avatars and info, `tz poll question? | a | b` for a button vote, `tz choose`, `tz roll 2d6`, `tz coin`, `tz 8ball` and `tz afk`, which answers for you when someone pings you while you're away.

## Using it

Every command works as a slash command and with the short prefix, so `/status` and `tz status` do the same thing, and most have a shorter alias too (`tz hb`, `tz s`, `tz w <id>`). `tz help` lists everything switched on in the server.

Server admins (Manage Server) can switch each feature on or off and limit where it works with `/config`:

```
tz config view
tz config feature owo off
tz config channel owo add #bots
tz config role owo add @OwO players
tz config prefix d
tz config gif help https://media.tenor.com/.../dance.gif
```

Texz comes with default Dazai gifs for some moments, and the gif slots let a server swap them for moments like help, ping, level-ups, welcomes and bans. A Giphy link works straight away since the gif file can be worked out from the link itself, and Tenor share links still work by reading the public page (Tenor shut its API down in June 2026). `default` puts the built-in one back and `off` hides it.

Channel and role limits stack, and admins can always use everything so nobody locks themselves out.

## Setting it up

1. Make an application on the [Discord developer portal](https://discord.com/developers/applications), add a bot, and switch on the Message Content intent under Bot. texz needs it to read OwO's replies.
2. Invite it with the `bot` and `applications.commands` scopes and the View Channels, Send Messages, Read Message History and Embed Links permissions. It has to be in the server where you play OwO.
3. Copy `.env.example` to `.env` and fill in the bot token and the application ID. A server ID in `GUILD_ID` makes the slash commands show up straight away.
4. Then:

```
npm install
npm run build
npm run deploy
npm start
```

It needs Node 24 or newer. Everything is stored in one SQLite file (`texz.db`), using Node's built-in sqlite, so there's nothing else to install.

## Keeping it online

Reminders only work while texz is running, so it lives on a small free cloud server instead of my PC. Any always-on Linux box with Node works, run it with a process manager or a systemd service so it comes back after a restart.

## Tests

```
npm test
```

The tests use OwO messages copied from my own screens. OwO changes its layout now and then, so if something stops being picked up, the parsers in `src/owo/parse.ts` are the place to look.

## License

MIT
