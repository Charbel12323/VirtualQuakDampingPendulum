import React from "react";

const G = 9.81;

type DamageState = "None" | "Slight" | "Moderate" | "Extensive" | "Complete";

type FloorDamage = {
  floor: number;
  maxDisp: number;
  maxDrift: number;
  maxAccel: number;
  damageState: DamageState;
  damageRatio: number;
  collapsed: boolean;
  collapseTime: number;
  repairCost: number;
};

type DamageAssessment = {
  maxDrift: number;
  peakAccel: number;
  totalRepairCost: number;
  buildingCollapsed: boolean;
  buildingCollapseType: "none" | "partial" | "global";
  collapseBaseFloor: number | null;
  worstDamageState: DamageState;
  lifeSafety: string;
  floorDamage: FloorDamage[];
  softStoryIndex: number;
};

type SimulationData = {
  inputs: {
    numFloors: number;
    material: string;
    systemType: string;
    baseIsolated: boolean;
    massPerFloor: number;
    storyHeight: number;
    xiTotal: number;
    pgaG: number;
    duration: number;
    freqHz: number;
    motionType: string;
    extraDamping: number;
    fundamentalPeriod: number;
    siteClass: "B" | "C" | "D" | "E";
    Ss: number;
    S1: number;
    R: number;
    Ie: number;
    buildingWidth?: number;
    totalWeightN?: number;
  };
  damage: DamageAssessment;
  timeSeries: {
    u: number[][]; // [frame][floor]
    a: number[][];
    driftHistory: number[][];
    groundAccel: number[]; // [frame]
  };
  dt: number;
};

const DAMAGE_COLORS: Record<
  DamageState,
  { bg: string; border: string; text: string; glow: string }
> = {
  None: {
    bg: "bg-emerald-500",
    border: "border-emerald-500",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/40",
  },
  Slight: {
    bg: "bg-yellow-400",
    border: "border-yellow-400",
    text: "text-yellow-300",
    glow: "shadow-yellow-400/40",
  },
  Moderate: {
    bg: "bg-yellow-500",
    border: "border-yellow-500",
    text: "text-yellow-400",
    glow: "shadow-yellow-500/40",
  },
  Extensive: {
    bg: "bg-red-500",
    border: "border-red-500",
    text: "text-red-300",
    glow: "shadow-red-500/50",
  },
  Complete: {
    bg: "bg-red-800",
    border: "border-red-800",
    text: "text-red-400",
    glow: "shadow-red-800/60",
  },
};

interface SeismicWaveVisualizationProps {
  data: SimulationData;
  frame: number;
}

