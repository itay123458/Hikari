# Hikari anime module

This extends the existing TitanBot/Hikari JavaScript bot. Moderation, music,
economy, leveling, tickets, birthdays, prefix commands, health endpoints and
Docker deployment remain present. Anime commands are slash-only and use one
global command, `/anime`, with the existing embed colors and command loader.
There is no separate web dashboard or new authentication system.

## Operator setup

1. Keep the existing `DISCORD_TOKEN`, `CLIENT_ID` and PostgreSQL configuration.
2. Run `npm ci`, then `npm run migrate` and `npm run migrate:check` against your
   existing database. Back up first using the existing backup procedure. These
   changes are additive and idempotent; existing rows are preserved. The shared
   schema also runs at startup. The existing version-1 ledger is retained for
   compatibility with deployments that pin `SCHEMA_VERSION=1`.
3. Create an application in your AnimeSchedule account's API settings. Put its
   **application bearer token** in `ANIMESCHEDULE_TOKEN` in the environment. Do
   not send account passwords or API tokens through Discord. Jikan needs no key.
4. Start the existing bot normally (`npm start` or the existing Docker Compose
   setup). Its current startup flow registers `/anime` globally. Discord may
   take time to propagate global commands.
5. Use `/anime admin channels` for episode, news and weekly-schedule channels.
   Use `/anime admin settings` for time zone, title language, spoilers, quiet
   hours and notifications; `/anime admin modules` for module switches.
6. Approve optional mention roles with `/anime admin roles`. Then follow an
   anime with `/anime alerts follow server:true` and optionally select an
   approved role. Enable weekly/news/trailer posts with `/anime admin feeds`.

Manage Server is checked in code for administrative actions, server follows
and hub management. Members also need View Channel and Send Messages to create
public posts. Threads additionally require Create Public Threads. The bot needs
View Channel, Send Messages, Embed Links and Read Message History for scheduled
server notifications; Attach Files for image games; and Create Public Threads
and Send Messages in Threads for discussions. Role mentions only use approved,
existing roles that are mentionable or that the bot has permission to mention.
Everyone and managed roles cannot be approved.

The default time zone is `Asia/Jerusalem`, including daylight-saving changes.
Quiet hours use `HH:mm`; supply both ends, or set both to `off`. Discord
timestamps display in each reader's local time. Party creation/rescheduling
accepts an ISO timestamp with an explicit offset, such as
`2026-11-01T20:00:00+02:00`; ambiguous wall-clock input is rejected.

## Commands

Open `/anime help` for a compact guide. Discord exposes all options and choices.

| Group | Subcommands | Behavior |
| --- | --- | --- |
| `discover` | `search`, `detail`, `character`, `voice`, `season`, `order` | Autocomplete, filtered and paged results, selection menus, streaming links, character/voice credits, current/previous/upcoming anime, sourced relationship guides |
| `list` | `add`, `show`, `remove`, `progress`, `rate`, `note`, `notes` | Global private watchlist, five statuses, episode controls, private ratings and episode notes |
| `list` | `preferences`, `recommend`, `random` | MAL genre preferences, recommendations using API recommendations plus ratings/history and genre results, filtered random watchlist selection |
| `list` | `privacy`, `shared`, `compare` | Current per-server opt-in consent required from both current members; private title overlap/rating comparison and shared unfinished suggestions |
| `list` | `stats`, `challenge`, `reminders` | Estimated viewing time, monthly progress, monthly episode targets, opt-in inactivity DMs (`days:0` disables) |
| `list` | `export`, `delete` | Private JSON export; short-lived explicit deletion confirmation |
| `alerts` | `follow`, `unfollow`, `following`, `countdown`, `schedule` | Private/server follows, raw/sub/dub tracks, exact-ID countdowns, today/week schedules with pages and provider-listed Crunchyroll filter |
| `club` | `review`, `reviews`, `favorites`, `poll` | Explicit public episode-context reviews/ratings, private spoiler reveal, server rankings from public reviews, persistent one-vote-per-member polls |
| `club` | `party`, `parties`, `reschedule`, `cancel`, `discuss` | RSVP parties, opt-in Going reminders, host/manager changes, spoiler-labeled public episode threads |
| `club` | `hub`, `refresh` | Persistent anime hub with public ratings, schedule, provider links, personal actions and discussion links |
| `games` | `guess`, `answer`, `reveal` | Real provider titles/covers, clue, silhouette-mask and progressively unblurred cover games; stored results and short guess cooldown |
| `games` | `tournament`, `bracket`, `advance` | Persistent 4/8/16-character brackets and per-match votes; host/manager closes each match; ties advance the earlier seed |
| `admin` | `settings`, `channels`, `roles`, `modules`, `mapping`, `chronology`, `feeds` | Existing guild configuration and explicit identity/order verification |

