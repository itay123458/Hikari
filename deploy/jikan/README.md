# Private Jikan parser bridge

This is a small internal adapter for Hikari's consumed Jikan v4 routes. It runs
the official Jikan parser and official REST v4 serializer from a pinned
multi-platform image, without booting Laravel, MongoDB, indexing, nginx, or
workers. The official image's license notices remain in the image.

Use the `docker-compose.jikan.yml` overlay after the base and Pi overlays. The
bot gets `http://jikan:8080/v4` by default. There are no published ports or bot
credentials in the sidecar. The existing project network provides DNS and
outbound MAL access; it is not a Docker `internal: true` network.

Successful upstream responses are cached for 24 hours in the private
`jikan_cache` volume, limited to 500 entries and 32 MiB. Failures are never
cached. A file lock serializes upstream fetches and enforces at least 1.1 seconds
between request starts. Each complete request has a 25 second budget, including
cache checks, lock/pacing waits and every upstream page. Exhaustion returns 503
with guidance to narrow the filters; each upstream timeout uses the remaining
budget. PHP runs
one worker with a 96 MiB allocation limit, alongside Compose's 192 MiB container
limit and half a CPU. **The container memory limit requires host memory cgroups.**
On the test Pi Docker warned that memory cgroups were unavailable; PHP's limit
still applied, and observed process high-water RSS was approximately 73 MiB.
PHP's limit does not cover every native allocation. No host boot settings are
changed by this project.

Only GET and explicit named routes/query parameters are accepted. No arbitrary
URL forwarding exists. MAL status 404/429 is preserved; other upstream failures
and parser failures return 502 with an upstream status when available. Invalid
filters return 400. The service does not claim empty results when scraping fails.

Search filters map to MAL's native query parameters. Popularity ordering uses
member count in reverse (MAL's popularity measure). SFW excludes Rx/R+ ratings
and explicit/erotica genres; unknown ratings are excluded unless MAL explicitly
provides a false season adult flag. An empty genre list alone does not establish
SFW status. Search pages are merged and filtered before slicing
to the requested limit, preserving page boundaries across MAL's 50-item pages.
To bound work, a request scans at most 20 upstream pages; searches beyond that
return 503 and require narrower filters. `last_visible_page` is a confirmed
lower bound while more results exist, rather than a fabricated total.

Full anime detail preserves MAL date precision in `aired.prop`; list parsers
discard precision, so their dates remain unknown until detail is fetched.
Provider streaming listings do not establish region, language, or availability.
News items retain source fields and do not invent classifications.

Offline regression checks inside the image:

```sh
docker run --rm --entrypoint php hikari-jikan:local /app/bridge/test.php
```

Optional live checks (makes paced requests to MAL, no Discord activity):

```sh
docker compose -f docker-compose.yml -f docker-compose.pi.yml -f docker-compose.jikan.yml exec jikan php /app/bridge/smoke.php
```

The live smoke checks verify nonempty responses and bot-consumed nested fields
for details, characters, recommendations, relations, streaming, current news,
videos, all three searches, person and character credits, seasons, and genres.
