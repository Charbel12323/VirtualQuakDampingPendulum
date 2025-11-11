import { NextRequest, NextResponse } from "next/server";

// gravity const used everywhere (N/kg)
const G = 9.81;

// material param table - scaling for stiffness, damping, ductility etc.
// not full code-level mechancis, but enough to change behavior realistically
const MATERIALS = {
  Concrete: {
    kFactor: 1.0,
    xi: 0.03,
    yieldStrain: 0.002,
    ultStrain: 0.004,
    ductility: 2.0,
    density: 2400,
  },
  Steel: {
    kFactor: 0.85,
    xi: 0.02,
    yieldStrain: 0.002,
    ultStrain: 0.05,
    ductility: 8.0,
    density: 7850,
  },
  Wood: {
    kFactor: 0.35,
    xi: 0.05,
    yieldStrain: 0.002,
    ultStrain: 0.015,
    ductility: 3.0,
    density: 600,
  },
  Masonry: {
    kFactor: 0.25,
    xi: 0.06,
    yieldStrain: 0.0004,
    ultStrain: 0.0008,
    ductility: 1.1,
    density: 1800,
  },
} as const;

type MaterialKey = keyof typeof MATERIALS;

// structural system knobs: stiffness multipliers, extra damping, etc.
const STRUCTURAL_SYSTEMS = {
  MomentFrame: {
    // base reference
    kMult: 1.0,
    xiAdd: 0.0,
    label: "Moment Frame",
    redundancy: 0.8,
    heightLimit: 30,
    // T1 ≈ C_t * h^0.75, code-ish
    periodCoeff: 0.075,
  },
  BracedFrame: {
    // stiffer
    kMult: 2.0,
    xiAdd: 0.01,
    label: "Braced Frame",
    redundancy: 0.6,
    heightLimit: 40,
    periodCoeff: 0.055,
  },
  ShearWallCore: {
    // even stiffer
    kMult: 3.0,
    xiAdd: 0.02,
    label: "Shear Wall",
    redundancy: 0.5,
    heightLimit: 60,
    periodCoeff: 0.045,
  },
  DualSystem: {
    // in between, more redundancy
    kMult: 2.2,
    xiAdd: 0.015,
    label: "Dual System",
    redundancy: 0.9,
    heightLimit: 100,
    periodCoeff: 0.06,
  },
  UnreinforcedMasonry: {
    // garbage in EQ, keep it clearly bad
    kMult: 0.25,
    xiAdd: 0.0,
    label: "URM (Dangerous!)",
    redundancy: 0.08,
    heightLimit: 10,
    periodCoeff: 0.15,
  },
} as const;

type SystemKey = keyof typeof STRUCTURAL_SYSTEMS;

// site classes same idea as code B/C/D/E
type SiteClass = "B" | "C" | "D" | "E";

// Fa is short-period site factor ~ ASCE7 style
// Eq: SMS = Fa * Ss, SDS = 2/3 * SMS later
function computeFa(site: SiteClass, Ss: number): number {
  if (site === "B") return 1.0;
  if (site === "C") {
    if (Ss <= 0.25) return 1.2;
    if (Ss <= 0.5) return 1.1;
    if (Ss <= 0.75) return 1.0;
    return 1.0;
  }
  if (site === "D") {
    if (Ss <= 0.25) return 1.6;
    if (Ss <= 0.5) return 1.4;
    if (Ss <= 0.75) return 1.2;
    if (Ss <= 1.0) return 1.1;
    return 1.0;
  }
  // site E
  if (Ss <= 0.25) return 2.5;
  if (Ss <= 0.5) return 2.2;
  if (Ss <= 0.75) return 1.9;
  if (Ss <= 1.0) return 1.7;
  return 1.6;
}

// Fv is long-period site factor
// Eq: SM1 = Fv * S1, SD1 = 2/3 * SM1 later
function computeFv(site: SiteClass, S1: number): number {
  if (site === "B") return 1.0;
  if (site === "C") {
    if (S1 <= 0.1) return 1.7;
    if (S1 <= 0.2) return 1.6;
    if (S1 <= 0.3) return 1.5;
    if (S1 <= 0.4) return 1.4;
    return 1.3;
  }
  if (site === "D") {
    if (S1 <= 0.1) return 2.4;
    if (S1 <= 0.2) return 2.0;
    if (S1 <= 0.3) return 1.8;
    if (S1 <= 0.4) return 1.6;
    return 1.5;
  }
  // E
  if (S1 <= 0.1) return 3.5;
  if (S1 <= 0.2) return 3.2;
  if (S1 <= 0.3) return 2.9;
  if (S1 <= 0.4) return 2.6;
  return 2.4;
}

// drift limits per material, used for damage state mapping
const DRIFT_LIMITS_BY_MATERIAL: Record<
  MaterialKey,
  { Slight: number; Moderate: number; Extensive: number; Complete: number }
> = {
  Steel: {
    Slight: 0.005,
    Moderate: 0.02,
    Extensive: 0.04,
    Complete: 0.06,
  },
  Concrete: {
    Slight: 0.004,
    Moderate: 0.015,
    Extensive: 0.03,
    Complete: 0.05,
  },
  Wood: {
    Slight: 0.004,
    Moderate: 0.012,
    Extensive: 0.022,
    Complete: 0.035,
  },
  Masonry: {
    Slight: 0.001,
    Moderate: 0.003,
    Extensive: 0.006,
    Complete: 0.01,
  },
};

// tiny deterministic RNG so same inputs -> same motion (no chaos between runs)
function createRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// hash ground motion params into a seed so USGS/synthetic waves repeatable
function seedFromParams(
  pgaG: number,
  duration: number,
  freq: number,
  type: string
): number {
  const a = Math.floor(pgaG * 1e4);
  const b = Math.floor(duration * 1e2);
  const c = Math.floor(freq * 1e3);
  let h = 0;
  for (let i = 0; i < type.length; i++) {
    h = (h * 31 + type.charCodeAt(i)) >>> 0;
  }
  return (a ^ (b << 8) ^ (c << 16) ^ h) || 123456;
}