`preferences`/search genre filters use MAL numeric genre IDs (for example Action
is 1); preferences validate IDs against Jikan's genre list. Statuses are
`watching`, `planned`, `completed`, `paused`, `dropped`. Watchlists are limited
to 500 entries. A completion status does not silently guess episode progress;
record it explicitly. Unknown episode totals/durations stay unknown. Monthly
statistics count positive recorded progress changes; corrections do not rewrite
history. Viewing minutes use known provider durations, excluding unknown ones.

The Crunchyroll search filter checks provider streaming links on each result
page. A filtered page can be empty while later pages contain matches. It does
not test regional entitlement. Title language supports English, romaji and
Japanese with provider fallback; command/interface text remains English.

Reviews require an episode context. Review metadata and ratings are public
contributions. Content is revealed privately; spoiler-marked reviews or reviews
beyond recorded progress show an explicit warning first. Synopsis is hidden by
default and has an explicit reveal control. Threads have spoiler labels and
rules, **not individual spoiler access enforcement**.

Going RSVP is consent to that party's private start/15-minute reminder DMs and
reschedule/cancellation updates. No revokes reminders. Inactivity reminders are
separately opt-in, sent once per inactive period; new activity can start another.
Hubs refresh approximately every 15 minutes and can be refreshed manually.
Guessing games last 15 minutes; hosts/managers control reveals. Silhouette masks
estimate the connected cover background and can be abstract on textured images;
text clues and subsequent reveal stages remain available.

## Provider provenance and limitations

Documentation consulted on 2026-10-22:

