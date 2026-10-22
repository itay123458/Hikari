# Hikari Public Hub Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline.

**Goal:** Publish Hikari's invite, source, and custom public bot dashboard.
**Architecture:** Static HTML/CSS/modules in `site/`, a generated public command
catalogue, local Blender assets, and a restricted GitHub Pages deployment.
**Tech Stack:** Browser JavaScript, Node 20 build/test utilities, Blender 5.2,
GitHub Actions Pages, optional model-viewer for GLB interaction.
**Spec:** `docs/superpowers/specs/2026-10-22-public-hub.md`.

## Global constraints

- Public hub only; no tokens, private guild data, fake statistics, or admin UI.
- 29 real top-level commands and current anime subcommands.
- Keyboard/mobile access, reduced motion, and a failed-3D fallback.
- Preserve bot data, MIT notices, and existing Pi deployment.

## Tasks

- [x] Generate original Blender scene, poster, GLB, and editable source.
- [x] Add shared public invite/source/site URLs and a generated command catalogue.
- [x] Build overview, searchable/filterable commands, setup, and privacy views.
- [x] Restore Discord source/invite links and update README.
- [x] Verify links, browser interactions, mobile layout, and public-source scan.
- [x] Review, publish repository and Pages, verify deployed URL, and update Pi.

## Verified release

- Public repository: https://github.com/itay123458/Hikari
- Live hub: https://itay123458.github.io/Hikari/
- Implementation: `f9734fc`; Pages run `39845768403` completed successfully.
- Migration/test run `39845768642`: 58 passed, zero failures or skips,
  including real PostgreSQL concurrency checks. Docker Publish also passed.
- Browser checks passed locally and on the published Pages URL: navigation,
  search, filters, clipboard, feature links, four viewport widths (320–1440),
  reduced motion, GLB loading, and zero console errors on the successful path.
- Blocked-viewer and blocked-catalogue checks retain the poster and primary
  invite/source links. Keyboard skip navigation preserves the selected view.
- axe-core 4.10.3 reported no WCAG A/AA violations across the four views.
- Reviewed Git history and current publishable files for credential patterns;
  no matches. Pages contains only the eight public files under `site/`.
- Pi image rebuilt and bot restarted. Readiness and Docker health passed;
  PostgreSQL remains persistent and not degraded; 29 commands registered.
  A live Discord REST check confirmed the application is public and the
  running help menu exposes invite, source, and hub links.