// design base shear calc - rough ASCE7 style
function computeDesignBaseShear(params: {
  Ss: number;
  S1: number;
  siteClass: SiteClass;
  R: number;
  Ie: number;
  T1: number;
  numFloors: number;
  massPerFloor: number;
  storyHeight: number;
}) {
  const {
    Ss,
    S1,
    siteClass,
    R,
    Ie,
    T1,
    numFloors,
    massPerFloor,
    storyHeight,
  } = params;

  const Fa = computeFa(siteClass, Ss);
  const Fv = computeFv(siteClass, S1);

  // Eq: SMS = Fa * Ss
  const SMS = Fa * Ss;
  // Eq: SM1 = Fv * S1
  const SM1 = Fv * S1;

  // Eq: SDS = 2/3 * SMS
  const SDS = (2 / 3) * SMS;
  // Eq: SD1 = 2/3 * SM1
  const SD1 = (2 / 3) * SM1;

  // R/Ie: reduce for ductility, scale for importance
  const denom = Math.max(0.01, R / Ie);

  // Eq: Cs ≤ SDS / (R/Ie) and Cs ≤ SD1 / (T * R/Ie)
  // and later bounded and floored to code-ish mins
  let Cs = Math.min(SDS / denom, SD1 / (Math.max(T1, 0.05) * denom));

  // lower bound: Cs ≥ max(0.044*SDS*Ie, 0.01)
  const Cs_lower = Math.max(0.044 * SDS * Ie, 0.01);
  Cs = Math.max(Cs, Cs_lower);

  // upper bound safety clamp
  Cs = Math.min(Cs, 0.5);

  // Eq: W = Σ(Wi) ≈ numFloors * massPerFloor * g
  const W = numFloors * massPerFloor * G;

  // Eq: V = Cs * W  (design base shear)
  const V = Cs * W;

  // simple vertical distrib: Fi ~ Wi * hi
  const weights = Array.from({ length: numFloors }, () => massPerFloor * G);
  const heights = Array.from(
    { length: numFloors },
    (_, i) => (i + 1) * storyHeight
  );
  const sumWh = weights.reduce((s, w, i) => s + w * heights[i], 0);
  const storyShear = heights.map((h, i) => (V * (weights[i] * h)) / sumWh);

  return { Fa, Fv, SMS, SM1, SDS, SD1, Cs, V, W, storyShear };
}

// haversine distance for epicenter-site distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// turn USGS-like input into motion: v simple GMPE-ish
function deriveMotionFromUSGS(usgsEvent: any, siteClass: SiteClass) {
  const { mag, eqLat, eqLon, siteLat, siteLon, depthKm, distanceKm, region } =
    usgsEvent || {};

  let R: number;
  if (typeof distanceKm === "number" && Number.isFinite(distanceKm)) {
    R = Math.max(10, distanceKm);
  } else if (
    typeof eqLat === "number" &&
    typeof eqLon === "number" &&
    typeof siteLat === "number" &&
    typeof siteLon === "number"
  ) {
    R = Math.max(10, haversineKm(eqLat, eqLon, siteLat, siteLon));
  } else if (String(region || "").toLowerCase() === "mexico") {
    R = 80;
  } else {
    R = 50;
  }

  const h =
    typeof depthKm === "number"
      ? depthKm
      : String(region || "").toLowerCase() === "mexico"
      ? 35
      : 10;

  // log10(PGA) = a + b*M - c*log10(sqrt(R^2 + h^2))
  // super crude GMPE shorcut, just want scaling trend
  const a = -1.3;
  const b = 0.65;
  const c = 1.15;

  let pgaG = Math.pow(
    10,
    a + b * mag - c * Math.log10(Math.sqrt(R * R + h * h))
  );

  // site amp factors (soft soil bigger motions)
  const siteAmp =
    siteClass === "E"
      ? 2.2
      : siteClass === "D"
      ? 1.6
      : siteClass === "C"
      ? 1.2
      : 1.0;

  pgaG *= siteAmp;
  // clamp to sane range
  pgaG = Math.min(Math.max(pgaG, 0.05), 2.5);

  // duration scales with M and distance
  const duration = Math.min(Math.max(8 + 5 * (mag - 5) + 0.03 * R, 10), 80);

  // base freq shift by magnitude (bigger M -> longer content)
  const baseFreq = 2.0 - 0.18 * (mag - 5);
  // siteShift shifts toward lower freq for softer sites
  const siteShift =
    siteClass === "E"
      ? -0.5
      : siteClass === "D"
      ? -0.3
      : siteClass === "C"
      ? -0.1
      : 0.15;

  const freqHz = Math.min(
    Math.max(baseFreq + siteShift, 0.15),
    4.0
  );

  return { pgaG, duration, freqHz };
}

// per-story stiffness so that first mode T1 approx matches T1_target
// Eq: T1_target = C_t * H^0.75
// Eq: ω1 = 2π / T1_target
// Eq: kBase from shear building approx using mode shape factor
function calculateStoryStiffness(
  floorIndex: number,
  totalFloors: number,
  material: MaterialKey,
  system: SystemKey,
  massPerFloor: number,
  storyHeight: number,
  buildingWidth: number
): number {
  const mat = MATERIALS[material];
  const sys = STRUCTURAL_SYSTEMS[system];

  const H = totalFloors * storyHeight;
  const T1_target = sys.periodCoeff * Math.pow(H, 0.75);
  const w1 = (2 * Math.PI) / Math.max(T1_target, 0.05);

  // first mode factor for equal story shear building (simple approx)
  const modeFactor =
    4 * Math.pow(Math.sin(Math.PI / (4 * totalFloors + 2)), 2) || 1e-6;

  // target base stiffness k so that ω1^2 ~ k / (m * modeFactor)
  const kBase = (w1 * w1 * massPerFloor) / modeFactor;

  const matFactor = mat.kFactor;
  const sysFactor = sys.kMult;

  // small stiffness pattern: softer at bottom, slightly stiffer at top
  let heightFactor = 1.0;
  if (floorIndex === 0) {
    heightFactor = 0.7;
  } else if (floorIndex < totalFloors * 0.2) {
    const r = floorIndex / (totalFloors * 0.2);
    heightFactor = 0.7 + 0.3 * r;
  } else if (floorIndex < totalFloors * 0.5) {
    heightFactor = 1.0;
  } else {
    heightFactor = 1.1;
  }

  // heavier sys -> a bit stiffer (not super physical but ok for this toy)
  const massScale = Math.pow(massPerFloor / 50000, 0.25);

  const k = kBase * matFactor * sysFactor * heightFactor * massScale;

  return Math.max(k, 1e4);
}

enum DamageStateEnum {
  None = "None",
  Slight = "Slight",
  Moderate = "Moderate",
  Extensive = "Extensive",
  Complete = "Complete",
}

