# Private Palace role model

Discord stores the server's roles and channel overwrites separately from the
bot source. Server configuration should follow this order below Hikari:
**Palace Guardian → Event Host → Palace Member → cosmetic interest roles**.
The owner and Hikari retain their existing administrative access.

| Role | Access and powers |
| --- | --- |
| New arrival / @everyone | Read welcome and rules; no lounge, invitations, or staff access |
| Palace Member | Club chat and media, public threads, native polls, voice, streaming, emotes, soundboard, and voice activities |
| Event Host | Member access plus event creation/management and announcement posting; no staff-room access |
| Palace Guardian | Member and staff access, warnings/timeouts, message/thread moderation, audit-case viewing, and voice moderation |
| Interest, genre, and sub/dub roles | Cosmetic only; no membership access or staff permissions |

Guardians do not receive Administrator, Manage Server, Manage Roles, Manage
Channels, Ban Members, or Kick Members. Owner/admins control membership,
invitations, role management, bans/kicks, and server configuration. The host and
guardian roles each include club access; no extra member role is needed.

Rules, welcome, schedules, news, role menus, and archived conversations are
read-only. Event Hosts and Guardians may post announcements. Staff chat is
hidden from members and hosts; staff logs are read-only for Guardians, including
no deletion of log messages. Role-menu options must exclude membership and
staff roles, remain below Hikari, and have no permission bits.
Hikari also refreshes roles when a menu is used and blocks self-service changes
to roles with moderation, event-management, invitation, or other staff powers.
An older cosmetic menu cannot keep granting a role after its permissions change.

Discord prevents a bot from editing roles at or above its highest role. A
server owner must move a legacy role below Hikari before the bot can change it.
Do not work around that hierarchy by granting additional powers to members.
