import { NextRequest, NextResponse } from "next/server";

const G = 9.81;

// ---- REALISTIC MATERIAL PROPERTIES ----
const MATERIALS = {
  Concrete: { 
    kFactor: 1.0, 
    xi: 0.03, 
    yieldStrain: 0.002,
    ultStrain: 0.004,
    ductility: 2.0,
    density: 2400
  },
  Steel: { 
    kFactor: 0.85, 
    xi: 0.02,
    yieldStrain: 0.002,
    ultStrain: 0.05,
    ductility: 8.0,
    density: 7850
  },
  Wood: { 
    kFactor: 0.4, 
    xi: 0.04,
    yieldStrain: 0.003,
    ultStrain: 0.02,
    ductility: 4.0,
    density: 600
  },
  Masonry: {
    kFactor: 0.6,
    xi: 0.05,
    yieldStrain: 0.001,
    ultStrain: 0.002,
    ductility: 1.5,
    density: 1800
  }
} as const;
type MaterialKey = keyof typeof MATERIALS;

// ---- STRUCTURAL SYSTEMS ----
const STRUCTURAL_SYSTEMS = {
  MomentFrame: { 
    kMult: 1.0, 
    xiAdd: 0.0, 
    label: "Moment Frame",
    redundancy: 0.8,
    heightLimit: 30,
    periodCoeff: 0.075
  },
  BracedFrame: { 
    kMult: 2.0, 
    xiAdd: 0.01, 
    label: "Braced Frame",
    redundancy: 0.6,
    heightLimit: 40,
    periodCoeff: 0.055
  },
  ShearWallCore: { 
    kMult: 3.0, 
    xiAdd: 0.02, 
    label: "Shear Wall",
    redundancy: 0.5,
    heightLimit: 60,
    periodCoeff: 0.045
  },
  DualSystem: { 
    kMult: 2.2, 
    xiAdd: 0.015, 
    label: "Dual System",
    redundancy: 0.9,
    heightLimit: 100,
    periodCoeff: 0.060
  },
  UnreinforcedMasonry: {
    kMult: 0.8,
    xiAdd: 0.0,
    label: "URM (Dangerous!)",
    redundancy: 0.2,
    heightLimit: 10,
    periodCoeff: 0.090
  }
} as const;
type SystemKey = keyof typeof STRUCTURAL_SYSTEMS;

// ---- SITE/HAZARD DESIGN COEFFICIENTS (ASCE 7 simplified) ----
type SiteClass = "B" | "C" | "D" | "E";

function computeFa(site: SiteClass, Ss: number): number {
  // Piecewise linear approximations of ASCE 7-16 Table 11.4-1
  if (site === "B") return 1.0;
  if (site === "C") {
    if (Ss <= 0.25) return 1.2; if (Ss <= 0.5) return 1.1; if (Ss <= 0.75) return 1.0; if (Ss <= 1.0) return 1.0; return 1.0;
  }
  if (site === "D") {
    if (Ss <= 0.25) return 1.6; if (Ss <= 0.5) return 1.4; if (Ss <= 0.75) return 1.2; if (Ss <= 1.0) return 1.1; return 1.0;
  }
  // E
  if (Ss <= 0.25) return 2.5; if (Ss <= 0.5) return 2.2; if (Ss <= 0.75) return 1.9; if (Ss <= 1.0) return 1.7; return 1.6;
}

function computeFv(site: SiteClass, S1: number): number {
  // Piecewise linear approximations of ASCE 7-16 Table 11.4-2
  if (site === "B") return 1.0;
  if (site === "C") {
    if (S1 <= 0.1) return 1.7; if (S1 <= 0.2) return 1.6; if (S1 <= 0.3) return 1.5; if (S1 <= 0.4) return 1.4; return 1.3;
  }
  if (site === "D") {
    if (S1 <= 0.1) return 2.4; if (S1 <= 0.2) return 2.0; if (S1 <= 0.3) return 1.8; if (S1 <= 0.4) return 1.6; return 1.5;
  }
  // E
  if (S1 <= 0.1) return 3.5; if (S1 <= 0.2) return 3.2; if (S1 <= 0.3) return 2.9; if (S1 <= 0.4) return 2.6; return 2.4;
}