// drift-based nonlinear story spring
// uses yield drift from material, caps, cyclic degradation and simple hardening
class NonlinearSpring {
  private k0: number;
  private fy: number;
  private yieldDisp: number;
  private ultDisp: number;
  private currentK: number;
  private maxDisp = 0;
  private failed = false;
  private matKey: MaterialKey;
  private cycleCount = 0;
  private previousDisp = 0;

  constructor(k: number, mass: number, material: MaterialKey, storyHeight: number) {
    this.k0 = k;
    this.currentK = k;
    this.matKey = material;

    const limits = DRIFT_LIMITS_BY_MATERIAL[material];
    const matProps = MATERIALS[material];

    // using yieldStrain * h as yield drift approx
    const yieldDrift = matProps.yieldStrain;
    let ultDrift = limits.Complete;

    // more brittle tweak for masonry/wood
    if (material === "Masonry") {
      ultDrift = limits.Complete * 0.8;
    } else if (material === "Wood") {
      ultDrift = limits.Complete * 0.9;
    }

    this.yieldDisp = Math.max(1e-5, yieldDrift * storyHeight);
    this.ultDisp = Math.max(this.yieldDisp * 1.2, ultDrift * storyHeight);

    // axial load effect: more P -> reduce effective yield
    const axialLoad = mass * G;

    let axialReductionFactor: number;
    if (material === "Masonry") {
      axialReductionFactor = 1.0 / (1.0 + axialLoad / 1e7);
    } else if (material === "Wood") {
      axialReductionFactor = 1.0 / (1.0 + axialLoad / 2e7);
    } else {
      axialReductionFactor = 1.0 / (1.0 + axialLoad / 5e7);
    }

    // Eq: Fy = k * δ_y * reduction
    this.fy = this.yieldDisp * k * axialReductionFactor;
  }

  getForce(disp: number): number {
    const absDisp = Math.abs(disp);
    this.maxDisp = Math.max(this.maxDisp, absDisp);

    // crude cycle counting: sign changes at non-trivial disp
    if (Math.sign(disp) !== Math.sign(this.previousDisp) && Math.abs(disp) > 0.001) {
      this.cycleCount++;
    }
    this.previousDisp = disp;

    // if exceed ultimate, drop to residual stiffness
    if (absDisp >= this.ultDisp) {
      this.failed = true;
      this.currentK = this.k0 * 0.01;
      return Math.sign(disp) * this.fy * 0.05;
    }

    // cyclic stiffness degradation: worse for masonry, better for steel
    let cyclicDegradation = 1.0;
    if (this.matKey === "Masonry") {
      cyclicDegradation = Math.max(0.3, 1.0 - this.cycleCount * 0.08);
    } else if (this.matKey === "Wood") {
      cyclicDegradation = Math.max(0.5, 1.0 - this.cycleCount * 0.04);
    } else if (this.matKey === "Concrete") {
      cyclicDegradation = Math.max(0.7, 1.0 - this.cycleCount * 0.02);
    } else {
      cyclicDegradation = Math.max(0.8, 1.0 - this.cycleCount * 0.01);
    }

    // elastic range
    if (absDisp <= this.yieldDisp) {
      this.currentK = this.k0 * cyclicDegradation;
      return this.k0 * cyclicDegradation * disp;
    }

    // plastic range: bilinear with hardening/softening
    const ductile = this.matKey === "Steel" || this.matKey === "Concrete";
    const brittle = this.matKey === "Masonry";

    let hardeningRatio: number;
    if (ductile) hardeningRatio = 0.05;
    else if (brittle) hardeningRatio = -0.02;
    else hardeningRatio = 0.02;

    const plasticK = this.k0 * hardeningRatio * cyclicDegradation;
    this.currentK = Math.max(plasticK, this.k0 * 0.01);

    const elasticForce = Math.sign(disp) * this.fy * cyclicDegradation;
    const plasticForce =
      plasticK * (absDisp - this.yieldDisp) * Math.sign(disp);

    return elasticForce + plasticForce;
  }

  getTangentStiffness(): number {
    return this.failed ? this.k0 * 0.01 : this.currentK;
  }

  getDamageRatio(): number {
    return Math.min(1.0, this.maxDisp / this.ultDisp);
  }

  hasFailed(): boolean {
    return this.failed;
  }
}

// assemble M, C, K and springs
function buildMCK(
  numFloors: number,
  matKey: MaterialKey,
  sysKey: SystemKey,
  massPerFloor: number,
  storyHeight: number,
  buildingWidth: number,
  baseIsolated: boolean,
  extraDamping: number
) {
  const mat = MATERIALS[matKey];
  const sys = STRUCTURAL_SYSTEMS[sysKey];

  const springs: NonlinearSpring[] = [];
  for (let i = 0; i < numFloors; i++) {
    const k = calculateStoryStiffness(
      i,
      numFloors,
      matKey,
      sysKey,
      massPerFloor,
      storyHeight,
      buildingWidth
    );
    // each spring mass ~ floors above (very rough)
    springs.push(
      new NonlinearSpring(
        k,
        massPerFloor * (numFloors - i),
        matKey,
        storyHeight
      )
    );
  }

  // M: lumped mass per floor on diagonal
  const M: number[][] = Array.from({ length: numFloors }, (_, i) =>
    Array.from({ length: numFloors }, (_, j) => (i === j ? massPerFloor : 0))
  );

  // K gets recomputed from springs, init as zeros
  const K: number[][] = Array.from({ length: numFloors }, () =>
    Array(numFloors).fill(0)
  );

  for (let i = 0; i < numFloors; i++) {
    const k = springs[i].getTangentStiffness();

    if (i === 0) {
      // base floor
      if (baseIsolated) {
        // base isolation = softer effective base
        const kIso = k * 0.1;
        K[i][i] = kIso + (numFloors > 1 ? k : 0);
        if (numFloors > 1) K[i][i + 1] = -k;
      } else {
        K[i][i] = numFloors > 1 ? 2 * k : k;
        if (numFloors > 1) K[i][i + 1] = -k;
      }
    } else if (i === numFloors - 1) {
      // roof
      K[i][i] = k;
      K[i][i - 1] = -k;
    } else {
      // mid floors: k below + k above
      const kAbove = springs[i + 1].getTangentStiffness();
      K[i][i] = k + kAbove;
      K[i][i - 1] = -k;
      K[i][i + 1] = -kAbove;
    }
  }

  // total damping = material xi + system xi + user extra, capped
  const xiTotal = Math.min(0.3, mat.xi + sys.xiAdd + extraDamping);

  // estimate T1 (again) for damping matrix
  const H = numFloors * storyHeight;
  const T1 = sys.periodCoeff * Math.pow(H, 0.75);

  const w1 = (2 * Math.PI) / Math.max(T1, 0.05);
  const w2 = w1 * 3;

  // Rayleigh damping: C = a0*M + a1*K
  // choose a0,a1 to match xi at w1,w2
  const a0 = (xiTotal * 2 * w1 * w2) / (w1 + w2);
  const a1 = (xiTotal * 2) / (w1 + w2);

  const C: number[][] = Array.from({ length: numFloors }, (_, i) =>
    Array.from(
      { length: numFloors },
      (_, j) => a0 * M[i][j] + a1 * K[i][j]
    )
  );

  return { M, C, K, springs, xiTotal, T1 };
}

