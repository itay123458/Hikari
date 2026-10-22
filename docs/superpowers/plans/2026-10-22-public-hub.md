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
- [ ] Review, publish repository and Pages, verify deployed URL, and update Pi.
