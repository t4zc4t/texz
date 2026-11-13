# texz

texz is an all in one Discord bot with a Bungou Stray Dogs theme the whole way through. The server is the Armed Detective Agency, the admin side is the Port Mafia, and Dazai does most of the talking. It runs the server layout and its roles, F1, football and anime bulletins, predictions, levels, yen, profiles, games, interactions, moderation, and keeps track of the game bots people play (OwO, Pokétwo and Shoob) so nobody misses anything.

Nothing needs memorising. Type `tz` or run `/help` and pick a door, or ask in plain words like `tz help money` or `tz help hug`. A typo like `tz rnak` gets a "did you mean `tz rank`" with a button that runs it.

## Getting around

Everything sits behind ten dashboards, each one a slash command and the same word typed after `tz`.

| Dashboard | Command | What's in it |
|---|---|---|
| 🖤 Port Mafia HQ | `/admin` | moderation and case files, giveaways, role pickers, planned posts, xp tools, server stats, backups and `/setup`, only for admins and the staff role |
| 🐾 Stray Dogs Den | `/owo` | OwO timers, huntbot, gems, zoo, weapons, quests and the shop |
| 🔴 Pokédex Bureau | `/poketwo` | Pokétwo claim help, hints, the server Pokédex and the weekly catch race |
| 🃏 Card Vault | `/shoob` | Shoob rare drops and your character wishlist |
| 📚 Literary Annex | `/anime` | what's on today, anime, manga and character search, your list, alerts, watch parties and movie night |
| 🏁 Paddock & Pitch | `/sports` | F1, football, international games and predictions |
| 🥃 Bar Lupin | `/fun` | interactions, F1 quiz, crest quiz, guess the anime, trivia, quotes, ship, polls, confessions and dice |
| 🪪 Personnel File | `/profile` | your profile card and favourites, rank, medals, closest people, mission, birthday and every ping you get |
| 💴 Yen Ledger | `/yen` | daily, shifts, Port Mafia jobs, fishing, the vault, robbing, crew heists, coin flips, slots, blackjack, roulette, scratch cards, rock paper scissors, a colour role of your own and the role shop |
| 🧰 Odds & Ends | `/misc` | user and server info, avatar, afk, one-off reminders, private voice booths and the bot ping |

Each dashboard is a short list of its commands, a few per page, with the typed form, the slash form, the short names and what goes after it (`?` marks the parts you can leave out). `tz help hug` or `/help feature:hug` opens the right page with that command marked. Port Mafia HQ, `/setup` and the pings panel stay proper dashboards with buttons, since that's where things get switched on and off.

## The server layout

`/setup` → **Build the Agency** lays the whole server out in one click and puts the right locks on every room. It can be run again any time, it fixes things in place instead of making copies, and channels it made before get moved and renamed.