// nonlinear time history with Newmark-beta (γ=0.5, β=0.25)
// Eq of motion: M ü + C u̇ + f_spring(u) = -M 1 ag
function nonlinearTimeHistory(
  M: number[][],
  C: number[][],
  _K_initial: number[][],
  springs: NonlinearSpring[],
  ag: number[],
  dt: number,
  material: MaterialKey
) {
  const dof = M.length;
  const n = ag.length;

  const u: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const v: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const acc: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const collapseTime: number[] = Array(dof).fill(-1);

  if (n > 0) {
    // initial: u=0, v=0, so absolute accel = -ag
    for (let i = 0; i < dof; i++) {
      acc[0][i] = -ag[0];
    }
  }

  const driftHistory: number[][] = Array.from({ length: n }, () =>
    Array(dof).fill(0)
  );

  const beta = 0.25;
  const gamma = 0.5;

  for (let step = 1; step < n; step++) {
    const uPrev = u[step - 1];
    const vPrev = v[step - 1];
    const aPrev = acc[step - 1];

    const K: number[][] = Array.from({ length: dof }, () =>
      Array(dof).fill(0)
    );

    // update springs with previous step drift, track failures
    for (let i = 0; i < dof; i++) {
      const drift = i === 0 ? uPrev[i] : uPrev[i] - uPrev[i - 1];
      springs[i].getForce(drift);
      if (springs[i].hasFailed() && collapseTime[i] === -1) {
        collapseTime[i] = step * dt;
      }
    }

    // rebuild tangent K from springs
    for (let i = 0; i < dof; i++) {
      const k = springs[i].getTangentStiffness();
      if (i === 0) {
        if (dof > 1) {
          const k2 = springs[1].getTangentStiffness();
          K[0][0] = k + k2;
          K[0][1] = -k2;
        } else {
          K[0][0] = k;
        }
      } else if (i === dof - 1) {
        K[i][i] = k;
        K[i][i - 1] = -k;
      } else {
        const k2 = springs[i + 1].getTangentStiffness();
        K[i][i] = k + k2;
        K[i][i - 1] = -k;
        K[i][i + 1] = -k2;
      }
    }

    // Newmark constants
    const a0 = 1 / (beta * dt * dt);
    const a1 = gamma / (beta * dt);
    const a2 = 1 / (beta * dt);
    const a3 = 1 / (2 * beta) - 1;
    const a4 = gamma / beta - 1;
    const a5 = dt * (gamma / (2 * beta) - 1);

    // Eq: K_eff = K + a0*M + a1*C
    const K_eff: number[][] = Array.from({ length: dof }, (_, i) =>
      Array.from(
        { length: dof },
        (_, j) => K[i][j] + a0 * M[i][j] + a1 * C[i][j]
      )
    );

    try {
      // quick singular check, if too soft -> bail and freeze
      const diagSum = K_eff.reduce(
        (sum, row, i) => sum + Math.abs(row[i]),
        0
      );
      const avgDiag = diagSum / dof;

      if (avgDiag < 1e3) {
        for (let t = step; t < n; t++) {
          u[t] = u[step - 1].slice();
          acc[t] = Array(dof).fill(0);
          v[t] = Array(dof).fill(0);
          driftHistory[t] = driftHistory[step - 1].slice();
        }
        break;
      }

      const K_eff_inv = invertMatrix(K_eff);
      const ones = Array(dof).fill(1);

      // Eq: p_eff = -M * 1 * ag + M*(a0*uPrev + a2*vPrev + a3*aPrev) + C*(a1*uPrev + a4*vPrev + a5*aPrev)
      const term1 = matVec(M, vecScale(ones, -ag[step]));
      const term2 = matVec(
        M,
        vecAdd(
          vecAdd(vecScale(uPrev, a0), vecScale(vPrev, a2)),
          vecScale(aPrev, a3)
        )
      );
      const term3 = matVec(
        C,
        vecAdd(
          vecAdd(vecScale(uPrev, a1), vecScale(vPrev, a4)),
          vecScale(aPrev, a5)
        )
      );

      const pEff = vecAdd(vecAdd(term1, term2), term3);

      // solve K_eff * uNow = pEff
      const uNow = matVec(K_eff_inv, pEff);

      const maxDispThis = Math.max(...uNow.map((v) => Math.abs(v)));
      const maxDispPrev = Math.max(...uPrev.map((v) => Math.abs(v)));

      // crude blow-up guard
      if (
        maxDispThis > 10.0 ||
        (maxDispPrev > 0.001 && maxDispThis > maxDispPrev * 50)
      ) {
        for (let t = step; t < n; t++) {
          u[t] = uPrev.slice();
          acc[t] = Array(dof).fill(0);
          v[t] = Array(dof).fill(0);
          driftHistory[t] = driftHistory[step - 1].slice();
        }
        break;
      }

      // if story failed, cap displacement (pretend pancake but bounded)
      for (let i = 0; i < dof; i++) {
        if (springs[i].hasFailed()) {
          const maxCollapsedDisp = 0.1;
          uNow[i] =
            Math.sign(uNow[i]) *
            Math.min(Math.abs(uNow[i]), maxCollapsedDisp);
        }
      }

      u[step] = uNow;

      // Newmark accel update
      // Eq: aNow = a0*(uNow - uPrev) - a2*vPrev - a3*aPrev
      const du = vecSub(uNow, uPrev);
      const aNow = vecAdd(
        vecSub(vecScale(du, a0), vecScale(vPrev, a2)),
        vecScale(aPrev, -a3)
      );

      // clamp insane accel
      for (let i = 0; i < dof; i++) {
        const maxAccel = 50 * G;
        aNow[i] = Math.max(-maxAccel, Math.min(maxAccel, aNow[i]));
      }
      acc[step] = aNow;

      // Newmark vel update
      // Eq: vNow = vPrev + dt * ((1-γ)*aPrev + γ*aNow)
      const vNow = vecAdd(
        vPrev,
        vecScale(
          vecAdd(
            vecScale(aPrev, 1 - gamma),
            vecScale(aNow, gamma)
          ),
          dt
        )
      );
      for (let i = 0; i < dof; i++) {
        const maxVel = 20.0;
        vNow[i] = Math.max(-maxVel, Math.min(maxVel, vNow[i]));
      }
      v[step] = vNow;

      // track story drifts for output
      for (let i = 0; i < dof; i++) {
        driftHistory[step][i] =
          i === 0 ? uNow[i] : uNow[i] - uNow[i - 1];
      }
    } catch {
      // if matrix inversion fails, freeze state from last stable step
      for (let t = step; t < n; t++) {
        u[t] = u[step - 1].slice();
        acc[t] = Array(dof).fill(0);
        v[t] = Array(dof).fill(0);
      }
      break;
    }
  }

  return {
    u,
    v,
    a: acc,
    springs,
    collapseTime,
    driftHistory,
  };
}

