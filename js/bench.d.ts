// bench.d.ts — types for the exam room module (bench.js).
export interface BenchGenResult {
  gen: number;
  eggs: number;
  rivalEggs: number;
  survived: boolean;
  deathReason: string;
  decisions: number;
  logHash: string;
  calib?: Calibration;
}

export interface CalibrationBucket {
  n: number;
  deaths: number;
}

export interface Calibration {
  K: number;
  buckets: CalibrationBucket[];
  brier: number | null;
  n: number;
}

export interface BenchResult {
  ts: number;
  seed: number;
  brain: string;
  gens: number;
  identical: boolean;
  eggsTotal: number;
  decisions: number;
  elapsedMs: number;
  calibration?: Calibration;
  runA: BenchGenResult[];
  runB: BenchGenResult[];
}

export interface Beacon {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  seed: number;
  ts: number;
}

export function calibrateDeaths(
  log: Array<Record<string, unknown>>,
  died: boolean,
  finalTimeLeft: number,
  K?: number
): Calibration;

export function runBench(
  scene: unknown,
  opts?: { seed?: number | string; brain?: string; gens?: number }
): Promise<BenchResult>;

export function renderBenchReport(r: BenchResult, beacon?: Beacon | null): HTMLElement;