function computeDesignBaseShear(params: {
  Ss: number; S1: number; siteClass: SiteClass; R: number; Ie: number; T1: number; numFloors: number; massPerFloor: number; storyHeight: number;
}) {
  const { Ss, S1, siteClass, R, Ie, T1, numFloors, massPerFloor, storyHeight } = params;
  const Fa = computeFa(siteClass, Ss);
  const Fv = computeFv(siteClass, S1);
  const SMS = Fa * Ss;
  const SM1 = Fv * S1;
  const SDS = (2 / 3) * SMS;
  const SD1 = (2 / 3) * SM1;
  const denom = Math.max(0.01, R / Ie);
  // ASCE 12.8.1: Cs = min(SDS/denom, SD1/(T*denom)), with lower bound max(0.044*SDS*Ie, 0.01)
  let Cs = Math.min(SDS / denom, SD1 / (Math.max(T1, 0.05) * denom));
  const Cs_lower = Math.max(0.044 * SDS * Ie, 0.01);
  Cs = Math.max(Cs, Cs_lower);
  Cs = Math.min(Cs, 0.5); // upper clipping for sanity
  const W = numFloors * massPerFloor * G; // N
  const V = Cs * W; // N
  // Story shear distribution (triangular by height)
  const weights = Array.from({ length: numFloors }, () => massPerFloor * G);
  const heights = Array.from({ length: numFloors }, (_, i) => (i + 1) * storyHeight);
  const sumWh = weights.reduce((s, w, i) => s + w * heights[i], 0);
  const storyShear = heights.map((h, i) => (V * (weights[i] * h)) / sumWh);
  return { Fa, Fv, SMS, SM1, SDS, SD1, Cs, V, W, storyShear };
}

// ---- DAMAGE STATES ----
enum DamageState {
  None = "None",
  Slight = "Slight",
  Moderate = "Moderate",
  Extensive = "Extensive",
  Complete = "Complete",
}

const DRIFT_LIMITS = {
  Slight: 0.005,
  Moderate: 0.015,
  Extensive: 0.025,
  Complete: 0.035
};

// ---- CALCULATE STORY STIFFNESS ----
function calculateStoryStiffness(
  floor: number,
  totalFloors: number,
  material: MaterialKey,
  system: SystemKey,
  massPerFloor: number,
  storyHeight: number,
  buildingWidth: number = 30
): number {
  const mat = MATERIALS[material];
  const sys = STRUCTURAL_SYSTEMS[system];
  
  // Cumulative gravity load
  const gravity = massPerFloor * G * (totalFloors - floor + 1);
  const reqArea = gravity / (10e6); // Simplified
  
  // More elements at lower floors
  const numElements = Math.max(4, Math.floor(8 * (1 + floor / totalFloors)));
  
  // Stiffness reduces with height
  const heightFactor = 1.0 - (floor / totalFloors) * 0.3;
  
  // Young's modulus approximation
  const E = mat.kFactor * 30e9; // N/m²
  const I = reqArea * Math.pow(buildingWidth / numElements, 2) / 12;
  
  // Lateral stiffness (12EI/h³ for fixed-fixed column)
  const k = (12 * E * I) / Math.pow(storyHeight, 3) * sys.kMult * heightFactor;
  
  return k;
}

// ---- NONLINEAR SPRING CLASS ----
class NonlinearSpring {
  private k0: number;
  private fy: number;
  private yieldDisp: number;
  private ultDisp: number;
  private currentK: number;
  private maxDisp: number = 0;
  private failed: boolean = false;
  
  constructor(k: number, mass: number, material: MaterialKey) {
    const mat = MATERIALS[material];
    this.k0 = k;
    this.fy = mass * G * 0.3; // Yield at ~0.3g
    this.yieldDisp = this.fy / k;
    this.ultDisp = this.yieldDisp * mat.ductility;
    this.currentK = k;
  }
  