// simple soft-story flag: drift way bigger than avg
function findSoftStory(floorDamage: any[]): number {
  const drifts = floorDamage.map((f) => f.maxDrift);
  const avgDrift = drifts.reduce((a, b) => a + b, 0) / (drifts.length || 1);
  let maxRatio = 0;
  let idx = -1;
  for (let i = 0; i < drifts.length; i++) {
    const ratio = drifts[i] / (avgDrift || 1e-6);
    if (ratio > 1.5 && ratio > maxRatio) {
      maxRatio = ratio;
      idx = i;
    }
  }
  return idx;
}

// drift + accel → damage state + progressive collapse rules
function assessDamage(
  u: number[][],
  a: number[][],
  springs: NonlinearSpring[],
  storyHeight: number,
  material: MaterialKey,
  collapseTime: number[],
  massPerFloor: number
) {
  const n = u.length;
  const dof = u[0]?.length || 0;

  const floorDamage: any[] = [];
  const DRIFT_LIMITS = DRIFT_LIMITS_BY_MATERIAL[material];

  for (let i = 0; i < dof; i++) {
    let maxDisp = 0;
    let maxDrift = 0;
    let maxAccel = 0;

    for (let t = 0; t < n; t++) {
      const ui = u[t][i];
      maxDisp = Math.max(maxDisp, Math.abs(ui));
      maxAccel = Math.max(maxAccel, Math.abs(a[t][i]));
      const drift =
        i === 0
          ? Math.abs(ui) / storyHeight
          : Math.abs(ui - u[t][i - 1]) / storyHeight;
      maxDrift = Math.max(maxDrift, drift);
    }

    let damageState: DamageStateEnum = DamageStateEnum.None;
    let repairCost = 0;

    // drift thresholds map to damage state (toy curve)
    if (maxDrift < DRIFT_LIMITS.Slight) {
      damageState = DamageStateEnum.None;
      repairCost = 0;
    } else if (maxDrift < DRIFT_LIMITS.Moderate) {
      damageState = DamageStateEnum.Slight;
      repairCost = 5;
    } else if (maxDrift < DRIFT_LIMITS.Extensive) {
      damageState = DamageStateEnum.Moderate;
      repairCost = 25;
    } else if (maxDrift < DRIFT_LIMITS.Complete) {
      damageState = DamageStateEnum.Extensive;
      repairCost = 60;
    } else {
      damageState = DamageStateEnum.Complete;
      repairCost = 100;
    }

    const damageRatio = springs[i].getDamageRatio();
    const collapsed = springs[i].hasFailed();

    if (collapsed) {
      damageState = DamageStateEnum.Complete;
      repairCost = 100;
    }

    // high accel can still trigger some damage
    const accelG = maxAccel / G;
    if (accelG > 3.0 && damageState === DamageStateEnum.None) {
      damageState = DamageStateEnum.Slight;
      repairCost = Math.max(repairCost, 5);
    }

    floorDamage.push({
      floor: i + 1,
      maxDisp,
      maxDrift,
      maxAccel: accelG,
      damageState,
      damageRatio,
      collapsed,
      collapseTime: collapseTime[i],
      repairCost,
    });
  }

  // check collapse sequences
  const collapsedIdx = floorDamage
    .map((f, i) => (f.collapsed ? i : -1))
    .filter((i: number) => i >= 0);

  let collapseBaseFloor: number | null = null;

  if (collapsedIdx.length > 0) {
    const dofCount = dof;
    const lowestCollapsed = Math.min(...collapsedIdx);
    collapseBaseFloor = lowestCollapsed + 1;

    // if ground floor fails, pancake everything
    if (floorDamage[0].collapsed) {
      for (let i = 0; i < dofCount; i++) {
        const fd = floorDamage[i];
        fd.collapsed = true;
        fd.damageState = DamageStateEnum.Complete;
        fd.repairCost = 100;
        if (fd.collapseTime < 0) {
          fd.collapseTime =
            floorDamage[0].collapseTime > 0
              ? floorDamage[0].collapseTime + i * 0.15
              : -1;
        }
      }
      collapseBaseFloor = 1;
    }
    // mid-height failures can trigger upper collapse depending on brittleness
    else if (lowestCollapsed <= Math.floor(dofCount / 2)) {
      const severeCount = floorDamage.filter(
        (f) =>
          f.damageState === DamageStateEnum.Complete ||
          (f.collapsed && f.damageRatio > 0.7)
      ).length;

      const isBrittleBuilding = material === "Masonry" || material === "Wood";
      const collapseThreshold = isBrittleBuilding ? 1 : 2;

      if (severeCount >= collapseThreshold) {
        for (let i = lowestCollapsed + 1; i < dofCount; i++) {
          const fd = floorDamage[i];
          if (!fd.collapsed) {
            fd.collapsed = true;
            fd.damageState = DamageStateEnum.Complete;
            fd.repairCost = 100;
            const baseTime = floorDamage[lowestCollapsed].collapseTime ?? -1;
            fd.collapseTime =
              baseTime > 0 ? baseTime + (i - lowestCollapsed) * 0.2 : -1;
          }
        }

        // compute falling mass & see if lower floors can take it
        let fallingMass = 0;
        for (let i = lowestCollapsed; i < dofCount; i++) {
          if (floorDamage[i].collapsed) fallingMass += massPerFloor;
        }
        const impactFactor = fallingMass / massPerFloor;

        const pancakeThreshold = isBrittleBuilding ? 5.0 : 10.0;

        if (impactFactor > pancakeThreshold || (isBrittleBuilding && impactFactor > 3.0)) {
          for (let i = lowestCollapsed - 1; i >= 0; i--) {
            const fd = floorDamage[i];
            const floorCapacity = massPerFloor * 2.0;
            const canResist = !isBrittleBuilding && fallingMass < floorCapacity;

            if (!fd.collapsed && !canResist) {
              fd.collapsed = true;
              fd.damageState = DamageStateEnum.Complete;
              fd.repairCost = 100;
              const triggerTime = floorDamage[i + 1].collapseTime ?? -1;
              fd.collapseTime = triggerTime > 0 ? triggerTime + 0.15 : -1;
              fallingMass += massPerFloor;
            } else {
              break;
            }
          }
        }
      }
    }
    // for very brittle masonry, multiple local fails => global-ish collapse
    else if (material === "Masonry" && collapsedIdx.length >= 2) {
      for (let i = 0; i < dofCount; i++) {
        const fd = floorDamage[i];
        if (!fd.collapsed) {
          fd.collapsed = true;
          fd.damageState = DamageStateEnum.Complete;
          fd.repairCost = 100;
          const baseTime = floorDamage[lowestCollapsed].collapseTime ?? -1;
          fd.collapseTime =
            baseTime > 0 ? baseTime + Math.abs(i - lowestCollapsed) * 0.25 : -1;
        }
      }
      collapseBaseFloor = lowestCollapsed + 1;
    }
  }

  let buildingCollapseType: "none" | "partial" | "global" = "none";
  const totalCollapsed = floorDamage.filter((f) => f.collapsed).length;
  if (totalCollapsed === dof && dof > 0) {
    buildingCollapseType = "global";
  } else if (totalCollapsed > 0) {
    buildingCollapseType = "partial";
  }

  const maxDrift = Math.max(...floorDamage.map((f) => f.maxDrift));
  const peakAccel = Math.max(...floorDamage.map((f) => f.maxAccel));
  const totalRepairCost =
    floorDamage.reduce((s, f) => s + f.repairCost, 0) / (dof || 1);

  const order = [
    DamageStateEnum.None,
    DamageStateEnum.Slight,
    DamageStateEnum.Moderate,
    DamageStateEnum.Extensive,
    DamageStateEnum.Complete,
  ];
  const worstDamageState = floorDamage.reduce(
    (worst: DamageStateEnum, f: any) =>
      order.indexOf(f.damageState) > order.indexOf(worst)
        ? f.damageState
        : worst,
    DamageStateEnum.None
  );

  // text label for UI
  let lifeSafety = "Safe";
  if (worstDamageState === DamageStateEnum.Slight) {
    lifeSafety = "Safe - Minor Repairs Needed";
  } else if (worstDamageState === DamageStateEnum.Moderate) {
    lifeSafety = "Limited Entry - Repairs Required";
  } else if (worstDamageState === DamageStateEnum.Extensive) {
    lifeSafety = "Unsafe - Building Closed";
  } else if (worstDamageState === DamageStateEnum.Complete) {
    lifeSafety = "Life Threatening - Evacuate Immediately";
  }

  const softStoryIndex = findSoftStory(floorDamage);

  return {
    maxDrift,
    peakAccel,
    totalRepairCost,
    buildingCollapsed: buildingCollapseType !== "none",
    buildingCollapseType,
    collapseBaseFloor,
    worstDamageState,
    lifeSafety,
    floorDamage,
    softStoryIndex,
  };
}