export default function SeismicWaveVisualization({
  data,
  frame,
}: SeismicWaveVisualizationProps) {
  const floors = data.inputs.numFloors;
  const uAll = data.timeSeries.u || [];
  const driftAll = data.timeSeries.driftHistory || [];
  const damage = data.damage;
  const ground = data.timeSeries.groundAccel || [];
  const bw = data.inputs.buildingWidth ?? 24;

  if (!uAll.length || !uAll[0]) {
    console.warn("No displacement data available");
    return null;
  }

  const totalFrames = uAll.length;
  const safeFrame =
    totalFrames > 0 && frame >= 0 && frame < totalFrames
      ? frame
      : Math.max(0, totalFrames - 1);

  const getDisp = (floorIdx: number, timeIdx: number) =>
    uAll[timeIdx]?.[floorIdx] ?? 0;

  const getDrift = (floorIdx: number, timeIdx: number) =>
    driftAll[timeIdx]?.[floorIdx] ?? 0;

  // ---- GLOBAL SCALING: REALISTIC SWAY, NOT SLIDING ----
  // Use max absolute displacement to scale, but cap so top moves <= ~40px.
  let maxDispGlobal = 0;
  for (let t = 0; t < Math.min(uAll.length, 1000); t += 10) {
    for (let f = 0; f < floors; f++) {
      const v = Math.abs(getDisp(f, t));
      if (v > maxDispGlobal) maxDispGlobal = v;
    }
  }

  const MAX_DISP_PX = 40;
  let dispScale = 0;
  if (maxDispGlobal > 0) {
    dispScale = MAX_DISP_PX / maxDispGlobal;
    // if motions are tiny, don't over-amplify; keep it gentle
    if (dispScale > MAX_DISP_PX) dispScale = MAX_DISP_PX;
  }

  // base width in px
  const baseWidthPx = Math.max(90, Math.min(260, bw * 3.0));

  // ground motion visualization (small, just to show shaking)
  const groundVal =
    typeof ground[safeFrame] === "number" ? ground[safeFrame] : 0;
  const groundDispPx = (groundVal / (G * 1.5)) * 18; // toned down

  const currentTime = safeFrame * data.dt;
  const duration =
    data.inputs.duration && data.inputs.duration > 0
      ? data.inputs.duration
      : totalFrames * data.dt || 1;
  const freqHz = data.inputs.freqHz || 1.0;

  const currentGroundAccel = Math.abs(groundVal);
  const maxPossibleAccel = (data.inputs.pgaG || 0.3) * G;
  const waveIntensity = Math.min(
    1,
    maxPossibleAccel > 0
      ? currentGroundAccel / (maxPossibleAccel * 0.8)
      : 0
  );

  const wavePhase = currentTime * freqHz * 2 * Math.PI;
  const wavelength = 300;

  // ---- DAMAGE STATE HELPER ----
  const getCurrentDamageState = (
    floorIdx: number,
    currentDrift: number
  ): DamageState => {
    const storyHeight = data.inputs.storyHeight;
    const driftRatio = Math.abs(currentDrift) / storyHeight;
    const material = data.inputs.material;

    let limits = {
      Slight: 0.005,
      Moderate: 0.02,
      Extensive: 0.04,
      Complete: 0.06,
    };

    if (material === "Masonry") {
      limits = {
        Slight: 0.001,
        Moderate: 0.003,
        Extensive: 0.006,
        Complete: 0.01,
      };
    } else if (material === "Wood") {
      limits = {
        Slight: 0.004,
        Moderate: 0.012,
        Extensive: 0.022,
        Complete: 0.035,
      };
    } else if (material === "Concrete") {
      limits = {
        Slight: 0.004,
        Moderate: 0.015,
        Extensive: 0.03,
        Complete: 0.05,
      };
    }

    const fd = damage.floorDamage[floorIdx];

    if (
      fd.collapsed &&
      fd.collapseTime > 0 &&
      safeFrame * data.dt >= fd.collapseTime
    ) {
      return "Complete";
    }

    if (driftRatio < limits.Slight) return "None";
    if (driftRatio < limits.Moderate) return "Slight";
    if (driftRatio < limits.Extensive) return "Moderate";
    if (driftRatio < limits.Complete) return "Extensive";
    return "Complete";
  };

  // ---- STICK FIGURES (unchanged logic) ----
  const RoofStickFigure = ({ calm }: { calm: boolean }) => (
    <div className="relative w-8 h-14 flex items-center justify-center">
      <div className="absolute bottom-2 left-1/2 w-0.5 h-6 bg-slate-100 -translate-x-1/2" />
      <div className="absolute bottom-8 left-1/2 w-5 h-5 rounded-full bg-slate-50 text-[7px] flex items-center justify-center -translate-x-1/2">
        {calm ? ":-)" : ":-|"}
      </div>
      <div className="absolute bottom-2 left-1/2 w-0.5 h-4 bg-slate-300 -translate-x-[70%]" />
      <div className="absolute bottom-2 left-1/2 w-0.5 h-4 bg-slate-300 -translate-x-[30%]" />
      <div className="absolute bottom-6 left-1/2 w-0.5 h-3 bg-slate-200 -translate-x-[90%]" />
      <div className="absolute bottom-6 left-1/2 w-0.5 h-3 bg-slate-200 -translate-x-[10%]" />
    </div>
  );

  const ParachuteStickFigure = ({ t }: { t: number }) => {
    const canopyOpen = Math.min(1, Math.max(0, (t - 0.2) / 0.3));
    const bodyAngle = -25;
    const face = canopyOpen > 0.2 ? ":-|" : ":-O";

    return (
      <div className="relative w-16 h-18 flex items-center justify-center">
        <div
          className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-t-3xl bg-slate-200/95"
          style={{
            width: `${6 + 40 * canopyOpen}px`,
            height: `${2 + 10 * canopyOpen}px`,
            boxShadow:
              canopyOpen > 0
                ? "0 4px 10px rgba(148,163,253,0.4)"
                : "none",
          }}
        />
        {canopyOpen > 0.1 && (
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-10 h-5 flex justify-between">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-px bg-slate-300/90 h-full" />
            ))}
          </div>
        )}

        <div
          className="absolute bottom-2 left-1/2 w-0.5 h-7 bg-slate-100 origin-bottom"
          style={{
            transform: `translateX(-50%) rotate(${bodyAngle}deg)`,
          }}
        />
        <div className="absolute bottom-9 left-1/2 w-5 h-5 rounded-full bg-slate-50 text-[7px] flex items-center justify-center -translate-x-1/2">
          {face}
        </div>
        <div
          className="absolute bottom-2 left-1/2 w-0.5 h-4 bg-slate-300 origin-top"
          style={{ transform: "translateX(-70%) rotate(-5deg)" }}
        />
        <div
          className="absolute bottom-2 left-1/2 w-0.5 h-4 bg-slate-300 origin-top"
          style={{ transform: "translateX(-30%) rotate(5deg)" }}
        />
        <div
          className="absolute bottom-6 left-1/2 w-0.5 h-3 bg-slate-200 origin-top"
          style={{ transform: "translateX(-95%) rotate(-20deg)" }}
        />
        <div
          className="absolute bottom-6 left-1/2 w-0.5 h-3 bg-slate-200 origin-top"
          style={{ transform: "translateX(-5%) rotate(20deg)" }}
        />
      </div>
    );
  };

  const JoyStickFigure = () => (
    <div className="relative w-8 h-14 flex items-center justify-center">
      <div className="absolute bottom-2 left-1/2 w-0.5 h-6 bg-slate-100 -translate-x-1/2" />
      <div className="absolute bottom-8 left-1/2 w-5 h-5 rounded-full bg-slate-50 text-[7px] flex items-center justify-center -translate-x-1/2">
        {":-D"}
      </div>
      <div className="absolute bottom-2 left-1/2 w-0.5 h-4 bg-slate-300 -translate-x-[70%]" />
      <div className="absolute bottom-2 left-1/2 w-0.5 h-4 bg-slate-300 -translate-x-[30%]" />
      <div className="absolute bottom-6 left-1/2 w-0.5 h-4 bg-slate-200 origin-bottom -translate-x-[90%] -rotate-35" />
      <div className="absolute bottom-6 left-1/2 w-0.5 h-4 bg-slate-200 origin-bottom -translate-x-[10%] rotate-35" />
    </div>
  );

  const severeEvent =
    damage.buildingCollapseType !== "none" ||
    damage.worstDamageState === "Extensive" ||
    damage.worstDamageState === "Complete" ||
    damage.maxDrift > 0.035 ||
    damage.peakAccel > 1.5;

  const renderStickScenario = () => {
    const tNorm = Math.min(1, Math.max(0, currentTime / duration));
    const roofHeightPx = 90;
    const groundY = 8;
    const xBase = groundDispPx - baseWidthPx / 2 + 24;

    if (!severeEvent) {
      return (
        <div
          className="absolute z-30"
          style={{
            bottom: `${roofHeightPx}px`,
            left: "50%",
            transform: `translateX(${xBase}px)`,
            transition: "transform 80ms linear",
          }}
        >
          <RoofStickFigure calm={waveIntensity < 0.25} />
        </div>
      );
    }

    const phase1End = 0.25;
    const phase2End = 0.7;

    if (tNorm <= phase1End) {
      return (
        <div
          className="absolute z-30"
          style={{
            bottom: `${roofHeightPx}px`,
            left: "50%",
            transform: `translateX(${xBase}px)`,
          }}
        >
          <RoofStickFigure calm={false} />
        </div>
      );
    }

    if (tNorm <= phase2End) {
      const local = (tNorm - phase1End) / (phase2End - phase1End);
      const ease = 1 - Math.pow(1 - local, 2);
      const y = roofHeightPx - (roofHeightPx - groundY) * ease;
      const xShift = 20 + 80 * local;

      return (
        <div
          className="absolute z-40"
          style={{
            bottom: `${y}px`,
            left: "50%",
            transform: `translateX(${xBase + xShift}px)`,
          }}
        >
          <ParachuteStickFigure t={local} />
        </div>
      );
    }

    const local = (tNorm - phase2End) / (1 - phase2End);
    const hop =
      Math.sin(local * Math.PI * 3) *
      Math.exp(-2.5 * local) *
      12;
    const y = groundY + Math.max(0, hop);
    const xShift = 100;

    return (
      <div
        className="absolute z-30"
        style={{
          bottom: `${y}px`,
          left: "50%",
          transform: `translateX(${xBase + xShift}px)`,
        }}
      >
        <JoyStickFigure />
      </div>
    );
  };

  const renderSky = () => (
    <div className="absolute inset-x-0 top-0 h-24 overflow-hidden pointer-events-none z-0">
      {Array.from({ length: 3 }).map((_, i) => {
        const speed = 8 + i * 4;
        const x = ((currentTime * speed * 40 + i * 260) % 900) - 150;
        const y = 8 + i * 10;
        const scaleCloud = 1 + i * 0.25;
        const opacity = 0.25 + i * 0.12;
        return (
          <div
            key={`cloud-${i}`}
            className="absolute bg-white/90 rounded-full blur-md"
            style={{
              left: `${x}px`,
              top: `${y}px`,
              width: `${90 * scaleCloud}px`,
              height: `${28 * scaleCloud}px`,
              opacity,
              boxShadow: "40px 8px 40px rgba(15,23,42,0.45)",
            }}
          />
        );
      })}
    </div>
  );

  // ---- MAIN RENDER ----
  return (
    <div className="relative h-full w-full flex flex-col overflow-hidden bg-gradient-to-b from-slate-900 to-slate-800">
      {renderSky()}

      {/* BUILDING SECTION */}
      <div className="flex-[7] flex items-end justify-center relative pb-2">
        <div
          className="relative flex flex-col-reverse items-center z-20"
          style={{
            transform: `translateX(${groundDispPx}px)`,
            transition: "transform 80ms linear",
          }}
        >
          {Array.from({ length: floors }).map((_, i) => {
            const floorIdx = i;
            const disp = getDisp(floorIdx, safeFrame);
            const d = getDrift(floorIdx, safeFrame);
            const fd = damage.floorDamage[floorIdx];
            const currentDamageState = getCurrentDamageState(
              floorIdx,
              d
            );
            const color = DAMAGE_COLORS[currentDamageState];

            const isCollapsedNow =
              fd.collapsed &&
              fd.collapseTime > 0 &&
              safeFrame * data.dt >= fd.collapseTime;

            let fallDistance = 0;
            let fallRotation = 0;
            let crackIntensity = 0;

            if (isCollapsedNow) {
              const timeSinceCollapse =
                currentTime - fd.collapseTime;
              if (timeSinceCollapse > 0) {
                fallDistance = Math.min(
                  0.5 *
                    500 *
                    timeSinceCollapse *
                    timeSinceCollapse,
                  800
                );
                fallRotation =
                  (timeSinceCollapse * 180) %
                  360;
                crackIntensity = Math.min(
                  timeSinceCollapse * 3,
                  1.0
                );
              }
            }

            const opacity = isCollapsedNow
              ? Math.max(0.1, 1 - fallDistance / 400)
              : 1;

            const taperFactor =
              1 -
              (floorIdx /
                Math.max(1, floors - 1)) *
                0.1;
            const floorWidth = baseWidthPx * taperFactor;

            // NEW: realistic lateral sway
            const tx =
              dispScale > 0
                ? disp * dispScale
                : 0;
            const limitedTx = Math.max(
              -MAX_DISP_PX,
              Math.min(MAX_DISP_PX, tx)
            );

            const rotation = isCollapsedNow
              ? fallRotation
              : Math.max(
                  -6,
                  Math.min(
                    6,
                    (d / data.inputs.storyHeight) *
                      400
                  )
                );

            return (
              <div
                key={floorIdx}
                className="relative mb-1 will-change-transform transition-transform duration-100"
                style={{
                  transform: `translateX(${limitedTx}px) translateY(${fallDistance}px) rotate(${rotation}deg)`,
                  opacity,
                }}
              >
                <div
                  className={`relative h-5 ${color.bg} ${color.glow} border ${color.border} rounded-sm flex items-center transition-colors duration-300`}
                  style={{ width: `${floorWidth}px` }}
                >
                  <span className="absolute -left-8 text-[9px] text-slate-400 font-mono">
                    F{floorIdx + 1}
                  </span>

                  {damage.softStoryIndex ===
                    floorIdx && (
                    <span className="absolute -right-16 text-[9px] text-red-400 animate-pulse font-semibold">
                      Soft story
                    </span>
                  )}

                  {(currentDamageState !==
                    "None" ||
                    crackIntensity >
                      0) && (
                    <div className="absolute inset-0 pointer-events-none opacity-65">
                      <div
                        className="absolute bg-black/60"
                        style={{
                          width:
                            15 +
                            (fd.damageRatio ||
                              0.5) *
                              60 +
                            crackIntensity *
                              40,
                          height:
                            crackIntensity >
                            0
                              ? 2
                              : 1,
                          top: "35%",
                          left: "10%",
                          transform:
                            "rotate(-20deg)",
                        }}
                      />
                      {(fd.damageRatio ||
                        0) > 0.3 && (
                        <>
                          <div
                            className="absolute bg-black/50"
                            style={{
                              width:
                                10 +
                                (fd.damageRatio ||
                                  0.5) *
                                  40 +
                                crackIntensity *
                                  30,
                              height:
                                crackIntensity >
                                0
                                  ? 2
                                  : 1,
                              top:
                                "60%",
                              right:
                                "5%",
                              transform:
                                "rotate(15deg)",
                            }}
                          />
                          {crackIntensity >
                            0.3 && (
                            <div
                              className="absolute bg-black/40"
                              style={{
                                width:
                                  8 +
                                  crackIntensity *
                                    25,
                                height: 2,
                                top:
                                  "50%",
                                left:
                                  "50%",
                                transform:
                                  "rotate(5deg)",
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {isCollapsedNow && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-red-500 font-bold opacity-90 animate-pulse"
                        style={{
                          fontSize:
                            24 +
                            crackIntensity *
                              12,
                          textShadow:
                            "0 0 8px rgba(0,0,0,0.9)",
                        }}
                      >
                        ✕
                      </div>
                    </div>
                  )}
                </div>

                {floorIdx <
                  floors - 1 &&
                  !isCollapsedNow && (
                    <div className="absolute -bottom-5 flex justify-between w-full px-6">
                      {[0, 1, 2, 3].map(
                        (c) => (
                          <div
                            key={c}
                            className="w-1 h-5 bg-slate-700/95 rounded-full"
                          />
                        )
                      )}
                    </div>
                  )}
              </div>
            );
          })}

          {/* GLOBAL COLLAPSE OVERLAY */}
          {damage.buildingCollapseType ===
            "global" &&
            typeof damage.collapseBaseFloor ===
              "number" &&
            damage
              .floorDamage[
              damage
                .collapseBaseFloor -
                1
            ]?.collapseTime >
              0 &&
            safeFrame *
              data.dt >=
              (damage
                .floorDamage[
                damage
                  .collapseBaseFloor -
                  1
              ]
                ?.collapseTime ??
                Infinity) && (
              <>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div
                    className="text-red-600 font-black opacity-40 animate-pulse"
                    style={{
                      fontSize:
                        "20rem",
                      textShadow:
                        "0 0 30px rgba(220,38,38,0.6)",
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </div>
                </div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none">
                  {Array.from({
                    length: 8,
                  }).map((_, i) => {
                    const collapseTime =
                      damage
                        .floorDamage[
                        damage
                          .collapseBaseFloor! -
                          1
                      ]
                        ?.collapseTime ??
                      0;
                    const timeSinceCollapse =
                      currentTime -
                      collapseTime;
                    const dustExpansion =
                      Math.min(
                        timeSinceCollapse *
                          100,
                        400
                      );
                    const dustOpacity =
                      Math.max(
                        0,
                        0.6 -
                          timeSinceCollapse *
                            0.15
                      );
                    return (
                      <div
                        key={
                          i
                        }
                        className="absolute bottom-0 bg-slate-500/40 rounded-full blur-xl"
                        style={{
                          width:
                            100 +
                            dustExpansion +
                            i *
                              30,
                          height:
                            60 +
                            dustExpansion *
                              0.5 +
                            i *
                              20,
                          left:
                            -50 +
                            i *
                              15,
                          opacity:
                            dustOpacity,
                          transform:
                            `translateY(${
                              -i *
                              10
                            }px)`,
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}

          {/* BASE ISOLATORS */}
          {data.inputs.baseIsolated && (
            <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 flex gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-10 h-3 bg-blue-500/85 rounded-full animate-pulse shadow-lg shadow-blue-500/50"
                />
              ))}
            </div>
          )}
        </div>

        {/* Stick figure cinematic */}
        {renderStickScenario()}

        {/* GROUND LINE */}
        <div
          className="absolute bottom-0 w-full h-2 bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700 shadow-lg z-10"
          style={{
            transform: `translateX(${groundDispPx}px)`,
            boxShadow:
              "0 4px 16px rgba(217,119,6,0.4)",
          }}
        />
      </div>

      {/* UNDERGROUND SECTION */}
      <div className="flex-[3] relative border-t-2 border-amber-700/50 bg-gradient-to-b from-slate-800 to-black">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-800/40 to-black/80" />

        {waveIntensity > 0.1 &&
          Array.from({ length: 6 }).map((_, i) => {
            const offset =
              ((i * wavelength) / 6 +
                currentTime * 100) %
              100;
            const phase =
              wavePhase +
              (i * Math.PI) / 3;
            const amplitude =
              waveIntensity * 35;
            const yPos =
              50 +
              Math.sin(phase) *
                amplitude;

            return (
              <div
                key={`wave-${i}`}
                className="absolute h-3 bg-orange-500/60 blur-sm rounded-full"
                style={{
                  bottom: `${yPos}%`,
                  left: `${offset}%`,
                  width: 200,
                  opacity:
                    waveIntensity *
                    0.7,
                  transform:
                    "translateX(-50%)",
                }}
              />
            );
          })}

        {waveIntensity > 0.2 &&
          Array.from({ length: 10 }).map((_, i) => {
            const particlePhase =
              wavePhase +
              (i * Math.PI) / 5;
            const particleX =
              (i * 10) % 100;
            const particleY =
              40 +
              Math.sin(
                particlePhase
              ) *
                waveIntensity *
                35;

            return (
              <div
                key={`particle-${i}`}
                className="absolute w-2 h-2 bg-yellow-400/80 rounded-full shadow-lg shadow-yellow-400/50"
                style={{
                  bottom: `${particleY}%`,
                  left: `${particleX}%`,
                  opacity:
                    waveIntensity *
                    0.9,
                }}
              />
            );
          })}

        <div className="absolute inset-0 pointer-events-none">
          {[20, 40, 60, 80].map(
            (depth) => (
              <div
                key={depth}
                className="absolute w-full h-px bg-amber-700/30"
                style={{
                  bottom: `${depth}%`,
                }}
              />
            )
          )}
        </div>

        {waveIntensity > 0.15 && (
          <div className="absolute top-4 left-4 text-xs text-orange-400 bg-black/80 px-4 py-2 rounded-lg font-mono border border-orange-500/30 shadow-lg">
            Ground Shaking:{" "}
            <span className="font-bold text-orange-300">
              {(waveIntensity * 100).toFixed(
                0
              )}
              %
            </span>
          </div>
        )}

        <div className="absolute top-4 right-4 text-xs text-slate-300 bg-black/80 px-4 py-2 rounded-lg font-mono border border-slate-600/30 shadow-lg">
          {currentTime.toFixed(1)}s{" "}
          <span className="text-slate-500">
            /
          </span>{" "}
          {duration.toFixed(1)}s
        </div>
      </div>
    </div>
  );
}
