<div align="center">
  <h1>fruitflyworld / game</h1>
  <p><strong>A fruit fly with a slot for a brain, in a dish that wants it dead.</strong></p>
  <p>
    <a href="https://fruitfly.world/play"><strong>▶ PLAY</strong></a> ·
    <a href="https://fruitflyworld/play?bench=1&seed=42&brain=judgment&gens=2">the exam room</a> ·
    <a href="https://fruitfly.world/essay">the essay</a>
  </p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-baff35" alt="MIT"></a>
    <a href="../../actions/workflows/ci.yml"><img src="https://github.com/fruitflyworld/game/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <img src="https://img.shields.io/badge/build%20step-none-10b981" alt="no build step">
  </p>
</div>

---

**[Play it live at fruitfly.world/play](https://fruitfly.world/play)** — or run the exact same
files from this repository locally (see below). No install, no account, no wallet.

## The game

A single-player lineage roguelite. Each generation lasts up to 50 seconds. You forage in a
dish where food carries three risk levels — sugar (+12, safe), yeast (+26, on the rim of the
predator's range), rot (+38, but it exposes you for six seconds) — while a predator hunts by
vision and commits to a ballistic lunge you can read. Energy above a threshold becomes eggs.
At generation's end you compare eggs with the wild type and draft one mutation for the next
fly. Death ends a generation, not the lineage.

## The twist: you pick the brain, the brain flies

| Brain | What it is |
| --- | --- |
| `manual` | You drive (WASD / drag). The baseline every other brain is measured against. |
| `genes` | The wild type's auto-pilot: fixed gene weights steering by the same signals. |
| `circuit` | **FFW-CX/0.1** — a 24-neuron spiking circuit, connectome-inspired, firing at 10 Hz. |
| `judgment` | A System One judgment model in the slot. Free local heuristic by default; with a key it runs a pinned `jev-1.13.0` through a same-origin proxy, with visible fallback. |

The escape reflex is not pluggable: underneath every brain sits the **LC4/LPLC2 → Giant
Fiber** circuit — the command cell for the escape jump in the real fruit fly, here a leaky
integrate-and-fire module. **The brain chooses; the brainstem jumps.** With real
connectivity the fly escapes 100% of telegraphed lunges; with shuffled connectivity, 68%.
That control experiment ships in the menu.

Every decision from every brain is sealed with a content hash into a downloadable log.
Press `?bench=1` for the [exam room](https://github.com/fruitflyworld/bench): the same
`(seed, brain, generations)` run twice at a fixed 60 Hz — bit-identical runs print
**IDENTICAL**; anything else is a bug report, not a score.

## Run it locally

No build step — the files the browser loads are the files in this repository:

```sh
git clone https://github.com/fruitflyworld/game
cd game
python3 -m http.server 8080   # or: npx serve .
# open http://localhost:8080
```

## Layout

```
index.html          entry — loads Phaser (vendored, MIT) and js/main.js
style.css           game + exam-room UI
vendor/phaser.min.js
js/
  sim.js            the dish world: seeded RNG, mutation drafts, escape assay
  gf-neuron.js      the brainstem: LC4/LPLC2 → Giant Fiber LIF escape circuit
  cx-circuit.js     FFW-CX/0.1, 24 spiking neurons
  brain*.js         the brain contract + four implementations + the metronome
  bench.js          the exam room harness (double-run, calibration)
  scene-boot.js     menu, brain selection, control experiment
  scene-game.js     the dish: foraging, predator, generations, brains, replay
  ui.js / audio.js  HUD, drafts, i18n (en/zh), sound
```

The simulation core and the brain modules are the
[`fruitflyworld/sim`](https://github.com/fruitflyworld/sim) repository, vendored here so the
game stays a drop-in static bundle. The exam harness is
[`fruitflyworld/bench`](https://github.com/fruitflyworld/bench), vendored for the same
reason. The canonical versions live in those repositories; changes land there first.

Two site features degrade gracefully when the game runs standalone: the Jev proxy and the
beacon seed endpoint are same-origin services of fruitfly.world — without them the judgment
brain uses its local heuristic and `?seed=beacon` falls back to seed 42.

## Honest boundaries

The world model is **connectome-inspired**. It is not a simulation of a real fly brain, not
a FlyWire or MaleCNS runtime, and not a claim about animal behavior.

## License

MIT © 2026 Fruit Fly World — including the vendored
[Phaser](https://github.com/phaserjs/phaser), which carries its own MIT notice in
`vendor/phaser.min.js`.
