# texz

texz is a Discord bot I made to keep up with OwO without missing anything. It sits in the same server as OwO, reads my OwO commands and OwO's replies, and reminds me when things are ready. It never runs OwO commands for me, everything is still typed by hand, it just keeps track so I don't have to.

## What it does

It reminds me when my huntbot is back (with what to upgrade next and the exact restart command), when pray and curse are ready again, when I can vote again 12 hours after the last one, and when the OwO day resets. Two hours before the reset it sends a last call with whatever is still open that day, the checklist parts and any of the patreon minigames I've been doing (alastor, babyyoda, piku, run, puppy). If OwO asks me for a captcha it pings me right away, since ignoring one gets you banned from the bot.

It also reads a few OwO screens when I open them and turns them into advice:

- `owo hb` goes into `/huntbot`, which says which trait to put essence in next and how much
- `owo inv` goes into `/gems`, which groups my gems into same-tier sets so they run out together
- `owo team` and `owo weapon <id>` go into `/weapon` and `/team`, which work out how much damage a weapon does on each of my pets and flag a pet holding a weapon that uses its weaker stat

`/status` shows the timers and today's list in one place, `/stats` counts my hunts and battles for the week, and `/remind` is for my own reminders. With `/settings` I pick DM or a ping in the channel, set quiet hours (reminders wait until they end), and switch each reminder type on or off. The hunt/battle one is off by default because every 15 seconds gets annoying.

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
