"use client";

import React, { useEffect, useState, useRef } from "react";
import SeismicWaveVisualization from "@/app/components/SeismicWaveVisualization";
import OptimizationRecommendations from "@/app/components/OptimizationRecommendations";
import ParameterChanges from "@/app/components/ParameterChanges";
import BuildingPreview from "@/app/components/BuildingPreview";

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

type ApiResponse = {
  ok: boolean;
  inputs: {
    numFloors: number;
    material: string;
    systemType: string;
    baseIsolated: boolean;
    massPerFloor: number;
    floorWeightN?: number;
    floorWeight_kN?: number;
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
  };
  damage: DamageAssessment;
  timeSeries: {
    u: number[][];
    a: number[][];
    driftHistory: number[][];
    groundAccel: number[];
  };
  spectralValues: {
    Sa: number;
    Sd: number;
    Sv: number;
  };
  designMetrics?: {
    Fa: number;
    Fv: number;
    SMS: number;
    SM1: number;
    SDS: number;
    SD1: number;
    Cs: number;
    baseShearN: number;
    baseShear_kN: number;
    weightN: number;
    storyShearN: number[];
    driftLimit: number;
    driftCheck: boolean;
    dynamic?: {
      baseShearMaxN: number;
      baseShearMax_kN: number;
      baseShearRatioToDesign: number;
      storyShearMaxN: number[];
    };
    drifts?: {
      maxDriftPerStory: number[];
      amplifiedDriftPerStory: number[];
      residualDriftPerStory: number[];
      driftPassPerStory: boolean[];
    };
    stability?: {
      thetaPerStory: number[];
      stabilityFlags: ("OK" | "Warning" | "Critical")[];
    };
  };
  dt: number;
};

type UsgsEvent = {
  id: string;
  title: string;
  mag: number;
  time: number;
  depthKm: number;
  lat: number;
  lon: number;
};

function getTotalFrames(result: ApiResponse | null): number {
  if (!result) return 0;
  const { u, groundAccel } = result.timeSeries;
  if (u && u.length) return u.length;
  if (groundAccel && groundAccel.length) return groundAccel.length;
  return 0;
}

const DAMAGE_COLORS: Record<
  DamageState,
  { bg: string; border: string; text: string }
> = {
  None: {
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
  },
  Slight: {
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/30",
    text: "text-yellow-300",
  },
  Moderate: {
    bg: "bg-yellow-500/8",
    border: "border-yellow-500/40",
    text: "text-yellow-300",
  },
  Extensive: {
    bg: "bg-red-500/6",
    border: "border-red-500/40",
    text: "text-red-300",
  },
  Complete: {
    bg: "bg-red-600/8",
    border: "border-red-600/50",
    text: "text-red-300",
  },
};

