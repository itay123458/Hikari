# Hikari Anime Implementation Plan

**Goal:** Extend the working bot with the supplied anime brief in the current repository.
**Architecture:** Modular services behind the existing command/interaction loaders;
additive PostgreSQL storage and a durable worker, existing guild configuration.
**Tech stack:** JavaScript ES modules, Discord.js 14, pg, node:test, sharp.
**Spec:** `docs/anime-design.md` and the user's complete pasted requirements.

## Global constraints

Preserve existing features and deployment. No account credentials in Discord.
Private by default; comparisons require current consent. Asia/Jerusalem default.
Canonical MAL IDs; never title-match seasons. No fabricated provider capabilities.
Work in the current repository as requested; no extra worktree or automatic push.

## Review focus

Forged/expired components; consent revoked after session creation; job restart and
concurrent claims; schedule changes after enqueue; partial or unavailable providers.

## Stages

- [x] 1. Storage and domain rules. Write failing privacy, concurrency, progress,
  settings and job tests; implement additive schema and transactional store.
- [x] 2. Providers. Write failing cache/retry/mapping/normalization tests;
  implement documented clients, strict identity and sourced watch order.
- [x] 3. Tracking and discovery. Add the `/anime` command schema, private UI
  sessions, search and tracking operations; test ownership and real state changes.
- [x] 4. Community. Add parties, reviews, polls, games, tournaments, threads and
  hubs; test vote serialization, spoiler gating and mutation permissions.
- [x] 5. Worker and integration. Test claims, deduplication, retries and delivery
  reconciliation; wire startup/shutdown, config, feeds, reminders and schedules.
- [x] 6. Verify and document. Run complete tests, syntax/loader checks,
  migration checks, provider smoke checks and a fresh whole-change review.

## Progress / decisions

Implementation authorized in the supplied brief; proceed inline without redundant
design approval. Database writes must fail closed when PostgreSQL is unavailable.
Existing schema ledger version is retained: all additions use idempotent additive
DDL in the existing shared schema, including on installations pinned to version 1.
Crunchyroll fallback is explicitly authorized by the brief.

Review findings addressed: Discord modal label limit; nonfunctional buttons on
private public-message snapshots; winner/private follow snapshot erasure; slow
scans blocking job delivery. Additional regression fixes: unreadable anime
configuration fails closed, and late provider responses cannot recreate erased
private scheduled data. Scanning and deliveries now run separately under leases.
No user credentials were supplied and no production Discord side effects ran.

Final verification (2026-10-22): 49/49 tests passed with no skips on Node
22.16.0 and Node 20.19.0, including disposable PostgreSQL 18 multi-connection
tests. Syntax checks passed for 310 JavaScript files. The existing migration
script was applied repeatedly and its version check passed. `git diff --check`
passed. Live Jikan requests timed out (UND_ERR_CONNECT_TIMEOUT); authenticated
Discord/AnimeSchedule and a Docker image build remain unverified. All review
findings have regression coverage, including locked publication cleanup capture.
