# texz

texz is a Discord bot I made to keep up with OwO without missing anything. It sits in the same server as OwO, reads my OwO commands and OwO's replies, and reminds me when things are ready. It never runs OwO commands for me, everything is still typed by hand, it just keeps track so I don't have to.

## What it does

It reminds me when my huntbot is back (with what to upgrade next and the exact restart command), when pray and curse are ready again, when I can vote again 12 hours after the last one, and when the OwO day resets. Two hours before the reset it sends a last call with whatever is still open that day, the checklist parts and any of the patreon minigames I've been doing (alastor, babyyoda, piku, run, puppy). If OwO asks me for a captcha it pings me right away, since ignoring one gets you banned from the bot.

It also reads a few OwO screens when I open them and turns them into advice:

- `owo hb` goes into `tz hb`, which says which trait to put essence in next and how much
- `owo inv` goes into `tz gems`, which groups my gems into same-tier sets so they run out together
- `owo team` and `owo weapon <id>` go into `tz weapon` and `tz team`, which work out how much damage a weapon does on each of my pets and flag a pet holding a weapon that uses its weaker stat

It reads a few more screens too. `owo zoo` feeds `tz zoo`, which works out what to sacrifice or sell and how much essence or cowoncy that gives (the pets themselves always stay). Flipping through `owo weapon` feeds `tz a`, one screen with pages, filters and sorting (`tz a`, `tz a held`, `tz a mythic`, `tz a junk`) that also picks the best damage weapon for each pet by its stronger stat and lists the weaker rare duplicates that are safe to dismantle, never touching anything equipped, empowered or epic and up. `owo quest`, `owo cl`, `owo daily`, `owo vote` and `owo cookie` tick off today's list on their own, and `owo cash` and `owo ws` show up in `tz status`. Opening the weapon page of `owo shop` feeds `tz shop`, which goes through the day's stock against my armoury and marks what's a type I don't have yet and what beats my best copy, with the shard price and when the stock changes.

Some quests need other people, so there are quest buddies: `tz buddy join` to opt in, and `tz ask pray` pings the buddies in the server when you need a pray, curse, cookie or battle. `tz top` ranks the week's hunters and battlers in the server.

`tz status` shows the timers and today's list in one place, with buttons to jump to the huntbot, armoury, zoo, the week's hunt and battle counts, and reminders. `tz r 30 restart huntbot` sets a quick reminder of my own. `tz settings` opens a control panel where each reminder type is a button to switch on or off. Each one can go to DM or the channel on its own, channel reminders are a short ping instead of a card, and they can delete themselves after a while so the channel stays clean. `tz remind` shows everything queued, with a menu to cancel one and a button to add a new one. The hunt/battle one is off by default because every 15 seconds gets annoying.

## Anime and manga

`tz anime <title>` and `tz manga <title>` pull the full card from AniList (score, episodes or chapters, studio, genres, a spoiler-free blurb and the next episode countdown), with a menu for other matches if it picked the wrong one. `tz char <name>` looks up characters, `tz season` shows the season's most popular shows, `tz trending` what everyone is watching or reading, and `tz rec` throws a random popular pick at you. Pressing 🔔 on a show that's airing gets you an alert when each new episode comes out, `tz alerts` lists them.

Every card also has a 📋 menu to put the show on your own list as watching (or reading), planning, completed, paused or dropped. `tz wl` opens the list with a filter by status and pages, `tz wl completed` or `tz wl @someone` go straight there, and picking a show from it opens a small panel with +1 episode, an exact progress number, a status change or removing it. The last episode moves it to completed by itself. `tz wl add watching frieren` adds one without opening the card.

`tz airing` (or `tz airing tomorrow`) lists the episodes airing that day in your timezone, and cards link to sequels, prequels and the source, with buttons for the official places to watch or read.

AniList's api is free with no key, but it only allows 30 requests a minute right now, so Texz paces itself and keeps answers for half an hour.

## Utility