  getForce(disp: number): number {
    const absDisp = Math.abs(disp);
    this.maxDisp = Math.max(this.maxDisp, absDisp);
    
    // Check failure
    if (absDisp > this.ultDisp) {
      this.failed = true;
      this.currentK = this.k0 * 0.01;
      return Math.sign(disp) * this.fy * 0.1;
    }
    
    // Bilinear model
    if (absDisp <= this.yieldDisp) {
      this.currentK = this.k0;
      return this.k0 * disp;
    } else {
      const hardening = 0.03;
      this.currentK = this.k0 * hardening;
      const elasticForce = Math.sign(disp) * this.fy;
      const plasticForce = this.currentK * (absDisp - this.yieldDisp) * Math.sign(disp);
      return elasticForce + plasticForce;
    }
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

// ---- BUILD SYSTEM MATRICES ----
function buildMCK(
  numFloors: number,
  matKey: MaterialKey,
  sysKey: SystemKey,
  massPerFloor: number,
  storyHeight: number,
  baseIsolated: boolean,
  extraDamping: number
) {
  const mat = MATERIALS[matKey];
  const sys = STRUCTURAL_SYSTEMS[sysKey];
  
  // Create springs
  const springs: NonlinearSpring[] = [];
  for (let i = 0; i < numFloors; i++) {
    const k = calculateStoryStiffness(
      i, numFloors, matKey, sysKey, 
      massPerFloor, storyHeight
    );
    springs.push(new NonlinearSpring(k, massPerFloor * (numFloors - i), matKey));
  }
  
  // Mass matrix
  const M: number[][] = Array.from({ length: numFloors }, (_, i) =>
    Array.from({ length: numFloors }, (_, j) =>
      i === j ? massPerFloor : 0
    )
  );
  
  // Initial stiffness matrix
  const K: number[][] = Array.from({ length: numFloors }, () =>
    Array(numFloors).fill(0)
  );
  
  for (let i = 0; i < numFloors; i++) {
    const k = springs[i].getTangentStiffness();
    
    if (i === 0) {
      if (baseIsolated) {
        const kIso = k * 0.1; // Soft isolator
        K[i][i] = kIso + (numFloors > 1 ? k : 0);
        if (numFloors > 1) K[i][i + 1] = -k;
      } else {
        K[i][i] = numFloors > 1 ? 2 * k : k;
        if (numFloors > 1) K[i][i + 1] = -k;
      }
    } else if (i === numFloors - 1) {
      K[i][i] = k;
      K[i][i - 1] = -k;
    } else {
      K[i][i] = k + springs[i + 1].getTangentStiffness();
      K[i][i - 1] = -k;
      K[i][i + 1] = -springs[i + 1].getTangentStiffness();
    }
  }
  
  // Damping with Rayleigh model
  const xiTotal = Math.min(0.30, mat.xi + sys.xiAdd + extraDamping);
  
  // Fundamental period estimation
  const H = numFloors * storyHeight;
  const T1 = sys.periodCoeff * Math.pow(H, 0.75);
  const w1 = 2 * Math.PI / T1;
  const w2 = w1 * 3;
  
  // Rayleigh coefficients
  const a0 = xiTotal * 2 * w1 * w2 / (w1 + w2);
  const a1 = xiTotal * 2 / (w1 + w2);
  
  // C = a0*M + a1*K
  const C: number[][] = Array.from({ length: numFloors }, (_, i) =>
    Array.from({ length: numFloors }, (_, j) =>
      a0 * M[i][j] + a1 * K[i][j]
    )
  );
  
  return { M, C, K, springs, xiTotal, T1 };
}

// ---- NONLINEAR TIME HISTORY ANALYSIS ----
function nonlinearTimeHistory(
  M: number[][],
  C: number[][],
  K_initial: number[][],
  springs: NonlinearSpring[],
  ag: number[],
  dt: number,
  material: MaterialKey
) {
  const dof = M.length;
  const n = ag.length;
  const mat = MATERIALS[material];
  
  const u: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const v: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const a: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const collapseTime: number[] = Array(dof).fill(-1);
  
  // Initial acceleration
  for (let i = 0; i < dof; i++) a[0][i] = -ag[0];
  
  const driftHistory: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  const forceHistory: number[][] = Array.from({ length: n }, () => Array(dof).fill(0));
  
  // Newmark-beta parameters
  const beta = 0.25;
  const gamma = 0.5;
  
  for (let step = 1; step < n; step++) {
    const uPrev = u[step - 1];
    const vPrev = v[step - 1];
    const aPrev = a[step - 1];
    
    // Update stiffness based on current state
    const K: number[][] = Array.from({ length: dof }, () =>
      Array(dof).fill(0)
    );
    
    // Compute drifts and update springs
    const storyDrifts: number[] = [];
    for (let i = 0; i < dof; i++) {
      const drift = i === 0 ? uPrev[i] : uPrev[i] - uPrev[i - 1];
      storyDrifts.push(drift);
      
      const force = springs[i].getForce(drift);
      forceHistory[step][i] = force;
      
      if (springs[i].hasFailed() && collapseTime[i] === -1) {
        collapseTime[i] = step * dt;
      }
    }
    
    // Rebuild K with current tangent stiffnesses
    for (let i = 0; i < dof; i++) {
      const k = springs[i].getTangentStiffness();
      
      if (i === 0) {
        K[i][i] = dof > 1 ? k + springs[1].getTangentStiffness() : k;
        if (dof > 1) K[i][i + 1] = -springs[1].getTangentStiffness();
      } else if (i === dof - 1) {
        K[i][i] = k;
        K[i][i - 1] = -k;
      } else {
        K[i][i] = k + (i < dof - 1 ? springs[i + 1].getTangentStiffness() : 0);
        K[i][i - 1] = -k;
        if (i < dof - 1) K[i][i + 1] = -springs[i + 1].getTangentStiffness();
      }
    }
    
    // Effective stiffness
    const a0 = 1 / (beta * dt * dt);
    const a1 = gamma / (beta * dt);
    const a2 = 1 / (beta * dt);
    const a3 = 1 / (2 * beta) - 1;
    const a4 = gamma / beta - 1;
    const a5 = dt * (gamma / (2 * beta) - 1);
    
    const K_eff: number[][] = Array.from({ length: dof }, (_, i) =>
      Array.from({ length: dof }, (_, j) =>
        K[i][j] + a0 * M[i][j] + a1 * C[i][j]
      )
    );
    
    try {
      const K_eff_inv = invertMatrix(K_eff);
      
      const ones = Array(dof).fill(1);
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
      const uNow = matVec(K_eff_inv, pEff);
      
      // Apply collapse limits
      for (let i = 0; i < dof; i++) {
        if (springs[i].hasFailed()) {
          const maxCollapsedDisp = mat.ultStrain * 3;
          uNow[i] = Math.sign(uNow[i]) * Math.min(Math.abs(uNow[i]), maxCollapsedDisp);
        }
      }
      
      u[step] = uNow;
      
      // Update velocity and acceleration
      const du = vecSub(uNow, uPrev);
      const aNow = vecAdd(
        vecSub(vecScale(du, a0), vecScale(vPrev, a2)),
        vecScale(aPrev, -a3)
      );
      a[step] = aNow;
      
      const vNow = vecAdd(
        vPrev,
        vecScale(
          vecAdd(vecScale(aPrev, 1 - gamma), vecScale(aNow, gamma)),
          dt
        )
      );
      v[step] = vNow;
      
      // Store drift history
      for (let i = 0; i < dof; i++) {
        driftHistory[step][i] = i === 0 ? uNow[i] : uNow[i] - uNow[i - 1];
      }
      
    } catch (error) {
      // Total collapse
      console.log("Structural collapse at step", step);
      for (let t = step; t < n; t++) {
        u[t] = u[step - 1].map(val => val * 1.5);
        a[t] = Array(dof).fill(0);
        v[t] = Array(dof).fill(0);
      }
      break;
    }
  }
  
  return { u, v, a, springs, collapseTime, driftHistory, forceHistory };
}

// ---- DAMAGE ASSESSMENT ----
function assessDamage(
  u: number[][],
  a: number[][],
  springs: NonlinearSpring[],
  storyHeight: number,
  material: MaterialKey,
  collapseTime: number[]
) {
  const n = u.length;
  const dof = u[0].length;
  const mat = MATERIALS[material];
  
  const floorDamage: {
    floor: number;
    maxDisp: number;
    maxDrift: number;
    maxAccel: number;
    damageState: DamageState;
    damageRatio: number;
    collapsed: boolean;
    collapseTime: number;
    repairCost: number;
  }[] = [];
  
  for (let i = 0; i < dof; i++) {
    let maxDisp = 0;
    let maxDrift = 0;
    let maxAccel = 0;
    
    for (let t = 0; t < n; t++) {
      maxDisp = Math.max(maxDisp, Math.abs(u[t][i]));
      maxAccel = Math.max(maxAccel, Math.abs(a[t][i]));
      
      if (i === 0) {
        maxDrift = Math.max(maxDrift, Math.abs(u[t][i]) / storyHeight);
      } else {
        const drift = Math.abs(u[t][i] - u[t][i - 1]) / storyHeight;
        maxDrift = Math.max(maxDrift, drift);
      }
    }
    
    // Determine damage state
    let damageState = DamageState.None;
    let repairCost = 0;
    
    if (maxDrift < DRIFT_LIMITS.Slight) {
      damageState = DamageState.None;
      repairCost = 0;
    } else if (maxDrift < DRIFT_LIMITS.Moderate) {
      damageState = DamageState.Slight;
      repairCost = 5;
    } else if (maxDrift < DRIFT_LIMITS.Extensive) {
      damageState = DamageState.Moderate;
      repairCost = 25;
    } else if (maxDrift < DRIFT_LIMITS.Complete) {
      damageState = DamageState.Extensive;
      repairCost = 60;
    } else {
      damageState = DamageState.Complete;
      repairCost = 100;
    }
    
    const damageRatio = springs[i].getDamageRatio();
    if (springs[i].hasFailed()) {
      damageState = DamageState.Complete;
      repairCost = 100;
    }
    
    floorDamage.push({
      floor: i + 1,
      maxDisp,
      maxDrift,
      maxAccel: maxAccel / G,
      damageState,
      damageRatio,
      collapsed: springs[i].hasFailed(),
      collapseTime: collapseTime[i],
      repairCost
    });
  }

  // --- Collapse propagation logic ---------------------------------
  // If any lower floor has collapsed, all floors ABOVE lose support and
  // should be marked collapsed as well (even if their local drift was small).
  const collapsedIndices = floorDamage.filter(f => f.collapsed).map(f => f.floor - 1);
  let collapseBaseFloor: number | null = null;
  if (collapsedIndices.length > 0) {
    collapseBaseFloor = Math.min(...collapsedIndices) + 1; // 1-based
    for (let i = 0; i < dof; i++) {
      // Any floor above the lowest collapsed floor becomes collapsed by loss of support.
      if (collapseBaseFloor && i + 1 > collapseBaseFloor && !floorDamage[i].collapsed) {
        floorDamage[i].collapsed = true;
        floorDamage[i].damageState = DamageState.Complete;
        floorDamage[i].repairCost = 100;
        // Inherit collapse time from the base failing floor for clarity
        const baseIdx = collapseBaseFloor - 1;
        floorDamage[i].collapseTime = floorDamage[baseIdx].collapseTime >= 0 ? floorDamage[baseIdx].collapseTime : -1;
      }
    }
  }

  // Distinguish collapse types
  let buildingCollapseType: 'none' | 'partial' | 'global' = 'none';
  const totalCollapsed = floorDamage.filter(f => f.collapsed).length;
  if (totalCollapsed > 0 && totalCollapsed < dof) {
    buildingCollapseType = 'partial';
  } else if (totalCollapsed === dof) {
    buildingCollapseType = 'global';
  }
  
  // Overall assessment
  const maxDrift = Math.max(...floorDamage.map(f => f.maxDrift));
  const peakAccel = Math.max(...floorDamage.map(f => f.maxAccel));
  const totalRepairCost = floorDamage.reduce((sum, f) => sum + f.repairCost, 0) / dof;
  const buildingCollapsed = buildingCollapseType !== 'none';
  const worstDamageState = floorDamage.reduce((worst, f) => {
    const states = [DamageState.None, DamageState.Slight, DamageState.Moderate, 
                   DamageState.Extensive, DamageState.Complete];
    const currentIdx = states.indexOf(f.damageState);
    const worstIdx = states.indexOf(worst);
    return currentIdx > worstIdx ? f.damageState : worst;
  }, DamageState.None);
  
  // Life safety
  let lifeSafety = "Safe";
  if (worstDamageState === DamageState.Complete) {
    lifeSafety = "Life Threatening - Evacuate Immediately";
  } else if (worstDamageState === DamageState.Extensive) {
    lifeSafety = "Unsafe - Building Closed";
  } else if (worstDamageState === DamageState.Moderate) {
    lifeSafety = "Limited Entry - Repairs Required";
  } else if (worstDamageState === DamageState.Slight) {
    lifeSafety = "Safe - Minor Repairs Needed";
  }
  
  return {
    maxDrift,
    peakAccel,
    totalRepairCost,
    buildingCollapsed,
    buildingCollapseType,
    collapseBaseFloor,
    worstDamageState,
    lifeSafety,
    floorDamage,
    softStoryIndex: findSoftStory(floorDamage)
  };
}

function findSoftStory(floorDamage: any[]): number {
  const drifts = floorDamage.map(f => f.maxDrift);
  const avgDrift = drifts.reduce((a, b) => a + b, 0) / drifts.length;
  
  let maxRatio = 0;
  let softStory = -1;
  
  for (let i = 0; i < drifts.length; i++) {
    const ratio = drifts[i] / (avgDrift || 0.001);
    if (ratio > maxRatio && ratio > 1.5) {
      maxRatio = ratio;
      softStory = i;
    }
  }
  
  return softStory;
}

// ---- GROUND MOTION GENERATION ----
function generateGroundMotion(
  pgaG: number,
  duration: number,
  mainFreq: number,
  dt: number,
  type: "harmonic" | "pulse" | "realistic"
) {
  const steps = Math.floor(duration / dt);
  const ag: number[] = [];
  const pga = pgaG * G;
  
  if (type === "realistic") {
    const freqs = [mainFreq * 0.5, mainFreq, mainFreq * 2, Math.max(0.2, mainFreq * 0.25)];
    const weights = [0.25, 0.55, 0.15, 0.05];
    // Fix phases per frequency (do NOT randomize per time step)
    const phases = freqs.map(() => Math.random() * 2 * Math.PI);
    
    const pWaveEnd = duration * 0.1;
    const sWaveStart = pWaveEnd;
    const sWaveEnd = duration * 0.7;
    
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      let acc = 0;
      
      if (t < pWaveEnd) {
        // Small amplitude, higher frequency content for P-wave
        acc = pga * 0.15 * Math.sin(2 * Math.PI * mainFreq * 3 * t + phases[2]);
      } else if (t < sWaveEnd) {
        // Smooth build-up and decay envelope
        const tau = (t - sWaveStart) / (sWaveEnd - sWaveStart);
        const envelope = Math.sin(Math.PI * tau) ** 2;
        for (let j = 0; j < freqs.length; j++) {
          acc += weights[j] * pga * envelope *
                 Math.sin(2 * Math.PI * freqs[j] * t + phases[j]);
        }
        // Mild, slowly varying amplitude modulation (no frame-to-frame randomness)
        const ampMod = 0.9 + 0.1 * Math.sin(2 * Math.PI * 0.15 * t);
        acc *= ampMod;
      } else {
        const decay = Math.exp(-3 * (t - sWaveEnd) / (duration - sWaveEnd));
        acc = pga * 0.25 * decay * Math.sin(2 * Math.PI * mainFreq * 0.7 * t + phases[0]);
      }
      
      ag.push(acc);
    }
  } else if (type === "pulse") {
    const pulseTime = duration * 0.2;
    const pulseDuration = 2 / mainFreq;
    
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      if (t >= pulseTime && t <= pulseTime + pulseDuration) {
        const tp = t - pulseTime;
        const envelope = Math.sin(Math.PI * tp / pulseDuration);
        ag.push(pga * envelope * Math.sin(2 * Math.PI * mainFreq * tp));
      } else {
        // Low-amplitude coda without random per-frame jitter
        ag.push(pga * 0.05 * Math.sin(2 * Math.PI * mainFreq * 1.5 * t));
      }
    }
  } else {
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      ag.push(pga * Math.sin(2 * Math.PI * mainFreq * t));
    }
  }
  
  return { ag, dt };
}

