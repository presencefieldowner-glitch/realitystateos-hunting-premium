# RealityStateOS Hunting

Single-file animated hunt/tracking scene for RealityStateOS (module `RT-HUNT-001-2026`).

- `index.html` is the whole app. Open it in a browser, no build step or external assets.
- Canvas 2D at 1900x1069: layered mountains, rippling lake, deer with walk cycles, swaying trees and grass, god rays, bloom, grain, and a tracking HUD.
- Quality adapts automatically (HIGH, MED, LITE) to hold the frame rate on phones; the QUALITY button overrides it.
- Runs a `self_test` on load (SHA-256 vectors and noise checks) and chains a SHA-256 audit stamp once per second.
- `docs/photoreal-rendering-research.md` is the research behind the planned WebGL2 upgrade for photographic realism, with a prioritized implementation plan.