// ground motion generator: harmonic/pulse/realistic (envelope + multiple freqs)
function generateGroundMotion(
  pgaG: number,
  duration: number,
  mainFreq: number,
  dt: number,
  type: "harmonic" | "pulse" | "realistic"
) {
  const steps = Math.max(10, Math.floor(duration / dt));
  const ag: number[] = [];
  const pga = pgaG * G;

  const seed = seedFromParams(pgaG, duration, mainFreq, type);
  const rand = createRng(seed);

  if (type === "realistic") {
    const freqs = [
      Math.max(0.1, mainFreq * 0.5),
      mainFreq,
      mainFreq * 2,
      Math.max(0.2, mainFreq * 0.25),
    ];
    const weights = [0.25, 0.55, 0.15, 0.05];
    const phases = freqs.map(() => rand() * 2 * Math.PI);

    const pWaveEnd = duration * 0.1;
    const sWaveStart = pWaveEnd;
    const sWaveEnd = duration * 0.7;

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      let acc = 0;

      // tiny P-wave-ish start
      if (t < pWaveEnd) {
        acc =
          pga *
          0.15 *
          Math.sin(2 * Math.PI * mainFreq * 3 * t + phases[2]);
      } else if (t < sWaveEnd) {
        // main shaking with envelope
        const tau = (t - sWaveStart) / (sWaveEnd - sWaveStart);
        const envelope = Math.sin(Math.PI * tau) ** 2;
        for (let j = 0; j < freqs.length; j++) {
          acc +=
            weights[j] *
            pga *
            envelope *
            Math.sin(2 * Math.PI * freqs[j] * t + phases[j]);
        }
        const ampMod =
          0.9 + 0.1 * Math.sin(2 * Math.PI * 0.15 * t);
        acc *= ampMod;
      } else {
        // coda with decay
        const decay = Math.exp(
          (-3 * (t - sWaveEnd)) / (duration - sWaveEnd + 1e-6)
        );
        acc =
          pga *
          0.25 *
          decay *
          Math.sin(
            2 * Math.PI * mainFreq * 0.7 * t + phases[0]
          );
      }

      ag.push(acc);
    }
  } else if (type === "pulse") {
    // fling/pulse type
    const pulseTime = duration * 0.2;
    const pulseDuration = 2 / mainFreq;

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      if (t >= pulseTime && t <= pulseTime + pulseDuration) {
        const tp = t - pulseTime;
        const envelope = Math.sin((Math.PI * tp) / pulseDuration);
        ag.push(
          pga *
            envelope *
            Math.sin(2 * Math.PI * mainFreq * tp)
        );
      } else {
        ag.push(
          pga *
            0.05 *
            Math.sin(
              2 * Math.PI * mainFreq * 1.5 * t
            )
        );
      }
    }
  } else {
    // pure sine, just to see resonance behavior
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      ag.push(
        pga * Math.sin(2 * Math.PI * mainFreq * t)
      );
    }
  }

  return { ag, dt };
}

