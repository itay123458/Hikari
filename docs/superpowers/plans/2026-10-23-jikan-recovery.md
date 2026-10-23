# Jikan endpoint recovery

> Use subagent-driven-development for the isolated metadata sidecar implementation and review.

**Goal/spec:** Fix the user's annotated Jikan outage and remove the four obsolete review files without altering working bot behavior.
**Evidence:** Jikan maintainer issue #613 confirms the public API retired October 1, 2026. The Pi reaches MAL normally (HTTP 200), but has only about 329 MB available RAM. Official Jikan REST indexing needs MongoDB plus an initial multi-day index; a bounded internal adapter using its official parser and v4 serializer avoids rebuilding the bot or running an index cluster.

- [x] Add operator-controlled JIKAN_BASE_URL with clear missing-endpoint guidance, URI validation and regression tests. Preserve all existing provider methods and exact MAL identities.
- [x] Build a private, bounded-memory sidecar from the pinned official Jikan REST image, using its bundled parser/serializer and only routes Hikari consumes. Cache successful upstream results on disk, pace requests, preserve query filters and honest pagination, never invent dates or availability. No public listener binding or Discord/token access.
- Verification/release gate: real detail/search/news/trailer/person/season/genre routes on the Pi, full bot tests, review, docs/env/Compose, commit/push and deployment. Preserve other containers. Results are recorded in the completion report.
- [x] Remove exactly the four inventoried obsolete review files and their empty directory using nonrecursive operations. Confirmed absent.

**Review focus:** Missing endpoint; API base path/credentials/query validation; source HTML changes; safe result pagination/filtering; unknown dates; cache/lock crash recovery; memory; source links; upstream 404/429/5xx behavior.
