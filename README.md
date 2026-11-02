# texz

texz is a Discord bot I made to keep up with OwO without missing anything. It sits in the same server as OwO, reads my OwO commands and OwO's replies, and reminds me when things are ready. It never runs OwO commands for me, everything is still typed by hand, it just keeps track so I don't have to.

## What it does

It reminds me when my huntbot is back (with what to upgrade next and the exact restart command), when pray and curse are ready again, when I can vote again 12 hours after the last one, and when the OwO day resets. Two hours before the reset it sends a last call with whatever is still open that day, the checklist parts and any of the patreon minigames I've been doing (alastor, babyyoda, piku, run, puppy). If OwO asks me for a captcha it pings me right away, since ignoring one gets you banned from the bot.

It also reads a few OwO screens when I open them and turns them into advice:

- `owo hb` goes into `/huntbot`, which says which trait to put essence in next and how much
- `owo inv` goes into `/gems`, which groups my gems into same-tier sets so they run out together
- `owo team` and `owo weapon <id>` go into `/weapon` and `/team`, which work out how much damage a weapon does on each of my pets and flag a pet holding a weapon that uses its weaker stat

It reads a few more screens too. `owo zoo` feeds `/zoo`, which works out what to sacrifice or sell and how much essence or cowoncy that gives (the pets themselves always stay). Flipping through `owo weapon` feeds `/armoury`, which pages through the whole collection with filters and sorting (`tz a all`, `tz a held`, `tz a mythic`), picks the best damage weapon for each pet by its stronger stat and lists the weaker rare duplicates that are safe to dismantle, never touching anything equipped, empowered or epic and up. `owo quest`, `owo cl`, `owo daily`, `owo vote` and `owo cookie` tick off today's list on their own, and `owo cash` and `owo ws` show up in `/status`.

Some quests need other people, so there are quest buddies: `tz buddy join` to opt in, and `tz ask pray` pings the buddies in the server when you need a pray, curse, cookie or battle. `/leaderboard` ranks the week's hunters and battlers in the server.

`/status` shows the timers and today's list in one place, `/stats` counts my hunts and battles for the week, and `/remind` is for my own reminders. With `/settings` I pick DM or a ping in the channel, set quiet hours (reminders wait until they end), and switch each reminder type on or off. The hunt/battle one is off by default because every 15 seconds gets annoying.

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

The gif slots let a server pick its own gif for moments like help, ping, level-ups, welcomes and bans. It has to be a direct media link, since embeds can't play a Tenor or Giphy page.

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
