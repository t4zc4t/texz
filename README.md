# texz

texz started as a bot to keep up with OwO without missing anything, and grew into the all in one bot for my server. It has a Dazai theme all the way through (Bungou Stray Dogs, the Armed Detective Agency), reminds and advises for OwO without ever playing it for you, and also does anime, F1 and football bulletins, Pokétwo and Shoob help, levels, yen, games, moderation and the usual server tools.

Everything is behind a few dashboards, so nobody has to remember commands. Type `tz` or run `/help` and go from there, or ask in plain words: `tz help money`, `tz help ping me`, `tz help birthday`. A typo like `tz rnak` gets a "did you mean `tz rank`" with a button that runs it.

## The dashboards

Ten dashboards, each a single slash command and the same word typed after `tz`. Each one is a short list of its commands, a few per page: the typed form, the slash form and what goes after it, with `?` on the parts you can leave out. `tz help hug` or `/help feature:hug` opens the page that has it, marked. Port Mafia HQ stays a real dashboard with buttons, since it's where admins change things, and so do `/setup` and the pings and reminders panel. Old names (`tz games`, `tz you`, `tz staff`, `tz mod`) still open the new ones.

| Dashboard | Command | What's in it |
|---|---|---|
| 🖤 Port Mafia HQ | `/admin` | moderation and the case files, giveaways, role pickers, planned posts, xp tools, server activity, backups and `/setup`. Only admins and the staff role see it |
| 🐾 Stray Dogs Den | `/owo` | huntbot, gems, zoo, weapons and armoury, quests, the shop, OwO timers and quest buddies |
| 🔴 Pokédex Bureau | `/poketwo` | claim help and the helper switch, hint solving, the server Pokédex and the weekly catch race |
| 🃏 Card Vault | `/shoob` | rare drop pings and your character wishlist |
| 📚 Literary Annex | `/anime` | what's on, anime, manga and character search, your list, alerts, watch parties |
| 🏁 Paddock & Pitch | `/sports` | the next Grand Prix, standings, last race, today's football and predictions |
| 🥃 Bar Lupin | `/fun` | hugs, pats, bonks and 27 more interactions with anime gifs, F1 quiz, crest quiz, guess the anime, trivia, on this day, make it a quote, ship, polls, confessions and dice |
| 🪪 Personnel File | `/profile` | your profile card and favourites, rank, medals, mission, birthday and every ping you get |
| 💴 Yen Ledger | `/yen` | daily, wallet, give, the rich list and the role shop |
| 🧰 Odds & Ends | `/misc` | user and server info, avatar, afk, one-off reminders and the bot ping |

`/setup` is the admin front desk (members never see admin commands in help or the dashboards), `/ping` checks the bot, and right clicking a message gives **Make it a Quote**. When something fails because of a missing permission or a role sitting above texz, the message says exactly which one and how to fix it.

Typed commands follow the slash ones: `/owo view:huntbot` is `tz owo huntbot` (or just `tz hb`), and `/fun view:ship input:@someone` is `tz ship @someone`. Some read as two words: `tz quiz crest`, `tz predict top`, `tz history`. Old names like `tz bal`, `tz perks` and `tz settings` still work. Each command has a short cooldown per person, a little longer for the ones that draw pictures or call other sites.

## OwO

texz reads your OwO commands and OwO's replies in channels it can see and keeps track for you.

- **Reminders** for huntbot, pray, curse, vote and the daily reset, with a last call two hours before reset listing whatever is still open, the patreon minigames included. A captcha gets you pinged straight away. Each reminder can go to DM or the channel, on or off, from `tz reminders`. `tz r 30 restart huntbot` sets one of your own.
- **Advice** from the screens you open: `owo hb` feeds `tz hb` (which trait to put essence in next), `owo inv` feeds `tz gems` (gem sets that run out together), `owo team` and `owo weapon` feed `tz weapon` and `tz team`, `owo zoo` feeds `tz zoo`, and flipping through weapons builds the armoury in `tz a` with the best weapon per pet and the duplicates that are safe to dismantle. `owo shop` feeds `tz shop`, which marks what's actually an upgrade.
- **Quest buddies:** `tz buddy join` opts in, and `tz ask pray` pings the buddies when a quest needs a pray, curse, cookie or battle.

