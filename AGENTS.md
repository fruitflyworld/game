# AGENTS.md — rules for AI agents editing this repo

## Two kinds of change

1. **FEEL** (free): visuals, sound, UI, HUD, onboarding text, camera, particles,
   screen shake, tutorials. Must not change what happens in a run.
2. **WORLD** (versioned): anything that can change a run's outcome —
   food values, spawn logic, predator speed or behavior, metabolism,
   timing, drafts, slow-motion that changes dt, any extra `rng()` call.
   If you make a WORLD change you MUST:
   - bump `WORLD_VERSION` in `js/sim.js`
   - regenerate golden runs and explain why in `CHANGELOG.md`

## Never do

- Change pinned numbers in `js/sim.js`, `js/gf-neuron.js`, `js/cx-circuit.js`
  (escape assay 100/68, CX trace 9fb9e0d0, drafts 0f4d39c3).
- Call `rng()` for visual effects. Use a separate visual random source
  (e.g. `Math.random` is acceptable **only** in code paths that never touch
  the simulation — particles, cosmetic jitter).
- Read game rules from sprites or other render objects.

## Before you finish

- Run the tests (`node --test`).
- Open `?bench=1&seed=42&brain=circuit&gens=2` — it must print **IDENTICAL**.
- Compare against golden runs. If they changed and this was not a
  WORLD change, you broke something: revert.

## Source of truth

- Feel and rendering: this repo.
- World rules and numbers: [fruitflyworld/sim](https://github.com/fruitflyworld/sim).
  Exam protocol: [fruitflyworld/bench](https://github.com/fruitflyworld/bench).
- Changes here are synced into
  [fruitflyworld/fruit-fly-world](https://github.com/fruitflyworld/fruit-fly-world)
  `public/play/`. Say so in the PR description.

## Pull requests

- One theme per PR. Small diffs. Explain why, not only what.
- Label: `feel` or `world-change`.
