# Hikari anime extension

The existing ES module JavaScript / Discord.js 14 bot, PostgreSQL database,
guild configuration service, permission checks, command loaders, health server,
music and deployment remain in use. All anime commands live under `/anime` to
conserve Discord's command limit. Personal replies are ephemeral.

## Boundaries

- Provider clients share bounded caching, in-flight deduplication, paced queues,
  timeouts and retries. Jikan v4 is read-only and uses MAL IDs as canonical IDs.
  AnimeSchedule v3 requires an application bearer token. A mapping is accepted
  only from an exact MAL website link or an explicit administrator confirmation.
  Titles alone never establish identity. Crunchyroll uses provider links only;
  catalog languages, publication and regional entitlement remain unknown.
- Additive PostgreSQL tables store private profiles (list, history, notes,
  preferences, consent, challenges), guild community state, provider mappings,
  expiring component sessions and durable jobs. Row locks serialize edits. The
  anime write paths refuse the existing volatile database fallback.
- Existing guild configuration gains a validated anime section: modules,
  announcement/news/schedule channels, approved mention roles, language,
  Asia/Jerusalem time zone, spoiler defaults, quiet hours and notifications.
- A database worker claims jobs with SKIP LOCKED, uses leases and unique keys,
  recovers expired claims and reconciles schedules at delivery. Notifications
  use stable Discord nonces plus persisted receipts. Ambiguous sends are held
  for reconciliation instead of blindly repeated.

## User experience

Discovery includes filtered search, autocomplete, paged selectors, detail cards,
people/character lookup, seasons, recommendations and sourced relationship
guides. Release ordering uses actual premiere dates; chronology requires a
sourced, administrator-curated guide. Unknown metadata stays unknown.

Tracking includes all five statuses, progress controls, private episode notes,
genre preferences, ratings/history-based recommendations, filtered random
choices, consent-gated shared suggestions/comparison, export, confirmed deletion,
estimated viewing minutes, monthly progress, challenges and opt-in reminders.

Community state includes public episode-context reviews with private warned
spoiler reveals, ratings/favorites, persistent polls, RSVP parties and reminders,
explicitly spoiler-labeled discussion threads, cover/clue guessing games,
persistent character brackets and refreshable anime hubs. Public participation
is explicit. Every component rechecks membership, permissions, modules, expiry
and ownership as applicable.

Announcements distinguish raw Japanese broadcast, sub and dub schedules from
actual streaming publication. Follow subscriptions, weekly posts, timetable
changes, relation updates, news and trailers use provider sources and durable
deduplication. No guessed dates or availability claims.

## Validation

Use node:test and a PostgreSQL-compatible engine for meaningful storage,
privacy, mapping, job recovery, duplicate delivery, permission, command-loader
and component tests. Run existing migration scripts against a disposable real
PostgreSQL instance when available; do not connect to user production data.
No live Discord or authenticated AnimeSchedule validation is possible without
operator-supplied environment credentials.