`tz owo` puts all of it on one page.

## Anime

`tz anime <title>`, `tz manga <title>` and `tz char <name>` pull full cards from AniList, with official watch links, related shows and a 📋 menu to put it on your list. `tz wl` is your list with filters and quick +1 episode buttons. 🔔 on an airing show gets you a DM for every new episode. `tz anime` with no title opens what's on today, with the full schedule in your timezone, trending shows, the season and the weekly recap a click away, `tz guess` is a guess the anime game that pays yen, and there's a character of the day. `tz wp 21:00 frieren` plans a watch party with a server event, a ping for everyone who has the show on their list and a spoiler thread, and every Sunday the anime board posts what the server watched that week.

AniList allows 30 requests a minute right now, so texz paces itself and keeps answers for half an hour.

## Bulletins

`/setup` → Bulletins → **Set up the board** makes a category with three read only channels and a role for each. Setup can be run again any time, it only fills in what's missing, and renaming or moving the channels is fine.

- **🏎️ F1** from [Parc Fermé](https://parc-ferme.pages.dev): race week board, a ping an hour before qualifying, sprints and the race, results, standings and the race week schedule drawn in Parc Fermé's own look (Port Mafia dark, or Detective Agency light from `/setup` → Bulletins), an evening trivia fact and "on this day" every morning.
- **⚽ Football** from ESPN's public scoreboards: the morning's matches worth watching, a kick-off card with both crests and VS, and a full-time card with the score and scorers. Big games are the World Cup and Euros, two big clubs meeting, or a big club in Europe, plus every match of the server's favourite clubs and anyone's own club. Over 25 leagues and cups are covered, MLS included. "On this day" comes from Wikipedia.
- **📺 Anime** from AniList: the day's screenings, a ping when an episode is out (premieres and finales marked), and "on this day" with anniversaries and character birthdays.

`tz history` shows today's history for all three, `tz f1 quiz` and `tz quiz crest` run quizzes that pay yen, and `tz football` shows today's matches as one board. Race day opens a live chat thread that closes with the podium, and anyone with a club in their profile gets pinged the moment their club scores. F1 teams and football clubs show their real logo and crest as emoji wherever they're named.

`tz predict` lets people call the podium before each race and the result of the day's big matches. Right calls pay yen and show up under the result, and `tz predict top` is the season table.

## Pokétwo and Shoob

- **Claim help:** every Pokétwo spawn gets a reply with the name, its types and the catch line, as tap to copy text for phones and a copy box for PC. It reads the picture with an open 1,025 species classifier (it downloads itself on first start), and remembers every spawn that gets confirmed by a catch, a hint or another helper bot, so Pokétwo's own forms and variants come out right after the first one. A weak guess is shown as a maybe, a wrong one gets crossed out with the next best guess, and hints get solved too (`tz hint p_k_ch_` by hand). Types show as Pokémon HOME badges, and admins can switch the whole helper off per server from `tz spawns` or `/setup`.
- **Pings:** only for what matters. Legendary, mythical and ultra beast spawns (their card gets pinned until it's caught), any of the 18 types you pick for quests, and a shout for shiny catches.
- **Shoob:** one role for rare drops, so only tier 5 and 6 cards ping, the lower tiers stay quiet.

`tz spawns` is where people opt in, with a status box for each bot. `tz dex` is the server's Pokédex by generation with the most wanted legends, and spawns not caught here yet get a 🆕. `tz race` is the weekly catch race, the winner gets yen on Monday. For Shoob, `tz wish add Gojo` pings you when that character drops, whatever the tier.

## Pings

`tz pings` is one page for every ping and reminder texz can send you, your own reminders and OwO timers included: the bulletin roles, rare and type spawn pings, Shoob rare drops, your anime episode alerts, OwO quest buddies, and mentions for your own club, F1 team and show (set in `tz profile edit`). When more than three people share a pick they get a role of their own, so one ping covers everyone.

## Levels, yen and profiles

Levels are off until an admin turns them on. Ranks go from Stray up to Living Legend of Yokohama, and each one has perks: more xp, a bigger daily and extra giveaway chances (the Perks button on `tz rank`). Everyone keeps only their highest rank role, and each rank role carries the permissions of the ones below it. `/setup` makes the rank roles in order, picks where level-ups go, and handles xp rules, boosts and reward roles. `tz rank` draws a rank card.

Yen comes from `tz daily` (more for every day in a row), chatting a little, and the quizzes and guess game. `tz wallet` (your balance, daily and the richest), `tz give` and a role shop (on `/yen`) cover the rest. `tz mycolour buy #c8283c` buys a role nobody else has for ¥5,000, then the colour, a gradient, the name or an icon can change for ¥300 each. `tz profile` draws a profile card with your colour, your medals and a favourites strip: your F1 team's logo, your club's crest and your favourite anime and manga covers, each glowing in its own colour. Pick them in `tz profile edit`, the club from a list by league. Profiles, birthdays and wishlists belong to the server they were made in, so a file in one server says nothing in another.

## Community and the server layout

`/setup` → **Build the Agency** lays out the whole server in one click, with the right locks on every room:

- 🚪 **Agency Front Door**, at the very top: `🚪┃the-entrance-exam`, where newcomers press a button to get **Agency Member** and see the rest of the server (everyone already in gets it automatically, bots skip it), `📜┃agency-rules`, `🌸┃new-recruits` for welcomes once someone passes, `🎭┃pick-your-roles` with menus for the F1, football, rare spawn and rare drop pings, pronouns, region (Asia Branch, Europe Branch...), DMs (Line Open, Knock First, Line Closed) and ten name colours in the Agency's palette that sit above the rank roles so they show, and `💎┃agency-patrons` for booster thank-yous (off until switched on in `/setup` → Welcome). All read-only.
- 🕵️ **Agency Bulletin Board**: the F1, football and anime feeds, `🔮┃ranpos-deductions` (every morning the day's big matches with buttons to call them, and the podium on race week), `🎖️┃promotions` for rank ups, `🖋️┃ink-and-regret` for quotes and `⭐┃the-agency-files` for messages that get five stars. Read-only, people react. Legendary, mythical and ultra beast Pokétwo spawns and tier 6 Shoob drops get framed like a quote and filed in the Agency files too, caught or not. Anime episodes don't ping the server, everyone's own shows reach them in DMs.
- 🥃 **Bar Lupin**, where everyone hangs out: `💬┃agency-office` (the general chat) and `📸┃evidence-board` (pictures and memes), fully open; `🔴┃pokedex-bureau`, `🃏┃card-vault` and `🐾┃stray-dogs-den` for Pokétwo, Shoob and OwO (commands and chat, no threads or files); `🔢┃kunikidas-ledger` (one number each, a wrong one resets it), `💴┃the-yen-counter` (yen commands only answer there) and `🕯️┃midnight-confessions`, where `tz confess` or the pinned button posts anonymous numbered confessions.
- 🎙️ **Lupin Lounge**: voice channels Bar Lupin, Late Night Shift, Mission Room and Watch Party, plus **➕ Open a private booth**: join it and Texz makes you a voice room of your own that nobody enters uninvited. `tz booth invite @someone` (a friend or a music bot), `kick`, `open`, `lock`, `name` and `limit` run it, and it closes the moment you leave.
- 🗄️ **Port Mafia Archives**, at the very bottom and hidden from everyone but staff: `⚖️┃executive-orders` for moderation and automod, `👁️┃black-lizard-watch` for joins, leaves, edits and deletes, and `📓┃texz-ledger` for settings changes.

Channels Texz made before are moved and renamed instead of duplicated, and the ping roles it hands out carry no permissions. Every Monday the week's file goes to the archive: top chatters, top catchers, the busiest channel and the count.

## Missions and achievements

Every day the server gets one Agency mission (make a quote, win two quiz questions, catch a Water type and so on) that pays yen, more for a streak, see `tz mission`.

`tz achievements` shows all 28 medals as a drawn sheet, bronze to gold with purple relics for the rare ones, each with how to earn it and how close you are: first shiny, every type caught, a 30 day daily streak, quote of the week three times, quick draw on the anime guess, night owl and more. Pick up to six from the menu there and they hang on your profile card.

## Fun

Make it a Quote turns a message into the classic black and white quote picture, from the right click menu, by replying with `tz quote`, or with a message link. It posts where you made it and a copy goes to the quotes channel if one is set, and every Sunday the quote with the most reactions becomes quote of the week. There's also an 8 question ship test, polls, dice, coin, 8ball and pick for me.

## Interactions

`tz hug @someone`, `tz pat`, `tz bonk`, `tz slap`, `tz yeet` and 50 more, or `/fun view:act`. Each one comes with an anime gif from [nekos.best](https://nekos.best) and a line in the Agency's voice, counts how many times one person did it to another, and the person on the other end gets a button to send one straight back. `tz bonds` shows who you trade the most with, and the top three show under your profile card. `/hug`, `/pat`, `/kiss`, `/slap`, `/bonk` and a few more also work as their own slash commands, so with Texz added to your account they work in DMs and group chats too, and anything run there is shown to everyone in the chat. A few work alone too, like `tz cry`, `tz dance` and `tz tableflip`.

## Moderation and server tools

`tz warn`, `tz timeout @someone 10m`, `tz kick`, `tz ban` (`tz ban @someone 3d` lifts itself), `tz unban`, `tz purge 20`, `tz lock` and `tz slow 10s`. Every action is a numbered case with a DM to the person, and `tz case` searches the archive. Logs, automod (invites, spam, mass mentions), welcome and goodbye, autorole, tickets, giveaways with entry conditions, birthdays, role pickers, planned announcements and server stats are all set from `/setup` or `/admin`.

## Setting it up

1. Make an application on the [Discord developer portal](https://discord.com/developers/applications), add a bot, and switch on the Message Content and Server Members intents.
2. Invite it with the `bot` and `applications.commands` scopes. It needs to manage roles and channels for bulletins, rank roles and spawn pings, and it has to be in the server where people play OwO and Pokétwo.
3. Copy `.env.example` to `.env` and fill in the bot token and the application ID.
4. Then:

```
npm install
npm run build
npm start
```

Every feature starts switched off in a new server, so nothing happens until an admin picks what they want in `/setup` → Features (there's an Everything on button). Slash commands register themselves when they change, so there's no separate deploy step. It needs Node 24 or newer and stores everything in one SQLite file using Node's built in sqlite.

## Keeping it online

On Windows, double click `tray/texz-tray.vbs` once. A dot appears next to the clock (green online, orange starting, grey off) with a menu to turn it on or off, restart, rebuild, start with Windows, and update from GitHub once a day, rolling back if an update crashes in its first minute. Output goes to `texz.log`. Any always on Linux box with Node works too.

A copy of the database is saved daily in `backups/` (last seven kept), and the owner can pick a channel in `/setup` → Logs where texz reports its own errors. A dropped internet connection is one line in the log instead of an error, the tray shows it, and reminders that came due while offline are sent once it's back, marked late. Every Sunday the owner gets a short check-up in DMs with uptime, errors, spawn accuracy and the most used commands. `/tools view:backup` saves a server's setup to a file that can be loaded here or on another server.

## Tests

```
npm test
```

The OwO tests use replies copied from real screens. OwO changes its layout now and then, so if something stops being picked up, `src/owo/parse.ts` is the place to look.

## Credits

- Anime data from [AniList](https://anilist.co), F1 from [Parc Fermé](https://parc-ferme.pages.dev), football from ESPN's public scoreboards, "on this day" from Wikipedia's feed.
- Pokémon names, types and artwork from [PokeAPI](https://pokeapi.co), and spawn recognition with the open [pokedex_project](https://huggingface.co/Sutadasuto/pokedex_project) classifier.
- Gifs from Giphy, fonts are Inter, Cinzel and Playfair Display under the SIL Open Font License (in `assets/fonts`).

## License

MIT