// basic LA helpers
function matVec(A: number[][], x: number[]): number[] {
  const n = A.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < x.length; j++) {
      sum += A[i][j] * x[j];
    }
    out[i] = sum;
  }
  return out;
}

function vecAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i]);
}

function vecSub(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

function vecScale(a: number[], s: number): number[] {
  return a.map((v) => v * s);
}

// plain Gauss-Jordan invert, good enough for small DOF
function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const M = A.map((r) => r.slice());
  const I = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let i = col + 1; i < n; i++) {
      if (Math.abs(M[i][col]) > Math.abs(M[pivot][col])) {
        pivot = i;
      }
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      throw new Error("Matrix is singular");
    }

    [M[col], M[pivot]] = [M[pivot], M[col]];
    [I[col], I[pivot]] = [I[pivot], I[col]];

    const diag = M[col][col];
    for (let j = 0; j < n; j++) {
      M[col][j] /= diag;
      I[col][j] /= diag;
    }

    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const factor = M[i][col];
      for (let j = 0; j < n; j++) {
        M[i][j] -= factor * M[col][j];
        I[i][j] -= factor * I[col][j];
      }
    }
  }

  return I;
}

// API starts here: glue all pieces together
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      numFloors = 10,
      material = "Concrete",
      systemType = "MomentFrame",
      baseIsolated = false,
      massPerFloor,
      totalWeightN,
      totalWeight_kN,
      totalMassTon,
      storyHeight = 3.5,
      buildingWidth = 30,
      pgaG = 0.3,
      duration = 15,
      freqHz = 1.0,
      motionType = "realistic",
      extraDamping = 0,
      siteClass = "D",
      Ss = 1.0,
      S1 = 0.4,
      R = 6.0,
      Ie = 1.0,
      useRecordedMotion = false,
      recordedMotion,
      usgsEvent,
    } = body;

    // clamp floors and width to sane range
    const nFloors = Math.min(40, Math.max(1, Number(numFloors)));
    const bw = Math.max(5, Number(buildingWidth) || 30);

    // handle mass inputs:
    // priority: totalWeightN / totalWeight_kN / totalMassTon / massPerFloor / fallback
    let mPerFloor: number;
    const TW_N = totalWeightN
      ? Number(totalWeightN)
      : totalWeight_kN
      ? Number(totalWeight_kN) * 1000
      : 0;

    if (TW_N > 0) {
      // Eq: m = W / g
      mPerFloor = TW_N / G / nFloors;
    } else if (totalMassTon && Number(totalMassTon) > 0) {
      mPerFloor = (Number(totalMassTon) * 1000) / nFloors;
    } else if (massPerFloor && Number(massPerFloor) > 0) {
      mPerFloor = Number(massPerFloor);
    } else {
      // default guess
      mPerFloor = 50000;
    }

    const matKey: MaterialKey =
      MATERIALS[material as MaterialKey] ? (material as MaterialKey) : "Concrete";

    const sysKey: SystemKey =
      STRUCTURAL_SYSTEMS[systemType as SystemKey]
        ? (systemType as SystemKey)
        : "MomentFrame";

    const site = String(siteClass).toUpperCase() as SiteClass;
    const safeSite: SiteClass = ["B", "C", "D", "E"].includes(site)
      ? site
      : "D";

    const { M, C, K, springs, xiTotal, T1 } = buildMCK(
      nFloors,
      matKey,
      sysKey,
      mPerFloor,
      Number(storyHeight),
      bw,
      Boolean(baseIsolated),
      Number(extraDamping)
    );

    let ag: number[] = [];
    let dt = 0.01;
    let usedMotionType: string = motionType;
    let usedPgaG = Number(pgaG);
    let usedDuration = Number(duration);
    let usedFreqHz = Number(freqHz);

    // 1) recorded motion wins if provided
    if (
      useRecordedMotion &&
      recordedMotion &&
      Array.isArray(recordedMotion.accel_g) &&
      recordedMotion.accel_g.length > 0 &&
      recordedMotion.dt
    ) {
      dt = Number(recordedMotion.dt);
      ag = recordedMotion.accel_g.map((v: number) => v * G);
      usedMotionType = "recorded";
      usedPgaG = Math.max(
        ...recordedMotion.accel_g.map((v: number) => Math.abs(v))
      );
      usedDuration = dt * recordedMotion.accel_g.length;
    }
    // 2) USGS event -> derive pga/dur/freq then synthesize realistic wave
    else if (motionType === "usgs") {
      let ev: any = usgsEvent;

      if (!ev) {
        // fallback dummy if front-end didn't pass full ev
        const mag = Number((body as any).mag || 7.5);
        const depthKm = Number((body as any).depthKm || 35);
        const distanceKm = Number((body as any).distanceKm || 80);

        const defaultEpicenter = { lat: 16.9, lon: -99.9 };
        const defaultSite = { lat: 19.4326, lon: -99.1332 };

        ev = {
          region: "mexico",
          mag,
          depthKm,
          distanceKm,
          eqLat: defaultEpicenter.lat,
          eqLon: defaultEpicenter.lon,
          siteLat: defaultSite.lat,
          siteLon: defaultSite.lon,
        };
      }

      const {
        pgaG: aiPgaG,
        duration: aiDur,
        freqHz: aiFreq,
      } = deriveMotionFromUSGS(ev, safeSite);

      usedPgaG = aiPgaG;
      usedDuration = aiDur;
      usedFreqHz = aiFreq;
      usedMotionType = "realistic";

      const gm = generateGroundMotion(
        usedPgaG,
        usedDuration,
        usedFreqHz,
        dt,
        "realistic"
      );
      ag = gm.ag;
      dt = gm.dt;
    }
    // 3) manual synthetic, uses whatever type was chosen
    else {
      const gm = generateGroundMotion(
        usedPgaG,
        usedDuration,
        usedFreqHz,
        dt,
        motionType as "harmonic" | "pulse" | "realistic"
      );
      ag = gm.ag;
      dt = gm.dt;
    }

    const {
      u,
      v,
      a,
      springs: finalSprings,
      collapseTime,
      driftHistory,
    } = nonlinearTimeHistory(M, C, K, springs, ag, dt, matKey);

    const damage = assessDamage(
      u,
      a,
      finalSprings,
      Number(storyHeight),
      matKey,
      collapseTime,
      mPerFloor
    );

    // spectral-ish outputs: take max absolute accel, disp, vel
    const Sa =
      Math.max(
        ...a.map((row) =>
          Math.max(...row.map((x) => Math.abs(x)))
        )
      ) / G;

    const Sd = Math.max(
      ...u.map((row) =>
        Math.max(...row.map((x) => Math.abs(x)))
      )
    );
    const Sv = Math.max(
      ...v.map((row) =>
        Math.max(...row.map((x) => Math.abs(x)))
      )
    );

    // design base shear etc for comparison
    const design = computeDesignBaseShear({
      Ss: Number(Ss),
      S1: Number(S1),
      siteClass: safeSite,
      R: Number(R),
      Ie: Number(Ie),
      T1,
      numFloors: nFloors,
      massPerFloor: mPerFloor,
      storyHeight: Number(storyHeight),
    });

    // drift limit by system type for code check
    const systemDriftLimit: Record<SystemKey, number> = {
      MomentFrame: 0.02,
      BracedFrame: 0.01,
      ShearWallCore: 0.015,
      DualSystem: 0.015,
      UnreinforcedMasonry: 0.01,
    };
    const driftLimit = systemDriftLimit[sysKey] ?? 0.02;
    const driftCheck = damage.maxDrift <= driftLimit;

    // absolute accel = relative + ground accel
    const aAbs: number[][] = a.map((row, t) =>
      row.map((ai) => ai + (ag[t] || 0))
    );

    // base shear from sum(m_i * a_i_abs)
    const baseShearTime: number[] = aAbs.map((row) => {
      let sum = 0;
      for (let i = 0; i < nFloors; i++) {
        sum += M[i][i] * row[i];
      }
      return sum;
    });

    const baseShearDynamicMaxN = baseShearTime.length
      ? Math.max(...baseShearTime.map((x) => Math.abs(x)))
      : 0;

    const baseShearRatio =
      design.V > 1e-6 ? baseShearDynamicMaxN / design.V : 0;

    // story shear envelopes from suffix sums of floor forces
    const storyShearMaxN: number[] = Array(nFloors).fill(0);
    for (let t = 0; t < aAbs.length; t++) {
      let suffixSum = 0;
      for (let i = nFloors - 1; i >= 0; i--) {
        suffixSum += M[i][i] * aAbs[t][i];
        storyShearMaxN[i] = Math.max(
          storyShearMaxN[i],
          Math.abs(suffixSum)
        );
      }
    }

    const lastU = u[u.length - 1] || Array(nFloors).fill(0);

    const maxDriftPerStory: number[] = Array.from(
      { length: nFloors },
      (_, i) => damage.floorDamage[i]?.maxDrift || 0
    );

    // residual drift from final step (for perm offset feel)
    const residualDriftPerStory: number[] = Array.from(
      { length: nFloors },
      (_, i) => {
        const d =
          i === 0 ? lastU[0] : lastU[i] - lastU[i - 1];
        return d / Number(storyHeight);
      }
    );

    // Cd: deflection amp factor per system type (code-ish)
    const CdMap: Record<SystemKey, number> = {
      MomentFrame: 5.5,
      BracedFrame: 3.5,
      ShearWallCore: 4.0,
      DualSystem: 5.0,
      UnreinforcedMasonry: 2.5,
    };
    const Cd = CdMap[sysKey] ?? 5.0;

    // Eq: amplified drift = drift * (Cd / Ie)
    const amplifiedDriftPerStory = maxDriftPerStory.map(
      (d) => d * (Cd / Number(Ie))
    );
    const driftPassPerStory = amplifiedDriftPerStory.map(
      (d) => d <= driftLimit
    );

    // P_delta check: θ = (P_above * Δ) / (V_story * h)
    const P_above: number[] = Array(nFloors).fill(0);
    let runningW = 0;
    for (let i = nFloors - 1; i >= 0; i--) {
      runningW += M[i][i] * G;
      P_above[i] = runningW;
    }
    const storyHeightVal = Number(storyHeight);
    const thetaPerStory: number[] = Array.from(
      { length: nFloors },
      (_, i) => {
        const V = Math.max(1e-6, storyShearMaxN[i]);
        const Delta = maxDriftPerStory[i] * storyHeightVal;
        return (P_above[i] * Delta) / (V * storyHeightVal);
      }
    );
    const stabilityFlags = thetaPerStory.map((theta) =>
      theta < 0.1 ? "OK" : theta < 0.2 ? "Warning" : "Critical"
    );

    return NextResponse.json({
      ok: true,
      inputs: {
        numFloors: nFloors,
        material: matKey,
        systemType: sysKey,
        baseIsolated: Boolean(baseIsolated),
        massPerFloor: mPerFloor,
        totalWeightN: mPerFloor * nFloors * G,
        storyHeight: Number(storyHeight),
        xiTotal,
        pgaG: usedPgaG,
        duration: usedDuration,
        freqHz: usedFreqHz,
        motionType: usedMotionType,
        extraDamping: Number(extraDamping),
        fundamentalPeriod: T1,
        siteClass: safeSite,
        Ss: Number(Ss),
        S1: Number(S1),
        R: Number(R),
        Ie: Number(Ie),
        buildingWidth: bw,
      },
      damage,
      timeSeries: {
        u,
        a,
        driftHistory,
        groundAccel: ag,
      },
      spectralValues: {
        Sa,
        Sd,
        Sv,
      },
      designMetrics: {
        Fa: design.Fa,
        Fv: design.Fv,
        SMS: design.SMS,
        SM1: design.SM1,
        SDS: design.SDS,
        SD1: design.SD1,
        Cs: design.Cs,
        baseShearN: design.V,
        baseShear_kN: design.V / 1000,
        weightN: design.W,
        storyShearN: design.storyShear,
        driftLimit,
        driftCheck,
        dynamic: {
          baseShearMaxN: baseShearDynamicMaxN,
          baseShearMax_kN: baseShearDynamicMaxN / 1000,
          baseShearRatioToDesign: baseShearRatio,
          storyShearMaxN,
        },
        drifts: {
          maxDriftPerStory,
          amplifiedDriftPerStory,
          residualDriftPerStory,
          driftPassPerStory,
        },
        stability: {
          thetaPerStory,
          stabilityFlags,
        },
      },
      dt,
    });
  } catch (err: any) {
    console.error("Simulation error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || "Simulation failed",
      },
      { status: 500 }
    );
  }
}
