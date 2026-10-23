# Anime stage 2 completion implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review these tasks continuously.

**Goal:** Complete the user's eight episode-tracking requirements in the existing bot.
**Architecture:** Extend the current PostgreSQL documents/jobs/receipts, shared cached providers, planner, worker and slash-command groups. Preserve existing discovery, community, moderation, music and frontend functionality.
**Tech stack:** Node.js ESM, discord.js, PostgreSQL, node:test/PGlite.
**Spec:** The user's stage 2 request in this session; all eight features and accuracy/delivery requirements are binding.

## Global constraints

- Application bearer token only in ANIMESCHEDULE_TOKEN; no secrets in source/logs.
- Match MAL IDs or administrator-confirmed provider routes, never titles.
- UTC persistence; IANA zones default Asia/Jerusalem; honest actual release types and unknown dates.
- No arbitrary live announcements during verification. Preserve existing private server state.
- Source categories are only used where documented; local filter labels must explain their basis.
- Per-destination persistent dedupe, bounded catch-up, subscription rechecks, retries and crash-window documentation.

## Tasks

- [x] Provider/feed accuracy: regression tests first; normalize documented delay/batch data; precision-aware release dates; transactional relation/date/news/trailer snapshots with destination/source dedupe and honest category filters.
- [x] Settings/commands/local schedules: tests first; configurable weekly weekday/time/type; DST-safe UTC occurrence; followed-only today/week schedules; per-follow episode/change preferences; administrator previews and feed filters.
- [x] Delivery persistence: tests first; attempt-fenced state mutations and delivery ownership; safe retry of transient pre-send errors; cancellation/guild/type checks; restart catch-up bounds.
- [x] Integration: planner weekly scheduling and worker rendering use the shared helpers; preserve old commands; update README/.env.example and generated command catalogue.
- [ ] Verification: syntax and full tests, fresh code review, resolve findings, commit/push, CI and Pi deployment with health/provider smoke checks.

## Review focus

- Weekly wall times across gaps/folds and ISO-week boundaries.
- Same source item linked from multiple followed anime; snapshot changes recurring A/B/A/B.
- Unsubscribe/re-follow or guild move while provider fetch/delivery is pending.
- Expired worker claims racing new claims and Discord's ambiguous send window.
- Missing token, provider fallback, partial dates, deleted channels and blocked DMs.

## Rulings

- Existing user authorization covers commit/push and Pi deployment after verification.
- Unknown Jikan article categories remain unclassified news; trailer/relation/date/status filters describe structured resources, never guessed article categories.
- Catch-up is bounded to 24 hours for episode/update/feed/weekly jobs; missed older posts are skipped.