// ---- HELPER FUNCTIONS ----
function matVec(A: number[][], x: number[]): number[] {
  const n = A.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < x.length; j++) {
      out[i] += A[i][j] * x[j];
    }
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
  return a.map(v => v * s);
}

function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const M = A.map(row => row.slice());
  const I = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let i = col + 1; i < n; i++) {
      if (Math.abs(M[i][col]) > Math.abs(M[pivot][col])) pivot = i;
    }
    
    if (Math.abs(M[pivot][col]) < 1e-10) {
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

// ---- API HANDLER ----
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      numFloors = 10,
      material = "Concrete",
      systemType = "MomentFrame",
      baseIsolated = false,
      massPerFloor = 50000,
      storyHeight = 3.5,
      pgaG = 0.3,
      duration = 15,
      freqHz = 1.0,
      motionType = "realistic",
      extraDamping = 0,
      // New design parameters (optional)
      siteClass = "D",
      Ss = 1.0,
      S1 = 0.4,
      R = 6.0,
      Ie = 1.0
    } = body;
    
    const nFloors = Math.min(40, Math.max(1, Number(numFloors)));
    const matKey = MATERIALS[material as MaterialKey] ? material : "Concrete";
    const sysKey = STRUCTURAL_SYSTEMS[systemType as SystemKey] ? systemType : "MomentFrame";
    
    // Build structure
    const { M, C, K, springs, xiTotal, T1 } = buildMCK(
      nFloors,
      matKey as MaterialKey,
      sysKey as SystemKey,
      Number(massPerFloor),
      Number(storyHeight),
      Boolean(baseIsolated),
      Number(extraDamping)
    );
    
    // Generate ground motion
    const { ag, dt } = generateGroundMotion(
      Number(pgaG),
      Number(duration),
      Number(freqHz),
      0.01,
      motionType as any
    );
    
    // Run analysis
    const { u, v, a, springs: finalSprings, collapseTime, driftHistory, forceHistory } = 
      nonlinearTimeHistory(M, C, K, springs, ag, dt, matKey as MaterialKey);
    
    // Assess damage
    const damage = assessDamage(
      u, a, finalSprings, 
      Number(storyHeight), 
      matKey as MaterialKey,
      collapseTime
    );
    
    // Calculate spectral values
    const Sa = Math.max(...a.map(row => Math.max(...row.map(Math.abs))));
    const Sd = Math.max(...u.map(row => Math.max(...row.map(Math.abs))));
    const Sv = Math.max(...v.map(row => Math.max(...row.map(Math.abs))));

    // Design metrics (code-based)
    const site = (String(siteClass).toUpperCase() as SiteClass);
    const design = computeDesignBaseShear({
      Ss: Number(Ss),
      S1: Number(S1),
      siteClass: (['B','C','D','E'] as const).includes(site) ? site : 'D',
      R: Number(R),
      Ie: Number(Ie),
      T1: T1,
      numFloors: nFloors,
      massPerFloor: Number(massPerFloor),
      storyHeight: Number(storyHeight)
    });
    // Simple drift limits by system type (approx)
    const systemDriftLimit: Record<SystemKey, number> = {
      MomentFrame: 0.02,
      BracedFrame: 0.01,
      ShearWallCore: 0.015,
      DualSystem: 0.015,
      UnreinforcedMasonry: 0.01
    };
    const driftLimit = systemDriftLimit[sysKey as SystemKey] ?? 0.02;
    const driftCheck = damage.maxDrift <= driftLimit;
    
    return NextResponse.json({
      ok: true,
      inputs: {
        numFloors: nFloors,
        material: matKey,
        systemType: sysKey,
        baseIsolated,
        massPerFloor: Number(massPerFloor),
        storyHeight: Number(storyHeight),
        xiTotal,
        pgaG: Number(pgaG),
        duration: Number(duration),
        freqHz: Number(freqHz),
        motionType,
        extraDamping: Number(extraDamping),
        fundamentalPeriod: T1,
        // Echo design inputs
        siteClass: site,
        Ss: Number(Ss),
        S1: Number(S1),
        R: Number(R),
        Ie: Number(Ie)
      },
      damage,
      timeSeries: {
        // Provide full floor data instead of truncating to first 10 floors
        u: u,
        a: a,
        driftHistory: driftHistory,
        groundAccel: ag
      },
      spectralValues: {
        Sa: Sa / G,
        Sd,
        Sv
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
        driftCheck
      },
      dt
    });
    
  } catch (err: any) {
    console.error("Simulation error:", err);
    return NextResponse.json({
      ok: false,
      error: err.message || "Simulation failed"
    }, { status: 500 });
  }
}