# Hikari's active commands

Hikari loads and registers these 29 top-level commands. `/anime` includes the
full discovery, private tracking, alerts, community, games, and admin suite.

| Purpose | Commands |
| --- | --- |
| Anime | `/anime` |
| Help, recovery, and bot status | `/help`, `/commands`, `/configwizard`, `/ping`, `/stats` |
| Music and playback controls | `/play`, `/queue`, `/nowplaying`, `/music` |
| Essential moderation | `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/purge`, `/warn`, `/warnings`, `/cases`, `/lock`, `/unlock` |
| Roles, welcomes, and logs | `/reactroles`, `/logging`, `/welcome`, `/greet` |
| Member and server tools | `/avatar`, `/userinfo`, `/serverinfo`, `/report` |

Staff commands retain their existing permission checks. Private Palace Member
approval remains manual; removing `/autorole` does not change stored welcome
settings. Existing self-service interest menus continue to work.

Economy, gambling, birthdays, generic fun/tools/search, leveling, tickets,
giveaways, temporary voice setup, server counters, mass moderation, and unused
verification commands are retired from the active catalogue. Anime games,
polls, events, and private-data export/delete remain under `/anime`.

The allowlist is `src/config/commands/hikariCommands.js`. The command loader
uses it before inserting commands into the shared runtime registry. Slash
registration replaces Discord's catalogue with that registry, and prefix
dispatch and help use the same registry. A restart therefore cannot restore
retired commands. Legacy source modules and database rows are retained for
recovery; there is no data migration or deletion.

Music still needs a working Lavalink node. Anime providers retain their normal
availability and regional limitations; see [the anime guide](ANIME.md).
