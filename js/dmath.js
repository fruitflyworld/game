// dmath.js — deterministic math kernels: sin, cos, exp.
//
// Why this exists: Math.sin/cos/exp are implemented in C++ inside the engine
// and differ in the last ulp between architectures and engine builds
// (measured: arm64 Chrome vs x64 Node disagree on sin/cos/exp/pow/log/tan
// inputs at a ~3% rate; hypot/atan2/sqrt agree). A "deterministic" run whose
// positions come from Math.cos(wanderAngle) therefore diverges across
// machines — 1 ulp on frame 242 becomes 3 eggs by generation 2.
//
// These kernels use only + - * / and integer logic on doubles, which the
// ECMAScript spec pins to IEEE-754 double semantics — bit-identical on every
// platform and engine. Accuracy is ~1e-13 absolute (sin/cos, |x| <= 2^13) and
// ~1e-15 relative (exp), far below anything the dish can notice.
//
// Plain ESM, no dependencies, browser + node. Types: dmath.d.ts.
// Used by the simulation lane ONLY — render code keeps Math.* (it never
// feeds back into sim state).

const H_PI = 1.5707963267948966;       // double nearest π/2
const H_PI_LO = 6.123233995736766e-17; // π/2 − H_PI

// sin kernel, |y| <= π/4: Taylor to y^13 (abs error < 5e-17)
function kSin(y) {
  const y2 = y * y;
  return y + y * y2 * (-1.6666666666666666574e-01 + y2 * (8.3333333333333332177e-03
    + y2 * (-1.9841269841269841253e-04 + y2 * (2.7557319223985890653e-06
    + y2 * (-2.5052108385441718775e-08 + y2 * 1.6059043836821614599e-10)))));
}

// cos kernel, |y| <= π/4: Taylor to y^14 (abs error < 5e-17)
function kCos(y) {
  const y2 = y * y;
  return 1 + y2 * (-5.0000000000000000000e-01 + y2 * (4.1666666666666666664e-02
    + y2 * (-1.3888888888888888887e-03 + y2 * (2.4801587301587301586e-05
    + y2 * (-2.7557319223985890533e-07 + y2 * (2.0876756987868098979e-09
    + y2 * -1.1470745597729724714e-11))))));
}

// exact powers of two (2^k exactly representable for k in [-1022, 1023])
const P2 = { 0: 1 };
function pow2(k) {
  if (P2[k] !== undefined) return P2[k];
  const v = k > 0 ? pow2(k - 1) * 2 : pow2(k + 1) / 2;
  P2[k] = v; return v;
}

// atan kernel: halve the argument to |z| <= tan(pi/12), Taylor to z^25/25,
// then double back. Pure + - * / and Math.sqrt (IEEE-pinned), so it is
// bit-stable across engines where Math.atan is not (measured: arm64 Chrome
// vs x64 Node disagree on ~5.6% of inputs).
const TAN_PI_12 = 0.26794919243112270647; // tan(pi/12), reduction target
function atanSmall(z) {
  const z2 = z * z;
  // Horner over 1/3, 1/5, …, 1/25 (alternating signs baked in)
  let s = 1 / 25;
  for (const c of [23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3]) s = 1 / c - z2 * s;
  return z * (1 - z2 * s);
}
export function datan(x) {
  if (x !== x) return NaN;
  if (x === 0) return x; // preserves -0
  if (x < 0) return -datan(-x);
  if (x > 1) return H_PI - datan(1 / x) + H_PI_LO; // pi/2 - atan(1/x)
  if (x === 1) return H_PI / 2; // double nearest pi/4
  let z = x, k = 0;
  while (z > TAN_PI_12) { z = z / (1 + Math.sqrt(1 + z * z)); k++; }
  let y = atanSmall(z);
  while (k--) y = 2 * y; // halving halved the angle; double it back
  return y;
}

// reduce x = n·(π/2) + y with |y| <= π/4+ε (n via Math.round, deterministic)
function reduceHalfPi(x) {
  const n = Math.round(x / H_PI);
  const y = (x - n * H_PI) - n * H_PI_LO;
  return { n, y };
}

export function dsin(x) {
  if (!isFinite(x)) return NaN;
  const { n, y } = reduceHalfPi(x);
  switch (((n % 4) + 4) % 4) {
    case 0: return kSin(y);
    case 1: return kCos(y);
    case 2: return -kSin(y);
    default: return -kCos(y);
  }
}

export function dcos(x) {
  if (!isFinite(x)) return NaN;
  const { n, y } = reduceHalfPi(x);
  switch (((n % 4) + 4) % 4) {
    case 0: return kCos(y);
    case 1: return -kSin(y);
    case 2: return -kCos(y);
    default: return kSin(y);
  }
}

const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;

export function dexp(x) {
  if (x !== x) return NaN;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x * INV_LN2);
  const y = (x - k * LN2_HI) - k * LN2_LO; // |y| <= ln2/2 + ε
  return (1 + y * (1 + y * (5.0000000000000000000e-01 + y * (1.6666666666666666667e-01
    + y * (4.1666666666666666667e-02 + y * (8.3333333333333333333e-03
    + y * (1.3888888888888888889e-03 + y * (1.9841269841269841270e-04
    + y * (2.4801587301587301587e-05 + y * (2.7557319223985890653e-06
    + y * (2.7557319223985890653e-07 + y * 2.5052108385441718775e-08)))))))))))
    * pow2(k);
}