`tz av` shows someone's picture with buttons for their server picture, main picture and banner (animated ones stay animated), `tz user` opens a dossier with a few deductions from what Texz has seen (account age, join order, last seen, activity), `tz server` for the server, `tz poll question? | a | b` for a button vote, `tz choose`, `tz roll 2d6`, `tz coin`, `tz 8ball` and `tz afk`, which answers for you when someone pings you while you're away (with a made-up excuse if you don't give one).

## Moderation

`tz warn @someone reason`, `tz timeout @someone 10m reason` (Texz calls it No Longer Human), `tz unmute` (or `/mod timeout length:off`), `tz kick`, `tz ban` (`tz ban @someone 3d reason` makes it a temporary ban that lifts itself), `tz unban <id>`, `tz purge 20` or `tz purge 20 @someone`, `tz lock` / `tz lock off`, and `tz slow 10s`. Each one checks that whoever runs it has the permission and sits above the person, and the person gets a DM saying what happened. A log channel (joins, leaves, deleted and edited messages, bans and every action above) and the automod rules, each off by default (invite links, spam where six messages in five seconds gets a five minute timeout, and mass mentions), are set in `/setup`. Mods are never caught by automod. When a mod doesn't give a reason, Texz makes one up.

Every warn, timeout, kick, ban and unban is filed as a numbered case. `tz case 12` opens one, `tz case @someone` (or `tz warnings @someone`) shows their record, and `/mod case list` searches by person, by mod, by type or by words in the reason, with pages. `/mod case reason` fixes a reason after the fact and `/mod case delete` takes one off the record.

## Giveaways

`/giveaway start` posts a giveaway with an Enter button, ends it on time and draws the winners itself. It can be limited to people with a certain role, keep a role out, or ask for a minimum level, a number of messages in the server, an account or membership age, and it can give server boosters or a chosen role a few times the chance. Conditions are checked when someone enters and again at the draw. `tz gw start 1d 2 Nitro` is the quick version, and `/giveaway end`, `reroll`, `cancel` and `list` handle the rest.

## Birthdays

`tz bday set 14 feb` saves a birthday (no year). On the day, going by the person's own timezone from the Settings button on `tz remind`, Texz greets them in the birthday channel and gives them the birthday role for 24 hours. Both are picked in `/setup`, along with an optional greeting of your own. `tz bday` lists who's next in the server.

## Welcome and roles

Greetings, goodbyes and the autorole are set in `/setup`: pick the channels and the role from menus, write your own text with `{user}`, `{name}`, `{server}` and `{count}` or let Texz use its own lines, and press Preview to see it. `/rolepicker` posts up to five buttons that give or take a role when pressed.

## Levels

Levels are off until an admin switches them on in `/setup`. Every Agency rank comes with perks, more xp, a bigger daily and extra giveaway chances at the top, see `tz perks`. *Make or fix rank roles* in `/setup` puts the rank roles in order, highest on top, with the senior ones shown separately in the member list. Then one message a minute earns 15 to 25 xp, so chatting counts and spam doesn't. Levels come with Agency ranks, from Stray and Agency Visitor up through Junior Detective, Ability User and Strategist to Living Legend of Yokohama. `tz rank` draws your rank card as an image, with your avatar, rank, position and progress bar, `tz levels` the server's top ten, and `/setup` picks where level-ups get posted (or turns them off) and handles reward roles: one button makes a role for every Agency rank, another makes a single role with your own name, colour and level, an existing role can be used too, and any reward can be renamed or moved to another level from a menu.

The **Xp and boosts** page in `/setup` covers the rest: how much xp a message gives and how often it counts, channels and roles that earn nothing, a multiplier for certain roles (boosters, say) or channels, a standing weekend multiplier, and a timed boost event that can start now, in a few hours or at an exact `<t:unix>` time. Boosts multiply each other up to 10x and show on rank cards while they're live. Reward roles can stack or be swapped so only the highest stays, and the level-up line can be your own with `{user}`, `{level}`, `{rank}` and friends. Admins can also move xp by hand with `/levels xp give`, `/levels xp take`, `/levels xp level` and `/levels xp reset` (`tz xp give @user 500` works too).

## Server tools

- **Starboard:** messages that collect enough ⭐ (or any emoji you pick) get reposted in a starboard channel with a jump link, and the count keeps updating.
- **Tickets:** a panel with a button opens a private channel for the person and the staff role. Closing it saves a text transcript to a log channel.
- **Planned posts:** `/tools announce add when:18:30 repeat:daily message:...` posts once or on repeat. Times can be `in 2h`, `18:30`, `tomorrow 09:00` or a `<t:unix>` stamp.
- **Server stats:** `/tools stats` shows messages per day, the busiest channels and people, and joins against leaves.
- **Role pickers:** `/rolepicker` asks for the roles in a menu and posts either buttons (up to 5) or a dropdown (up to 25, or one-only).

Starboard, tickets and the character of the day are all set in `/setup`.

## Bulletins

`/setup` → Bulletins → **Set up the board** makes a category called *Agency Bulletin Board* with three channels and a role for each, with a pinned button to pick the role up:

- **🏎️ paddock gossip:** the race week schedule a day before, a ping an hour before qualifying, sprints and the race, the podium and championship after each one, and a bit of paddock trivia every evening. It all comes from [Parc Fermé](https://parc-ferme.pages.dev), so nothing here needs an API key. `tz f1`, `tz f1 standings` and `tz f1 last` work any time, results come as a drawn podium in team colours, and football kick-offs and full-time scores come as a card with both crests, VS or the score, and who scored. Mornings bring an "on this day" post, and `tz f1 quiz` runs a 419 question quiz where the first right answer wins yen (more for the hard ones). `tz f1 trivia` and `tz f1 today` show a fact or today in history.
- **⚽ pitch side reports:** the morning's list of matches worth watching, a ping 30 minutes before kick-off and the full-time score with scorers. Big games are the World Cup and Euros, two big clubs meeting, or a big club in Europe, plus every match of the server's favourite clubs (`/football fav Real Madrid`). Scores come from ESPN's public scoreboard.
- **📺 yokohama screenings:** the day's airing schedule in the morning and a ping when a new episode is out, with official watch links. Popular shows are posted on their own, and admins add any other show with `/anime track`.

Each feed can be switched off on its own, and so can the trivia, big matches and popular shows.

## Economy and games

Yen comes from `tz daily` (more for every day in a row, up to a week), a little for chatting, and from `tz guess`, which shows a picture from a popular anime with four names to choose from. The first right answer wins. `tz bal`, `tz give @someone 100` and `/eco top` cover the rest, and admins stock a role shop with `/eco shop add` that people buy from with `tz market buy <id>`.

`tz profile` draws a profile card with your rank, yen, birthday, finished anime and favourite show, plus a bio set with `tz profile bio ...`. `tz cotd` shows the character of the day, and `/setup` can post one every morning.

## Spawn pings

`tz spawns` is the spawn page. For Pokétwo, Texz names every spawn it has seen caught before and replies with a ready to paste `@Pokétwo#8236 c <name>`. It starts knowing nothing and learns from each catch, each hint it solves and names other helper bots give, so it gets better with every spawn. Only legendary, mythical and ultra beast spawns ping, for the people who opt in, and shiny catches get a shout. For Shoob, each tier has its own role and a drop only pings that tier. `tz poke p_k_ch_` works out a name by hand.

## OwO extras

The case file shows your battle streak and gems left. An alert goes out when a gem type drops to its last one, the last call before reset also says where the huntbot is and how many gems are left, and `tz hb` shows how far each trait moved over the last week.

## Using it

Everything sits in nine dashboards, so nobody has to remember a command: `/owo`, `/anime`, `/fun` (games and trivia), `/eco` (yen), `/levels`, `/info` (you, your pings and the server), `/sports` (F1 and football), `/mod` and `/tools` (giveaways, role pickers, announcements). Typed works the same, `tz fun` or `tz owo` on their own. Buttons open the quick things, a menu lists the rest, and anything that needs a name, a number or a person opens a small form instead of asking you to type arguments. `/help` (or just `tz`) lists the dashboards, and `/ping`, `/setup` and the Quote message command stay on their own.

If you do like typing, the typed form follows the slash one: `/owo view:huntbot` is `tz owo huntbot`, and `/fun view:ship input:@someone` is `tz ship @someone`. Most have short names too (`tz hb`, `tz s`, `tz w <id>`). Each command has a short cooldown per person, a few seconds, a bit longer for the ones that draw cards or call other sites.

`tz pings` (also on `/info`) is one panel for every ping Texz can send you: the F1, football and anime boards, Pokétwo and Shoob spawns, OwO quest buddies, and mentions for your own club, team and show. When more than three people share a pick they get a role of their own, so one ping covers everyone.

Server admins (Manage Server) run `/setup` (or `tz setup`) to get the front desk, a panel where everything is done with menus and buttons: each feature on or off and limited to certain channels or roles, welcome and goodbye, the autorole, logs and automod, levels, xp and reward roles, birthdays, gifs and the prefix.

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

It needs Node 24 or newer. Everything is stored in one SQLite file (`texz.db`), using Node's built-in sqlite. Rank cards are drawn with `@napi-rs/canvas`, which comes as a ready-made build for Windows, macOS and Linux, and the fonts ship in `assets/fonts` (Inter and Cinzel, both under the SIL Open Font License).

## Keeping it online

Reminders only work while texz is running, so it runs on a PC that stays on. On Windows, double-click `tray/texz-tray.vbs` once. A dot appears next to the clock (green online, orange starting or stuck, grey off) with a menu to turn the bot on or off, restart it, rebuild after local changes, start with Windows, and update itself from GitHub once a day. If an update crashes in its first minute it rolls back to the last working version. Everything the bot prints goes to `texz.log`. Any always-on Linux box with Node works too, with a process manager or a systemd service.

## Looking after it

A copy of the database is saved every day in `backups/`, keeping the last week. Whoever owns the bot can pick a channel in `/setup` → Logs where Texz reports its own errors, so problems show up without opening the terminal.

## Tests

```
npm test
```

The tests use OwO messages copied from my own screens. OwO changes its layout now and then, so if something stops being picked up, the parsers in `src/owo/parse.ts` are the place to look.

## License

MIT
