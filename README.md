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
2. **WASD** — move (camera-relative strafe).
3. **Mouse** — look around.
4. **Space** — jump (or bob up while swimming).
5. Collect **bananas** by walking into them.
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
| W / A / S / D | Forward / left / back / right |
| Space | Jump |
| E | Open/close shop (near vendor) |
| Mouse | Look |
| Esc | Release mouse |

## Stack

- Vite + TypeScript
- three (WebGL)
