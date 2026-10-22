# Hikari on Raspberry Pi

Use a separate checkout at `/opt/hikari` and Hikari's own Discord application,
PostgreSQL credentials and data. Do not copy credentials from another bot.

The Pi override sets the Compose project to `hikari` and uses `hikari-bot`,
`hikari-db` and `hikari-lavalink` container names. The network and PostgreSQL
volume are scoped to this project. The optional local Lavalink profile stays off.

## Private environment

Keep `.env` out of Git and set its permissions to `600`. Start from
`.env.example`, then configure:

- `DISCORD_TOKEN`: Hikari's own bot token.
- `CLIENT_ID`: that application's ID.
- `GUILD_ID`: your server ID (optional tutorial setting).
- `ANIMESCHEDULE_TOKEN`: application token for episode schedules.
- `POSTGRES_DB=hikari`, `POSTGRES_USER=hikari` and a unique
  `POSTGRES_PASSWORD`. The prepared `.env` already has a generated password.
- `PORT=3004` to keep Hikari's host health port separate from the other bots.

Compose sets the container's internal web port and its PostgreSQL connection
to this project's `db` service. Do not point it at another bot's database.
Discord and AnimeSchedule secrets must be filled privately on the Pi; an empty
Discord token means the prepared installation must not be started yet.

## Validate and start

```sh
cd /opt/hikari
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.pi.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.pi.yml ps
curl --fail http://127.0.0.1:3004/health
curl --fail http://127.0.0.1:3004/ready
```

`config --quiet` validates without printing expanded secrets. The existing bot
startup creates the additive schema automatically. Configure anime modules and
channels using `/anime admin` after Discord login. See [anime setup](ANIME.md)
for provider limitations, consent and notification behavior.

## Update

```sh
cd /opt/hikari
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.pi.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build
curl --fail http://127.0.0.1:3004/ready
```

The ignored `.env` persists across Git updates. Back up this project's database
before changing a running installation. Do not run Compose down with `--volumes`
unless intentionally deleting Hikari's data.