- 🚪 **Agency Front Door**, at the very top
  - `🚪┃the-entrance-exam`: newcomers only see this and the rules until they press the button, which gives them **Agency Member** and opens the rest of the server. Everyone already in gets it automatically and bots skip it.
  - `📜┃agency-rules`, `🌸┃new-recruits` for welcomes and goodbyes, `💎┃agency-patrons` for booster thank-yous (off until it's switched on in `/setup` → Welcome)
  - `📈┃ranks-and-perks`: every rank with its level, role and perks, plus the special roles and how to get them
  - `🎭┃pick-your-roles`: the informant pings (F1, football, prediction calls, rare spawns, rare drops), pronouns, region (Asia Branch, Europe Branch and so on), DMs (Line Open, Knock First, Line Closed) and ten name colours in the Agency's palette. Everything except the pings is one at a time.
- 🕵️ **Agency Bulletin Board**: the F1, football and anime feeds, `🔮┃ranpos-deductions` for predictions, `🎖️┃promotions` for rank ups, `🖋️┃ink-and-regret` for quotes and `⭐┃the-agency-files` for the best messages and rare spawns
- 🥃 **Bar Lupin**: `💬┃agency-office` (general chat), `📸┃evidence-board` (pictures and memes), `🔴┃pokedex-bureau`, `🃏┃card-vault` and `🐾┃stray-dogs-den` for the game bots, `🔢┃kunikidas-ledger` (counting), `💴┃the-yen-counter` (yen commands only answer there) and `🕯️┃midnight-confessions`
- 🎙️ **Lupin Lounge**: voice rooms, plus **➕ Open a private booth** (see below)
- 🗄️ **Port Mafia Archives**, at the very bottom and staff only: `⚖️┃executive-orders` (moderation and automod), `👁️┃black-lizard-watch` (joins, leaves, edits, deletes) and `📓┃texz-ledger` (who changed which setting)

Every rank role and the bots' **Black Lizard Unit** role show as their own group in the member list, and any bot added later joins the unit on its own. Notice rooms are read-only with reactions, chat rooms are open, bot rooms take commands but no threads or files, and nobody can @everyone. Ping and colour roles carry no permissions, and the colours sit above the rank roles so they actually show.

Every feature starts switched off in a new server, so nothing happens until an admin picks what they want in `/setup` → Features (there's an Everything on button).

## Sports

- **F1**, from [Parc Fermé](https://parc-ferme.pages.dev): race week board, a ping before qualifying, sprints and the race, a live thread on race day, and results drawn as cards in Parc Fermé's look (Port Mafia dark or Detective Agency light). Results come with the race time, fastest lap, quickest pit stop, the biggest climb and how many didn't finish, and qualifying shows the pole lap. Standings, the schedule, an evening trivia fact and "on this day" too.
- **Football**, from ESPN's public scoreboards: the day's matches worth watching, kick-off cards with both crests and full-time cards with the score and scorers, across 25+ leagues and cups. During international breaks the big national teams (and India) get posted too, Nations League, friendlies and qualifiers included. Anyone with a club on their profile gets pinged the moment their club scores.
- **Predictions**: every morning `🔮┃ranpos-deductions` first gets yesterday's verdict, drawn like the F1 results (each score, how many called it and the sharpest minds), then the day's big matches with home, draw and away buttons, and on race week a podium pick, pinging the **Deduction Informant** role. Calls close at kick-off or lights out, right calls pay yen and show up under the result, and `tz predict top` is the season table.

Teams and clubs show their real logos as emoji wherever they're named, and `tz f1 quiz`, `tz quiz crest` and `tz history` are in Bar Lupin.

## Anime and manga

`tz anime <title>`, `tz manga <title>` and `tz char <name>` pull clean cards from AniList with the cover, banner, score, episodes, genres, related shows and official watch links. `tz wl` is your list with quick +1 episode buttons, and 🔔 on an airing show gets you a DM for every new episode. `tz whatson` is the day's schedule in your timezone with trending and the season a click away, `tz wp 21:00 frieren` plans a watch party with an event, pings and a spoiler thread, and there's a character of the day.

**Movie night**: every evening a movie of the day lands in the Watch Party voice room's chat, a different mood each day. `tz movie` opens a picker for genres, decade, language, score and length, then rolls one, shows ten or puts three to a real Discord poll, handy in a watch party chat. `tz movie inception` looks one up with its poster, trailer, cast and a where to watch link, and `tz movie like interstellar` finds ones like it.

The anime board posts the day's screenings with the biggest show's banner, each new episode with its art, "on this day" and a weekly recap. It never pings the server, everyone's own shows reach them by DM. AniList allows 30 requests a minute, so texz paces itself and keeps answers for half an hour.

## Games and interactions

- **Interactions**: `tz hug @someone`, `tz pat`, `tz bonk`, `tz slap`, `tz kabedon`, `tz yeet` and 50 more, each with an anime gif and a line in the Agency's voice, plus a button for the other person to send one straight back. Some work alone, like `tz cry`, `tz smile` or `tz tableflip`, or `/emote` from anywhere. `tz bonds` shows who you trade the most with, and the top three show under your profile card.
- **Quizzes that pay yen**: the F1 quiz, the crest quiz, guess the anime and F1 trivia.
- **Make it a Quote** turns a message into a framed quote picture (right click menu, `tz quote` as a reply, or a link). A copy goes to the quotes room and the most loved one each week becomes quote of the week.
- The 8 question ship test, polls, dice, coin, 8ball and pick for me.

## Profiles, levels and yen

`tz profile` draws your personnel file: your colour, your medals and a favourites corner with your F1 team's logo, your club's crest and your favourite anime and manga covers, all picked from menus in `tz profile edit`. Profiles, birthdays, wishlists and yen belong to the server they were made in.

Levels are off until an admin turns them on. Ranks go from Stray up to Living Legend of Yokohama, each with perks (more xp, a bigger daily, extra giveaway chances), and `/setup` makes the rank roles in order. `tz rank` draws a rank card.

Ranks also unlock chat, one step at a time, and each rank keeps everything below it:

| Rank | Level | Unlocks |
| --- | --- | --- |
| 🚪 Agency Visitor | 3 | outside emojis and stickers |
| 📮 Errand Runner | 6 | gifs and link previews |
| 🔍 Junior Detective | 10 | images and files |
| 🕵️ Field Investigator | 15 | voice messages, camera and screen share |
| 🧥 Senior Detective | 20 | soundboard and outside sounds |
| ✨ Ability User | 30 | threads and polls |
| 🎖️ Agency Elite | 40 | voice activities |
| ♟️ Strategist | 50 | private threads |
| 🌉 Living Legend of Yokohama | 75 | priority speaker |

Texz takes those permissions off `@everyone` and the member role, puts them on the rank roles, and clears any channel that hands them out to everyone. Boosters get emojis, stickers, gifs, images and voice messages straight away, and the Black Lizard Unit keeps what bots need to post. Rooms that are plain on purpose, like the count and the bot rooms, stay plain for every rank.

Yen comes from `tz daily` (more for a streak), chatting, the quizzes and predictions, and from earning it: `tz work` (an Agency shift each hour, higher ranks paid more), `tz crime` (a Port Mafia job every two hours, big pay or a fine), `tz fish` (the river, every twenty minutes, with the odd shark and one very rare Dazai) and `tz beg`. `tz bank deposit all` puts yen in your vault, where it grows 1% a day and can't be stolen, and the vault gets bigger with rank. Whatever's left in the wallet is fair game for `tz rob @someone`, which pays them a fine if you're caught. `tz heist` opens a crew job anyone can join with a button: more crew, better odds, and everyone splits the take. `tz rps @someone 100` is rock paper scissors with a bet, or against Texz with no one named. `tz scratch` sells a ¥100 Lucky Three ticket: nine silver cells you scratch one tap at a time (or all at once), three alike pays out, and a ticket left alone for 90 seconds expires with the ¥100 gone. `tz give`, the back room (`tz flip 100 heads`, `tz slots 200`, `tz bj 500`, `tz roulette 200 red`, `tz scratch`, bets from ¥10 to ¥10,000, `half` and `all` work too), the role shop and `tz mycolour buy #c8283c` spend it: that last one is a role nobody else has for ¥5,000, with the colour, a gradient, the name or an icon changeable for ¥300 each.

Every day the server gets one Agency mission that pays yen (`tz mission`), and `tz achievements` shows all the medals, bronze to gold with relics for the rare ones. Up to six of them hang on your profile card.

## Game bots

texz watches the game bots people play and keeps track for them. It never plays for anyone.

- **OwO**: reminders for huntbot, pray, curse, vote and the daily reset (to DM or the channel), a last call before reset with whatever's still open, a ping on captchas, and advice from the screens you open: which huntbot trait to upgrade, gem sets that run out together, weapons and team, zoo, the best weapon per pet and what's safe to dismantle. `tz buddy join` and `tz ask pray` find quest buddies.
- **Pokétwo**: every spawn gets a reply with the name, region and the catch line (tap to copy on phones, a copy box on PC). It reads the picture with an open 1,025 species classifier and learns every spawn confirmed by a catch or a hint, so Pokétwo's own forms come out right after the first one, and solves hints too (`tz hint p_k_ch_`). Legendaries, mythicals and ultra beasts ping their role, get pinned until caught and get filed in the Agency files. `tz dex` is the server's Pokédex and `tz race` the weekly catch race.
- **Shoob**: only tier 5 and 6 drops ping, tier 6 gets filed in the Agency files, and `tz wish add Gojo` pings you when that character drops at any tier.

`tz pings` is one page for every ping and reminder texz can send you.

## Community

- **Counting** in `🔢┃kunikidas-ledger`: one number each, a wrong one resets it, the record is kept.
- **Confessions**: `tz confess` or the pinned button posts an anonymous numbered confession, and staff can trace one if it breaks the rules.
- **The Agency files**: messages that get five stars, plus every rare spawn, framed and kept.
- **Private voice booths**: join **➕ Open a private booth** and texz makes you a voice room of your own that nobody enters uninvited. `tz booth invite @someone` (friends or a music bot), `kick`, `open`, `lock`, `name` and `limit` run it, and it closes the moment you leave.
- **Weekly recap** every Monday: top chatters, top catchers, the busiest room and the count.
- Birthdays, giveaways with entry conditions, role pickers and planned announcements.

## Moderation

`tz warn`, `tz timeout @someone 10m`, `tz kick`, `tz ban` (`tz ban @someone 3d` lifts itself), `tz unban`, `tz purge 20`, `tz lock` and `tz slow 10s`. Every action is a numbered case with a DM to the person and `tz case` searches them. Voice gets the same: `tz vc mute`, `deafen`, `kick` (disconnect), `move @someone #room`, `moveall #room`, `ban @someone 1h` (keeps them out of every voice room, pulled out the moment they join) and `lock` or `unlock` for a room, each with an un- version, and joins, leaves and room hops go to the surveillance log. Admins can move xp with `tz xp give/take/level @someone` and yen with `tz money give/take/set @someone 500`. Automod (invites, spam, mass mentions), logs, tickets and a staff role that can use Port Mafia HQ are set from `/setup`.

## Outside the server

With texz added to your own account, `/hug`, `/pat`, `/kiss`, `/slap`, `/bonk` and the other favourites, plus `/fun`, `/anime`, `/sports` and `/profile`, work in DMs and group chats too, and the answer is shown to everyone in the chat. Make it a Quote works there as well.

## Setting it up

1. Make an application on the [Discord developer portal](https://discord.com/developers/applications), add a bot, and switch on the Message Content, Server Members and Presence intents. Turn on User Install under Installation if you want it in DMs.
2. Invite it with the `bot` and `applications.commands` scopes. It needs to manage roles and channels, and its role should sit near the top so it can hand out and order roles.
3. Copy `.env.example` to `.env` and fill in the bot token and the application ID. Movies need a free Client ID from [Trakt](https://developer.trakt.tv/apps) as `TRAKT_ID` (no phone number or personal details needed), everything else works without it.
4. Then:

```
npm install
npm run build
npm start
```

Slash commands register themselves when they change. It needs Node 24 or newer and keeps everything in one SQLite file with Node's built in sqlite.

## Keeping it online

On Windows, double click `tray/texz-tray.vbs` once. A dot appears next to the clock (green online, orange starting, grey off) with a menu to turn it on or off, restart, rebuild, start with Windows, and update from GitHub once a day, rolling back if an update crashes in its first minute. Output goes to `texz.log`. Any always on Linux box with Node works too.

The database is copied to `backups/` every day (last seven kept), errors can go to a channel picked in `/setup` → Logs, reminders that came due while offline are sent once it's back, and every Sunday the owner gets a short check-up in DMs. `/admin view:backup` saves a server's setup to a file that loads here or on another server.

## Tests

```
npm test
```

The OwO tests use replies copied from real screens. OwO changes its layout now and then, so if something stops being picked up, `src/owo/parse.ts` is the place to look.

## Credits

- Movies from [Trakt](https://trakt.tv).
- Anime from [AniList](https://anilist.co), F1 from [Parc Fermé](https://parc-ferme.pages.dev) and the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1), football from ESPN's public scoreboards, "on this day" from Wikipedia.
- Pokémon names, types and artwork from [PokeAPI](https://pokeapi.co), spawn recognition with the open [pokedex_project](https://huggingface.co/Sutadasuto/pokedex_project) classifier.
- Interaction gifs from [nekos.best](https://nekos.best), other gifs from Giphy.
- Fonts in `assets/fonts` are Shippori Mincho B1, Zen Kaku Gothic New, JetBrains Mono, Inter, Cinzel and Playfair Display, all under the SIL Open Font License.

## License

MIT
