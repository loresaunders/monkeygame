# Monkey Island Survivability

A third-person 3D browser game: play a sunglass-wearing monkey exploring a large tropical jungle island (sandy shores → dense inland canopy), collecting bananas, and shopping at Coco’s beach stand for swimming, a raft, consumables, and access to the gated North Cove.

Built with **Vite**, **TypeScript**, and **Three.js**.

## Play locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default [http://127.0.0.1:43217](http://127.0.0.1:43217)).

Production build:

```bash
npm run build
npm run preview
```

## How to play

1. Click **Enter Island**, then click the canvas to capture the mouse.
2. **Arrow keys** (or **WASD**) — move (camera-relative; Left/Right strafe).
3. **Mouse** — look around.
4. **Space** — jump (clear short crates/stumps, or bob up while swimming).
5. Collect **bananas** by walking into them — short obstacle courses (crates, logs, rocks, gaps) and skirtable props guard many clusters.
6. Find **Coco’s Supply Stand** (beach shack with potions, coconuts, PB&J, water on the counter).
7. Press **E** near Coco to open the shop. Buy:
   - **Swimming Ability** — enter water safely
   - **Build a Raft** — sail the ocean
   - **North Cove Key** — open the gated north peninsula
   - Consumables — sprint, leap, drown-guard, snacks, hydration

Without swim or raft, deep water respawns you on the beach (unless a Jade Guard potion saves you).

## Controls summary

| Key | Action |
| --- | --- |
| ↑ ↓ ← → (or W A S D) | Forward / back / strafe left / strafe right |
| Space | Jump |
| E | Open/close shop (near vendor) |
| O | Overdrive (speed ×2.5 for 5s) |
| Mouse | Look |
| Esc | Release mouse |

## Deploy on Vercel

Static Vite SPA — build output is `dist/`. Config lives in `vercel.json`.

### Dashboard (recommended)

1. Open [vercel.com/new](https://vercel.com/new) and **Import** the Git repo (`multi-player-workshop/genesis`, or this project’s GitHub/Origin remote).
2. Framework preset: **Vite**
3. Build command: `npm run build`
4. Output directory: `dist`
5. Install command: `npm install`
6. Root directory: `.` (repo root — not a monorepo)
7. Deploy. Point Production to branch `main` (or merge `cursor/monkey-island-survivability-ce1d` first).

### CLI

```bash
npm install
npm i -g vercel   # or: npx vercel
vercel login
vercel            # preview deployment
vercel --prod     # production
```

Settings Vercel will pick up from `vercel.json` (framework Vite, build, `dist`, SPA rewrite).

### Local production check

```bash
npm run build
npm run preview
```

## Stack

- Vite + TypeScript
- three (WebGL)
- Hosted as a static site on Vercel