export default function SeismicPerformanceSimulatorPage() {
  const [numFloors, setNumFloors] = useState(10);
  const [material, setMaterial] = useState("Concrete");
  const [systemType, setSystemType] = useState("MomentFrame");
  const [baseIsolated, setBaseIsolated] = useState(false);
  const [massPerFloor, setMassPerFloor] = useState(50000);
  const [storyHeight, setStoryHeight] = useState(3.5);
  const [extraDamping, setExtraDamping] = useState(0.02);
  const [buildingWidth, setBuildingWidth] = useState(24);
  const [useFloorWeight, setUseFloorWeight] = useState(false);
  const [floorWeightkN, setFloorWeightkN] = useState<number>(
    Math.round((50000 * G) / 1000)
  );

  const [siteClass, setSiteClass] = useState<"B" | "C" | "D" | "E">("D");
  const [Ss, setSs] = useState(1.0);
  const [S1, setS1] = useState(0.4);
  const [R, setR] = useState(6.0);
  const [Ie, setIe] = useState(1.0);
  const [duration, setDuration] = useState(15);

  const [useRealEvent, setUseRealEvent] = useState(true);
  const [usgsEvents, setUsgsEvents] = useState<UsgsEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [fetchingEvents, setFetchingEvents] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showDamageReport, setShowDamageReport] = useState(false);

  const [optimizationLoading, setOptimizationLoading] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<string | null>(
    null
  );
  const [optimizationError, setOptimizationError] = useState<string | null>(
    null
  );
  const [parameterChanges, setParameterChanges] = useState<any[]>([]);
  const [showOptimizationPanel, setShowOptimizationPanel] = useState(false);
  const [hasAutoOptimizedForRun, setHasAutoOptimizedForRun] = useState(false);

  const [frameIndex, setFrameIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    fetchUsgsEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchUsgsEvents() {
    try {
      setFetchingEvents(true);
      setError(null);
      setUsgsEvents([]);
      setSelectedEventId(null);

      const res = await fetch("/api/usgs-events?minMag=6.0&limit=25");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to fetch USGS events");
      setUsgsEvents(data.events || []);
    } catch (e: any) {
      setError(e.message || "Failed to load USGS events");
    } finally {
      setFetchingEvents(false);
    }
  }

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setIsAnimating(false);
    setFrameIndex(0);
    setResult(null);

    setShowDamageReport(false);
    setShowOptimizationPanel(false);
    setOptimizationLoading(false);
    setOptimizationResult(null);
    setOptimizationError(null);
    setParameterChanges([]);
    setHasAutoOptimizedForRun(false);

    const selectedEvent = useRealEvent
      ? usgsEvents.find((e) => e.id === selectedEventId) || null
      : null;

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numFloors,
          material,
          systemType,
          baseIsolated,
          massPerFloor,
          floorWeight_kN: useFloorWeight ? floorWeightkN : undefined,
          storyHeight,
          extraDamping,
          buildingWidth,
          siteClass,
          Ss,
          S1,
          R,
          Ie,
          duration,
          usgsEvent:
            useRealEvent && selectedEvent
              ? {
                  id: selectedEvent.id,
                  mag: selectedEvent.mag,
                  eqLat: selectedEvent.lat,
                  eqLon: selectedEvent.lon,
                  depthKm: selectedEvent.depthKm,
                }
              : null,
          useRecordedMotion: false,
        }),
      });

      const data: ApiResponse = await res.json();
      if (!data.ok) throw new Error((data as any).error || "Simulation failed");

      const frames = getTotalFrames(data);
      setResult(data);
      setFrameIndex(0);
      setIsAnimating(frames > 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (result && !hasAutoOptimizedForRun) {
      autoRunOptimization(result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  async function autoRunOptimization(simData: ApiResponse) {
    setHasAutoOptimizedForRun(true);
    setOptimizationLoading(true);
    setOptimizationError(null);
    setOptimizationResult(null);
    setParameterChanges([]);

    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: simData.inputs,
          damage: simData.damage,
          designMetrics: simData.designMetrics,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        if (data.error?.toLowerCase().includes("rate limit")) {
          throw new Error(
            "Rate limit reached. Try again shortly or adjust API limits."
          );
        }
        if (data.error?.includes("API key")) {
          throw new Error("API key issue: " + data.error);
        }
        throw new Error(data.error || "Optimization failed");
      }

      setOptimizationResult(data.recommendations);
      setParameterChanges(data.parameterChanges || []);
    } catch (e: any) {
      setOptimizationError(e.message);
    } finally {
      setOptimizationLoading(false);
    }
  }

  function applyParameterChange(parameter: string, value: any) {
    switch (parameter) {
      case "material":
        setMaterial(value);
        break;
      case "systemType":
        setSystemType(value);
        break;
      case "baseIsolated":
        setBaseIsolated(value);
        break;
      case "numFloors":
        setNumFloors(Number(value));
        break;
      case "massPerFloor":
        setMassPerFloor(Number(value));
        break;
      case "storyHeight":
        setStoryHeight(Number(value));
        break;
      case "extraDamping":
        setExtraDamping(Number(value));
        break;
      case "buildingWidth":
        setBuildingWidth(Number(value));
        break;
      default:
        console.warn(`Unknown parameter: ${parameter}`);
    }
  }

  function applyAllParameterChanges() {
    parameterChanges.forEach((c) =>
      applyParameterChange(c.parameter, c.recommendedValue)
    );
  }

  useEffect(() => {
    if (!result || !isAnimating) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const totalFrames = getTotalFrames(result);
    if (!totalFrames) return;

    const dt = result.dt && result.dt > 0 ? result.dt : 0.01;
    const speed = 1.0;
    const start = performance.now();
    const startFrame = frameIndex;

    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      const simTime = elapsed * speed;
      let frame = startFrame + Math.floor(simTime / dt);

      if (frame >= totalFrames) {
        frame = totalFrames - 1;
        setFrameIndex(frame);
        setIsAnimating(false);
        animationRef.current = null;
        return;
      }

      setFrameIndex(frame);
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, isAnimating]);

  const globalStatus =
    result &&
    (() => {
      const d = result.damage;
      if (!d.buildingCollapsed && d.maxDrift < 0.005) {
        return {
          label: "Elastic / safe",
          className:
            "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40",
        };
      }
      if (!d.buildingCollapsed && d.maxDrift < 0.02) {
        return {
          label: "Inelastic / repairable",
          className:
            "bg-yellow-500/10 text-yellow-300 border border-yellow-500/40",
        };
      }
      return {
        label: d.buildingCollapsed
          ? "Severe / collapse mechanism"
          : "Severe damage",
        className: "bg-red-500/10 text-red-300 border border-red-500/40",
      };
    })();

  return (
    <div className="min-h-screen bg-[#020817] text-slate-50">
      <header className="sticky top-0 z-30 bg-[#020817]/98 backdrop-blur border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-50">
              VirtualQuake VQ
            </h1>
            <p className="text-sm text-slate-400"></p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <aside className="lg:col-span-4 space-y-6">
            <div className="rounded-2xl p-6 bg-slate-950/95 border border-slate-800 flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-slate-50 tracking-wide">
                    Real earthquakes
                  </div>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Select a recent USGS event as input ground motion.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={useRealEvent}
                    onChange={(e) => setUseRealEvent(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-900"
                  />
                  Enable
                </label>
              </div>

              {fetchingEvents ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 rounded-full border-2 border-slate-600 border-t-transparent animate-spin" />
                </div>
              ) : usgsEvents.length > 0 ? (
                <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar -mr-2 pr-3">
                  {usgsEvents.map((ev) => {
                    const isSelected =
                      useRealEvent && ev.id === selectedEventId;
                    const dt = new Date(ev.time);
                    return (
                      <button
                        key={ev.id}
                        onClick={() => {
                          if (!useRealEvent) setUseRealEvent(true);
                          setSelectedEventId(
                            isSelected ? null : ev.id
                          );
                        }}
                        className={[
                          "w-full text-left px-3 py-2.5 rounded-xl border flex flex-col gap-1 transition-colors",
                          isSelected
                            ? "border-sky-500 bg-slate-900"
                            : "border-slate-800 bg-slate-950 hover:border-slate-600 hover:bg-slate-900",
                          !useRealEvent && "opacity-60",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-baseline gap-2">
                            <span className="text-base font-semibold text-slate-50">
                              M{ev.mag.toFixed(1)}
                            </span>
                            <span className="text-sm text-slate-400 line-clamp-1">
                              {ev.title}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 text-right">
                            <div>{dt.toLocaleDateString()}</div>
                            <div>{dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                          </div>
                        </div>
                        <div className="text-xs text-slate-500 flex gap-4 pt-1">
                          <span>
                            {ev.lat.toFixed(2)}°, {ev.lon.toFixed(2)}°
                          </span>
                          <span>
                            Depth {ev.depthKm.toFixed(1)} km
                          </span>
                          {isSelected && (
                            <span className="text-sky-400 font-medium">Selected</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <button
                  onClick={fetchUsgsEvents}
                  className="text-xs px-3 py-2 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-900 transition"
                >
                  Reload USGS events
                </button>
              )}
            </div>

            <div className="rounded-2xl p-6 bg-slate-950/95 border border-slate-800 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-50">
                  Building configuration
                </h3>
                <p className="text-xs text-slate-500">
                  Core parameters for the idealized system.
                </p>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Floors</span>
                  <span className="text-slate-100 font-medium">
                    {numFloors}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={40}
                  value={numFloors}
                  onChange={(e) =>
                    setNumFloors(Number(e.target.value))
                  }
                  className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Plan width</span>
                  <span className="text-slate-100 font-medium">
                    {buildingWidth} m
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={120}
                  value={buildingWidth}
                  onChange={(e) =>
                    setBuildingWidth(Number(e.target.value))
                  }
                  className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400 mb-1">
                    Material
                  </div>
                  <select
                    value={material}
                    onChange={(e) =>
                      setMaterial(e.target.value)
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    <option value="Steel">Steel</option>
                    <option value="Concrete">Concrete</option>
                    <option value="Wood">Wood</option>
                    <option value="Masonry">Masonry</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">
                    System
                  </div>
                  <select
                    value={systemType}
                    onChange={(e) =>
                      setSystemType(e.target.value)
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    <option value="MomentFrame">
                      Moment frame
                    </option>
                    <option value="BracedFrame">
                      Braced frame
                    </option>
                    <option value="ShearWallCore">
                      Shear wall
                    </option>
                    <option value="DualSystem">
                      Dual system
                    </option>
                    <option value="UnreinforcedMasonry">
                      URM (warning)
                    </option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={baseIsolated}
                  onChange={(e) =>
                    setBaseIsolated(e.target.checked)
                  }
                  className="w-4 h-4 rounded border-slate-600 bg-slate-900"
                />
                Base isolation system
              </label>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Floor weight</span>
                  <span className="text-slate-100 font-medium">
                    {floorWeightkN} kN
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={3000}
                  step={10}
                  value={floorWeightkN}
                  onChange={(e) =>
                    setFloorWeightkN(Number(e.target.value))
                  }
                  className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
                <p className="text-[10px] text-slate-500">
                  ≈{" "}
                  {(
                    (floorWeightkN * 1000) /
                    G /
                    1000
                  ).toFixed(1)}{" "}
                  t per floor
                </p>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Damping ratio</span>
                  <span className="text-slate-100 font-medium">
                    {(extraDamping * 100).toFixed(1)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={0.25}
                  step={0.005}
                  value={extraDamping}
                  onChange={(e) =>
                    setExtraDamping(Number(e.target.value))
                  }
                  className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="text-xs text-slate-400 mb-1">
                  Site class
                </div>
                <select
                  value={siteClass}
                  onChange={(e) =>
                    setSiteClass(
                      e.target.value as "B" | "C" | "D" | "E"
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="B">B — Rock</option>
                  <option value="C">C — Stiff soil</option>
                  <option value="D">D — Soft soil</option>
                  <option value="E">E — Very soft</option>
                </select>
              </div>
            </div>

            <button
              onClick={runSimulation}
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 text-sm font-semibold text-slate-950 shadow-sm hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Running simulation..." : "Run simulation"}
            </button>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/40 text-xs text-red-300">
                {error}
              </div>
            )}
          </aside>

          <section className="lg:col-span-8 space-y-6">
            <div className="rounded-2xl p-5 bg-slate-950/95 border border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-base font-semibold text-slate-50">
                    Building response
                  </div>
                  {result && (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                      <span>
                        Motion:{" "}
                        <span className="text-slate-100">
                          {result.inputs.motionType}
                        </span>
                      </span>
                      <span>
                        Duration:{" "}
                        <span className="text-slate-100">
                          {result.inputs.duration.toFixed(1)} s
                        </span>
                      </span>
                      {globalStatus && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${globalStatus.className}`}
                        >
                          {globalStatus.label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {result && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (!result) return;
                        const totalFrames =
                          getTotalFrames(result);
                        if (isAnimating) {
                          setIsAnimating(false);
                        } else {
                          if (
                            totalFrames > 0 &&
                            frameIndex >= totalFrames - 1
                          ) {
                            setFrameIndex(0);
                          }
                          setIsAnimating(true);
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-50 transition"
                    >
                      {(() => {
                        if (!result) return "Play";
                        const totalFrames =
                          getTotalFrames(result);
                        if (isAnimating) return "Pause";
                        if (
                          totalFrames > 0 &&
                          frameIndex >= totalFrames - 1
                        )
                          return "Replay";
                        return "Play";
                      })()}
                    </button>
                    <div className="text-xs text-slate-500">
                      {(() => {
                        const totalFrames =
                          getTotalFrames(result);
                        const dt = result.dt || 0.01;
                        const clamped =
                          totalFrames > 0
                            ? Math.min(
                                Math.max(frameIndex, 0),
                                totalFrames - 1
                              )
                            : 0;
                        return (
                          <>
                            <span className="font-mono text-slate-100">
                              {(clamped * dt).toFixed(2)} s
                            </span>
                            <span className="text-slate-600">
                              {" "}
                              /{" "}
                              {(totalFrames * dt).toFixed(2)} s
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {result && (
                <div className="mb-4 h-2 bg-slate-900 rounded-full overflow-hidden">
                  {(() => {
                    const totalFrames =
                      getTotalFrames(result);
                    const clamped =
                      totalFrames > 0
                        ? Math.min(
                            Math.max(frameIndex, 0),
                            totalFrames - 1
                          )
                        : 0;
                    const pct =
                      totalFrames > 1
                        ? (clamped / (totalFrames - 1)) *
                          100
                        : 0;
                    return (
                      <div
                        className="h-full bg-sky-500 transition-all duration-100"
                        style={{ width: `${pct}%` }}
                      />
                    );
                  })()}
                </div>
              )}

              <div className="h-[580px] bg-slate-950 rounded-2xl border border-slate-900 overflow-hidden">
                {result ? (
                  <SeismicWaveVisualization
                    data={result as any}
                    frame={frameIndex}
                  />
                ) : (
                  <BuildingPreview
                    numFloors={numFloors}
                    buildingWidth={buildingWidth}
                    storyHeight={storyHeight}
                    material={material}
                    baseIsolated={baseIsolated}
                    systemType={systemType}
                  />
                )}
              </div>
            </div>

            {result && (
              <>
                <div className="rounded-2xl px-4 py-3 bg-slate-950/95 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-50">
                      Damage report
                    </span>
                    <span className="text-xs text-slate-500">
                      View summarized damage, spectrum, and stability results.
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setShowDamageReport((v) => !v)
                    }
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-100 flex items-center gap-2 transition"
                  >
                    {showDamageReport
                      ? "Hide damage report"
                      : "View damage report"}
                    <span
                      className={`inline-block text-[9px] transition-transform ${
                        showDamageReport
                          ? "rotate-180"
                          : ""
                      }`}
                    >
                      ▼
                    </span>
                  </button>
                </div>

                {showDamageReport && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl p-4 bg-slate-950/95 border border-slate-800 flex flex-col gap-2">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        Damage Report
                      </div>
                      <div className="text-sm text-slate-100 font-medium">
                        {result.damage.lifeSafety}
                      </div>
                      <div className="text-xs text-slate-400">
                        Worst state:{" "}
                        <span className="text-slate-100">
                          {result.damage.worstDamageState}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Max drift</span>
                        <span className="text-slate-100 font-medium">
                          {(result.damage.maxDrift * 100).toFixed(2)}
                          %
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Peak accel</span>
                        <span className="text-slate-100 font-medium">
                          {result.damage.peakAccel.toFixed(2)} g
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Repair index</span>
                        <span className="text-slate-100 font-medium">
                          {result.damage.totalRepairCost.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-2 text-[10px] text-slate-500">
                        Top affected floors:
                      </div>
                      <div className="space-y-1 max-h-20 overflow-y-auto custom-scrollbar pr-2 -mr-2">
                        {result.damage.floorDamage
                          .slice()
                          .sort(
                            (a, b) =>
                              b.damageRatio - a.damageRatio
                          )
                          .slice(0, 4)
                          .map((f) => {
                            const c =
                              DAMAGE_COLORS[f.damageState];
                            return (
                              <div
                                key={f.floor}
                                className="flex items-center justify-between px-2 py-1 rounded-lg bg-slate-950 border border-slate-800"
                              >
                                <span className="text-[10px] text-slate-300">
                                  Floor {f.floor}
                                </span>
                                <span
                                  className={`text-[10px] ${c.text}`}
                                >
                                  {
                                    f.damageState
                                  }
                                </span>
                              </div>
                            );
                          })}
                      </div>
                      {result.damage.buildingCollapsed && (
                        <div className="mt-2 text-[10px] text-red-300">
                          Collapse:{" "}
                          {result.damage
                            .buildingCollapseType ===
                          "global"
                            ? "Global"
                            : "Partial"}
                          {result.damage.collapseBaseFloor &&
                            ` (initiated near floor ${result.damage.collapseBaseFloor})`}
                          .
                        </div>
                      )}
                      {result.damage.softStoryIndex >= 0 && (
                        <div className="text-[10px] text-amber-300">
                          Soft-story behavior at floor{" "}
                          {result.damage.softStoryIndex + 1}.
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl p-4 bg-slate-950/95 border border-slate-800 flex flex-col gap-2">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        Response Spectrum
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-500">
                            Sa (max)
                          </div>
                          <div className="text-sm font-semibold text-slate-100">
                            {result.spectralValues.Sa.toFixed(
                              3
                            )}
                          </div>
                          <div className="text-[9px] text-slate-500">
                            g
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">
                            Sd (max)
                          </div>
                          <div className="text-sm font-semibold text-slate-100">
                            {(
                              result.spectralValues.Sd *
                              100
                            ).toFixed(2)}
                          </div>
                          <div className="text-[9px] text-slate-500">
                            cm
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">
                            Sv (max)
                          </div>
                          <div className="text-sm font-semibold text-slate-100">
                            {(
                              result.spectralValues.Sv *
                              100
                            ).toFixed(2)}
                          </div>
                          <div className="text-[9px] text-slate-500">
                            cm/s
                          </div>
                        </div>
                      </div>

                      {Math.abs(
                        1 / result.inputs.freqHz -
                          result.inputs.fundamentalPeriod
                      ) < 0.2 && (
                        <div className="mt-1 px-2 py-1 rounded-lg bg-amber-500/6 border border-amber-500/30 text-[9px] text-amber-300">
                          Near resonance between input motion and T₁.
                        </div>
                      )}

                      {result.designMetrics && (
                        <>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                              <div className="text-[9px] text-slate-500">
                                SDS
                              </div>
                              <div className="text-xs font-semibold text-slate-100">
                                {result.designMetrics.SDS.toFixed(
                                  3
                                )}{" "}
                                g
                              </div>
                            </div>
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                              <div className="text-[9px] text-slate-500">
                                Cs
                              </div>
                              <div className="text-xs font-semibold text-slate-100">
                                {result.designMetrics.Cs.toFixed(
                                  3
                                )}
                              </div>
                            </div>
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                              <div className="text-[9px] text-slate-500">
                                Base shear
                              </div>
                              <div className="text-xs font-semibold text-slate-100">
                                {result.designMetrics.baseShear_kN.toFixed(
                                  1
                                )}{" "}
                                kN
                              </div>
                            </div>
                          </div>
                          <div
                            className={[
                              "mt-2 px-2 py-1 rounded-lg flex items-center justify-between text-[9px]",
                              result
                                .designMetrics
                                .driftCheck
                                ? "bg-emerald-500/6 border border-emerald-500/40 text-emerald-300"
                                : "bg-red-500/6 border border-red-500/40 text-red-300",
                            ].join(" ")}
                          >
                            <span>Drift limit</span>
                            <span className="font-semibold">
                              {(
                                result
                                  .designMetrics
                                  .driftLimit * 100
                              ).toFixed(1)}
                              % —{" "}
                              {result
                                .designMetrics
                                .driftCheck
                                ? "PASS"
                                : "FAIL"}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="rounded-2xl p-4 bg-slate-950/95 border border-slate-800 flex flex-col gap-2">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        Dynamic & Stability
                      </div>

                      {result.designMetrics?.dynamic &&
                      result.designMetrics?.stability ? (
                        <>
                          <div className="grid grid-cols-3 gap-3 text-[10px]">
                            <div>
                              <div className="text-[9px] text-slate-500">
                                V_dyn,max
                              </div>
                              <div className="text-xs font-semibold text-slate-100">
                                {result.designMetrics.dynamic.baseShearMax_kN.toFixed(
                                  1
                                )}{" "}
                                kN
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-slate-500">
                                V_dyn /
                                V_design
                              </div>
                              <div
                                className={`text-xs font-semibold ${
                                  result
                                    .designMetrics
                                    .dynamic
                                    .baseShearRatioToDesign >
                                  1.3
                                    ? "text-red-300"
                                    : "text-emerald-300"
                                }`}
                              >
                                {result.designMetrics.dynamic.baseShearRatioToDesign.toFixed(
                                  2
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-slate-500">
                                Worst θ
                              </div>
                              <div
                                className={`text-xs font-semibold ${
                                  Math.max(
                                    ...result
                                      .designMetrics
                                      .stability
                                      .thetaPerStory
                                  ) >
                                  0.2
                                    ? "text-red-300"
                                    : "text-emerald-300"
                                }`}
                              >
                                {Math.max(
                                  ...result
                                    .designMetrics
                                    .stability
                                    .thetaPerStory
                                ).toFixed(3)}
                              </div>
                            </div>
                          </div>

                          <div className="mt-2 bg-slate-950 border border-slate-900 rounded-lg max-h-28 overflow-y-auto custom-scrollbar -mr-2 pr-3">
                            <table className="w-full text-[9px]">
                              <thead className="bg-slate-950 sticky top-0">
                                <tr className="text-slate-500 border-b border-slate-900">
                                  <th className="px-2 py-1 text-left">
                                    Fl
                                  </th>
                                  <th className="px-2 py-1 text-right">
                                    Drift%
                                  </th>
                                  <th className="px-2 py-1 text-right">
                                    θ
                                  </th>
                                  <th className="px-2 py-1 text-center">
                                    Check
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {result.designMetrics.drifts?.maxDriftPerStory.map(
                                  (d, i) => {
                                    const theta =
                                      result
                                        .designMetrics!
                                        .stability!
                                        .thetaPerStory[i];
                                    const pass =
                                      result
                                        .designMetrics!
                                        .drifts!
                                        .driftPassPerStory[i];
                                    const flag =
                                      result
                                        .designMetrics!
                                        .stability!
                                        .stabilityFlags[i];
                                    return (
                                      <tr
                                        key={i}
                                        className="border-b border-slate-900/80"
                                      >
                                        <td className="px-2 py-1 text-slate-300">
                                          {i + 1}
                                        </td>
                                        <td className="px-2 py-1 text-right text-slate-300">
                                          {(d * 100).toFixed(
                                            2
                                          )}
                                        </td>
                                        <td
                                          className={`px-2 py-1 text-right ${
                                            flag ===
                                            "Critical"
                                              ? "text-red-300"
                                              : flag ===
                                                "Warning"
                                              ? "text-yellow-300"
                                              : "text-emerald-300"
                                          }`}
                                        >
                                          {theta.toFixed(
                                            3
                                          )}
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                          <span
                                            className={`px-1.5 py-0.5 rounded-md text-[8px] ${
                                              pass
                                                ? "bg-emerald-500/10 text-emerald-300"
                                                : "bg-red-500/10 text-red-300"
                                            }`}
                                          >
                                            {pass
                                              ? "OK"
                                              : "FAIL"}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  }
                                )}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-slate-500">
                          Dynamic / stability summary not
                          available for this run.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {result && (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl px-4 py-3 bg-slate-950/95 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-50">
                      AI optimization & cost impact
                    </span>
                    <span className="text-xs text-slate-500">
                      Generated automatically from your simulation inputs and
                      damage results.
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setShowOptimizationPanel((v) => !v)
                    }
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-100 flex items-center gap-2 transition"
                  >
                    {showOptimizationPanel
                      ? "Hide AI recommendations"
                      : "View AI optimization & costs"}
                    <span
                      className={`inline-block text-[9px] transition-transform ${
                        showOptimizationPanel
                          ? "rotate-180"
                          : ""
                      }`}
                    >
                      ▼
                    </span>
                  </button>
                </div>

                {showOptimizationPanel && (
                  <>
                    {optimizationLoading && (
                      <div className="px-4 py-3 rounded-2xl bg-slate-950/95 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                        Computing optimization suggestions based on this run...
                      </div>
                    )}

                    {optimizationError && (
                      <div className="px-4 py-3 rounded-2xl bg-red-500/5 border border-red-500/40 text-xs text-red-300">
                        {optimizationError}
                      </div>
                    )}

                    {parameterChanges.length > 0 && (
                      <ParameterChanges
                        changes={parameterChanges}
                        onApplyChange={applyParameterChange}
                        onApplyAll={applyAllParameterChanges}
                      />
                    )}

                    <OptimizationRecommendations
                      recommendations={optimizationResult || ""}
                      loading={optimizationLoading}
                      error={optimizationError}
                      onClose={() => {
                        setShowOptimizationPanel(false);
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
