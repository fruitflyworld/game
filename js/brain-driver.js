// brain-driver.js — cadence + async orchestration between the game loop and a Brain.
// Pure module (no Phaser imports), node-testable.
//
//  - Synchronous brains (model starts with "FFW-") step at exact intervals.
//  - Async brains (remote judgment models) run single-in-flight: one decide()
//    at a time, never blocking the frame loop; results older than maxStaleSec
//    are dropped; an error marks the driver degraded (caller decides fallback).

export function createBrainDriver(opts) {
  const intervalSec = opts.intervalSec || 0.5;
  const maxStaleSec = opts.maxStaleSec || 2.5;
  const brain = opts.brain;
  const isSync = brain.model.startsWith("FFW-");

  let acc = 0;
  let inFlight = false;
  let last = null;
  let degraded = false;
  let simTime = 0; // latest sim time seen in update()

  function onResult(res, stateTime, applyDecision) {
    inFlight = false;
    if (simTime - stateTime > maxStaleSec) return; // stale: drop silently
    degraded = false;
    last = res;
    applyDecision(res);
  }

  return {
    get model() { return brain.model; },
    get degraded() { return degraded; },
    get last() { return last; },

    reset() {
      acc = 0;
      inFlight = false;
      last = null;
      degraded = false;
      if (typeof brain.reset === "function") brain.reset();
    },

    update(now, dt, getState, applyDecision) {
      simTime = now;
      acc += dt;
      if (acc < intervalSec) return;
      acc = 0; // fixed cadence even after frame hitches (no burst catch-up)
      if (inFlight) return;

      const stateTime = now;
      const state = getState();
      inFlight = true;
      brain
        .decide(state)
        .then((res) => onResult(res, stateTime, applyDecision))
        .catch((err) => {
          inFlight = false;
          degraded = true;
          if (opts.onError) opts.onError(err);
        });
    },
  };
}