- [Jikan v4 docs](https://docs.api.jikan.moe/) and its
  [official OpenAPI source](https://github.com/jikan-me/jikan-rest/blob/master/storage/api-docs/api-docs.json).
  The client uses documented `anime`, `anime/{id}/full`, `streaming`,
  `recommendations`, `characters`, `news`, `videos`, character/person full
  details and season routes. Data is read-only MAL metadata. Local personal
  watchlists are stored in our PostgreSQL database, never written to MAL.
- [AnimeSchedule v3 introduction](https://img.animeschedule.net/api/v3/documentation),
  [anime/timetable reference](https://img.animeschedule.net/api/v3/documentation/anime),
  [rate limits](https://img.animeschedule.net/api/v3/documentation/ratelimits).
  Uses `anime?mal-ids=...`, `anime/{slug}`, `timetables/all` and release-track
  timetable routes with UTC and explicit ISO year/week. The API's `airType` is
  preserved: a requested subtitle timetable can include a raw fallback. Missing
  dates and the provider's year-0001 sentinel become unknown, never countdowns.
- **Crunchyroll uses provider-listed official HTTPS links only.** No usable
  documented official developer access was verified. The maintained
  [crunchyroll-rs client](https://github.com/crunchy-labs/crunchyroll-rs) was
  evaluated; its API is undocumented and its documentation discusses account
  login and bot-protection blocks. It was not added. No embedded client secrets,
  account credential collection, authentication workarounds or region bypasses
  are implemented. Crunchyroll catalog/episode metadata, available languages,
  actual published-episode state and confirmed regional availability therefore
  remain unavailable/unknown. A streaming link never proves those capabilities.

MAL IDs identify separate seasons. Automatic schedule mapping requires an exact
MAL anime link in AnimeSchedule metadata; similar titles never establish a
mapping. `/anime admin mapping` validates the requested slug and rejects an
explicitly conflicting MAL link. If the provider omits its link, the command
records the administrator's confirmation for that exact MAL ID in that guild.

Release order follows real premiere dates on related anime, bounded to 12
entries and labeled if truncated. It does not claim optional/filler entries or
chronology. Chronological guides require an administrator-supplied ordered list
of real MAL IDs and an HTTPS verification source using `admin chronology`.
The guide records the source and remains explicitly administrator-verified.

Schedules distinguish Japanese broadcast, subtitle and dub times. Notifications
say **scheduled time reached**, not “published on Crunchyroll.” Delay/reschedule
jobs recheck the current provider record before delivery. Related sequel,
movie/new-anime and status updates come from changes to followed titles' MAL
relations/status. News and trailers cover **server-followed anime**. First feed
scan establishes a baseline instead of announcing old articles and relations.
Weekly posts show the first 10 entries with a link and paged command for the full
week. Provider outages never create guessed dates, mappings or availability.

## Persistence, privacy and operations

Additive tables: `anime_documents`, `anime_jobs`, `anime_deliveries`,
`anime_locks`. Profile and guild mutations use transactions and row locks.
Private scheduling commits under the current profile lock so an in-flight
provider response cannot recreate private jobs after deletion. Personal anime
features refuse volatile database fallback. Anime permission/config reads fail
closed if the existing configuration cannot be read; unrelated bot behavior
keeps its existing fallback policy.

Profiles are global. Notes, progress, history, genre preferences and private
ratings are never included in server favorites or exposed by comparison.
Sharing consent is per-server, revocable, and checked for each comparison.
Components check current membership, configuration/modules, action permissions,
session owner/server and expiry; public voting controls also verify the stored
message/channel. Deleted or replaced controls fail gracefully.

`list export` exports the private profile plus the user's community
contributions/votes, omitting other members' private identities from vote/RSVP
data. `list delete` removes the profile, sessions, private follow snapshots,
personal jobs/receipts, authored contributions, votes, RSVP entries and winner
identity. It attempts to delete or refresh affected bot posts and explicitly
reports unavailable channels/permissions. Already copied/archived Discord
messages require administrator action. Backups follow the existing operator
retention policy (example: 14 days); operators should honor deletion requests
after a restore. Legacy `/wipedata` remains server-scoped and points to the
separate global anime deletion control.

HTTP clients share bounded in-memory caches and in-flight request deduplication
within a bot process. Jikan requests are paced at 1.1 seconds (under its 60/minute
limit); AnimeSchedule uses 600ms pacing. Transient failures get bounded retries,
request timeouts, Retry-After and rate-reset handling. Metadata caches normally
last one hour, search five minutes, exact provider lookups one day and
timetables five minutes. Jikan's upstream cache can itself be 24 hours. No
private profile/notes are placed in provider caches. Replicas share job state
and scanner leases; provider caches/limits are process-local, so size replica
counts to respect the provider's IP/application quotas.

The worker polls every 30 seconds and scans about every five minutes. Scanning
runs separately from job delivery, with a renewable database lease. Jobs use
`FOR UPDATE SKIP LOCKED`, renewable claims and stable notification keys across
date changes. Delivery rechecks follows, party version/RSVP, current schedule,
membership and notification settings. Quiet hours defer delivery. Failed jobs
retry with backoff up to eight attempts where retry is safe. Deleted channels,
missing permissions and blocked DMs have terminal states; personal DM content
is never posted publicly as a fallback.

Discord and PostgreSQL cannot share a transaction. Before sending, the bot
saves a delivery intent and uses a stable Discord nonce. Saved receipts prevent
repeated sends after restart. A crashed/ambiguous send is reconciled against the
last 100 channel messages; if its receipt cannot be proven, it is held as
`uncertain`, not automatically sent again. This favors duplicate suppression
over automatic recovery of potentially lost notifications; it is not a claim
of unconditional exactly-once delivery. Inspect safely without personal payloads:

```sql
SELECT id, kind, state, attempts, last_error
FROM anime_jobs
WHERE state IN ('failed', 'blocked', 'uncertain')
ORDER BY id DESC;
```

Check Discord history and permissions before manually reconciling an uncertain
job. Do not blindly delete receipts or requeue uncertain deliveries. Durable
deduplication keys are retained to prevent historical alerts from replaying.
Logs redact secret-bearing fields, environment secrets, bearer values and URL
credentials. Anime handlers log error codes, not request headers or note text.

## Verification

```sh
npm test
npm run check
npm run migrate
npm run migrate:check
npm run anime:smoke
```

Tests use `node:test`, PGlite PostgreSQL semantics and actual Discord builders.
They cover privacy/erasure, consent, forged/expired interactions, module and
permission changes, spoiler reveal, progress, masks, polling/brackets, provider
identity, caching/retries, migration idempotence, job recovery, rescheduling and
duplicate/ambiguous delivery. The existing commands and component loaders are
also exercised together. Set `TEST_POSTGRES_URL` to a disposable PostgreSQL
database for the multi-connection locking/claim test; it uses a random isolated
schema and removes that schema afterward. CI supplies PostgreSQL and runs these
tests plus the existing migration checks. No test logs in to Discord.

There is no TypeScript or compiled application build in this project. `check`
syntax-checks all project JavaScript; tests serialize command/component builders.
Authenticated Discord and AnimeSchedule end-to-end tests require operator
credentials. The local live Jikan smoke attempt timed out connecting to the
provider; live provider behavior remains unverified in this environment. The
Docker daemon was unavailable, so a local container image build was not run.

Local validation on 2026-10-22: **49/49 tests passed, no skips**, on Node 20.19.0
and Node 22.16.0, including disposable real PostgreSQL 18 concurrency tests.
All **310 JavaScript files** passed syntax checks. Repeated migration applies,
the existing schema-version check and `git diff --check` passed. The temporary
PostgreSQL server was stopped after testing. No production server was modified.
