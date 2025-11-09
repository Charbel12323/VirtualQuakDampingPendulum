"use client";
import React, { useEffect, useState, useRef } from "react";

// Types
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
  };
  dt: number;
};

// Damage state colors and styles
const DAMAGE_COLORS = {
  None: { bg: "bg-green-500", border: "border-green-500", text: "text-green-500", glow: "shadow-green-500/50" },
  Slight: { bg: "bg-yellow-500", border: "border-yellow-500", text: "text-yellow-500", glow: "shadow-yellow-500/50" },
  Moderate: { bg: "bg-orange-500", border: "border-orange-500", text: "text-orange-500", glow: "shadow-orange-500/50" },
  Extensive: { bg: "bg-red-600", border: "border-red-600", text: "text-red-600", glow: "shadow-red-600/50" },
  Complete: { bg: "bg-red-900", border: "border-red-900", text: "text-red-900", glow: "shadow-red-900/50" },
};

// Preset scenarios
const SCENARIOS = {
  safe: {
    name: "Safe Design",
    pgaG: 0.15,
    duration: 10,
    freqHz: 2.0,
    material: "Steel",
    systemType: "DualSystem",
    baseIsolated: true,
    extraDamping: 0.05
  },
  moderate: {
    name: "Moderate Test",
    pgaG: 0.35,
    duration: 15,
    freqHz: 1.0,
    material: "Concrete",
    systemType: "MomentFrame",
    baseIsolated: false,
    extraDamping: 0.02
  },
  extreme: {
    name: "Extreme Event",
    pgaG: 0.6,
    duration: 20,
    freqHz: 0.8,
    material: "Concrete",
    systemType: "MomentFrame",
    baseIsolated: false,
    extraDamping: 0
  },
  collapse: {
    name: "Collapse Test",
    pgaG: 0.9,
    duration: 25,
    freqHz: 1.0,
    material: "Masonry",
    systemType: "UnreinforcedMasonry",
    baseIsolated: false,
    extraDamping: 0
  }
};

export default function ImprovedSeismicSimulator() {
  // Building parameters
  const [numFloors, setNumFloors] = useState(10);
  const [material, setMaterial] = useState("Concrete");
  const [systemType, setSystemType] = useState("MomentFrame");
  const [baseIsolated, setBaseIsolated] = useState(false);
  const [massPerFloor, setMassPerFloor] = useState(50000);
  const [storyHeight, setStoryHeight] = useState(3.5);
  const [extraDamping, setExtraDamping] = useState(0.02);
  // Code design parameters
  const [siteClass, setSiteClass] = useState<"B"|"C"|"D"|"E">("D");
  const [Ss, setSs] = useState(1.0);
  const [S1, setS1] = useState(0.4);
  const [R, setR] = useState(6.0);
  const [Ie, setIe] = useState(1.0);
  
  // Earthquake parameters
  const [pgaG, setPgaG] = useState(0.3);
  const [duration, setDuration] = useState(15);
  const [freqHz, setFreqHz] = useState(1.0);
  const [motionType, setMotionType] = useState<"harmonic" | "pulse" | "realistic">("realistic");
  
  // State
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef<number | null>(null);
  
  // Load scenario
  function loadScenario(scenario: keyof typeof SCENARIOS) {
    const s = SCENARIOS[scenario];
    setPgaG(s.pgaG);
    setDuration(s.duration);
    setFreqHz(s.freqHz);
    setMaterial(s.material);
    setSystemType(s.systemType);
    setBaseIsolated(s.baseIsolated);
    setExtraDamping(s.extraDamping);
  }
  
  // Run simulation
  async function runSimulation() {
    setLoading(true);
    setError(null);
    setIsAnimating(false);
    setFrameIndex(0);
    
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numFloors,
          material,
          systemType,
          baseIsolated,
          massPerFloor,
          storyHeight,
          pgaG,
          duration,
          freqHz,
          motionType,
          extraDamping,
          siteClass,
          Ss,
          S1,
          R,
          Ie
        })
      });
      
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Simulation failed");
      setResult(data);
      setIsAnimating(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  
  // Animation (reverted to simple fast frame advance each RAF)
  useEffect(() => {
    if (!result || !isAnimating) return;
    const frames = result.timeSeries.u;
    if (!frames || frames.length === 0) return;
    let localFrame = frameIndex;
    const animate = () => {
      localFrame = (localFrame + 1) % frames.length;
      setFrameIndex(localFrame);
      if (isAnimating) animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [result, isAnimating]);
  
  // Building visualization
  function BuildingVisualization({ data, frame }: { data: ApiResponse; frame: number }) {
    const floors = data.inputs.numFloors;
    const timeSeries = data.timeSeries.u;
    const damage = data.damage;
    
    // Simple scale factor (original fast version)
    const maxDisp = Math.max(...timeSeries.flat().map(Math.abs)) || 0.001;
    const scale = 100 / maxDisp; // pixels per meter
    
    return (
      <div className="relative h-full w-full flex items-end justify-center pb-8">
        {/* Ground */}
        <div className="absolute bottom-0 w-full h-2 bg-gray-700">
          {/* Ground motion indicator */}
          <div 
            className="absolute top-0 left-1/2 w-2 h-2 bg-yellow-400 rounded-full"
            style={{
              transform: `translateX(${(data.timeSeries.groundAccel[frame] || 0) * 10}px)`,
            }}
          />
        </div>
        
        {/* Building floors */}
        <div className="relative">
          {Array.from({ length: floors }).reverse().map((_, idx) => {
            const floorIdx = floors - 1 - idx;
            const floorDamage = damage.floorDamage[floorIdx];
            const displacement = timeSeries[frame]?.[floorIdx] || 0;
            const drift = frame > 0 ? data.timeSeries.driftHistory[frame]?.[floorIdx] || 0 : 0;
            
            const damageColor = DAMAGE_COLORS[floorDamage.damageState];
            const opacity = floorDamage.collapsed ? 0.3 : 1;
            const rotation = drift * 10; // original exaggerated rotation
            const shake = floorDamage.collapsed ? Math.random() * 5 : 0;
            
            return (
              <div
                key={floorIdx}
                className="relative mb-0.5 transition-all duration-75"
                style={{
                  transform: `translateX(${displacement * scale + shake}px) rotate(${rotation}deg)`,
                  opacity,
                }}
              >
                {/* Floor slab */}
                <div 
                  className={`h-3 w-48 ${damageColor.bg} ${damageColor.glow} shadow-lg border-2 ${damageColor.border}`}
                >
                  {/* Cracks for damaged floors */}
                  {floorDamage.damageState !== "None" && (
                    <div className="absolute inset-0 overflow-hidden">
                      {Array.from({ length: Math.ceil(floorDamage.damageRatio * 5) }).map((_, i) => (
                        <div
                          key={i}
                          className="absolute bg-black opacity-50"
                          style={{
                            height: "1px",
                            width: `${20 + Math.random() * 30}px`,
                            top: `${Math.random() * 100}%`,
                            left: `${Math.random() * 100}%`,
                            transform: `rotate(${-45 + Math.random() * 90}deg)`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  
                  {/* Floor number */}
                  <span className="absolute -left-8 text-xs text-gray-400">
                    F{floorIdx + 1}
                  </span>
                  
                  {/* Soft story indicator */}
                  {damage.softStoryIndex === floorIdx && (
                    <span className="absolute -right-16 text-xs text-red-400 animate-pulse">
                      Soft Story!
                    </span>
                  )}
                </div>
                
                {/* Columns (visible between floors) */}
                {idx < floors - 1 && (
                  <div className="absolute -bottom-3 flex justify-between w-full px-2">
                    <div className={`w-1 h-3 ${damageColor.bg} opacity-70`} />
                    <div className={`w-1 h-3 ${damageColor.bg} opacity-70`} />
                    <div className={`w-1 h-3 ${damageColor.bg} opacity-70`} />
                    <div className={`w-1 h-3 ${damageColor.bg} opacity-70`} />
                  </div>
                )}
              </div>
            );
          })}
          
          {/* Base isolator visualization */}
          {data.inputs.baseIsolated && (
            <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="w-6 h-3 bg-blue-500 rounded-full animate-pulse" />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Damage report card
  function DamageReport({ damage }: { damage: DamageAssessment }) {
    const damageColor = DAMAGE_COLORS[damage.worstDamageState];
    
    return (
      <div className={`bg-gray-900 rounded-lg p-4 border-2 ${damageColor.border}`}>
        <h3 className="text-lg font-bold mb-3">Damage Assessment</h3>
        
        {/* Life safety status */}
        <div className={`text-center py-2 px-4 rounded-lg mb-4 ${damageColor.bg} bg-opacity-20`}>
          <div className={`text-xl font-bold ${damageColor.text}`}>
            {damage.lifeSafety}
          </div>
        </div>
        
        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-400">Max Drift</div>
            <div className="text-lg font-semibold">
              {(damage.maxDrift * 100).toFixed(2)}%
            </div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-400">Peak Accel</div>
            <div className="text-lg font-semibold">
              {damage.peakAccel.toFixed(2)}g
            </div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-400">Repair Cost</div>
            <div className="text-lg font-semibold">
              {damage.totalRepairCost.toFixed(0)}%
            </div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-400">Status</div>
            <div className={`text-lg font-semibold ${damageColor.text}`}>
              {damage.buildingCollapsed
                ? (damage.buildingCollapseType === 'global'
                    ? 'GLOBAL COLLAPSE'
                    : `PARTIAL COLLAPSE (from F${damage.collapseBaseFloor})`)
                : damage.worstDamageState}
            </div>
          </div>
        </div>
        
        {/* Floor-by-floor damage */}
        <div className="text-xs">
          <div className="font-semibold mb-1">Floor Damage Summary:</div>
          <div className="max-h-64 overflow-y-auto pr-2">
            {damage.floorDamage.slice().reverse().map(floor => (
              <div key={floor.floor} className="flex justify-between py-0.5">
                <span>Floor {floor.floor}</span>
                <span className={DAMAGE_COLORS[floor.damageState].text}>
                  {floor.damageState} {floor.collapsed && "⚠️"}
                </span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Soft story warning */}
        {damage.softStoryIndex >= 0 && (
          <div className="mt-3 p-2 bg-red-900 bg-opacity-30 rounded text-sm text-red-400">
            ⚠️ Soft story detected at Floor {damage.softStoryIndex + 1}
          </div>
        )}
      </div>
    );
  }
  
  return (
  <div className="min-h-screen bg-linear-to-br from-gray-900 to-black text-white">
      {/* Header */}
      <header className="bg-black bg-opacity-50 backdrop-blur-lg border-b border-gray-800 p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold bg-linear-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
              Seismic Performance Simulator
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              Nonlinear time-history analysis with realistic damage modeling
            </p>
          </div>
          {result && (
            <div className="text-right text-xs text-gray-400">
              Building Period: <span className="text-blue-400">{result.inputs.fundamentalPeriod.toFixed(2)}s</span>
              <br />
              Total Damping: <span className="text-blue-400">{(result.inputs.xiTotal * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </header>
      
      <div className="container mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Controls */}
          <div className="lg:col-span-1 space-y-4">
            {/* Quick scenarios */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-2 text-sm">Quick Scenarios</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(SCENARIOS).map(([key, scenario]) => (
                  <button
                    key={key}
                    onClick={() => loadScenario(key as keyof typeof SCENARIOS)}
                    className={`py-2 px-3 rounded text-xs font-medium transition ${
                      key === 'collapse' 
                        ? 'bg-red-600 hover:bg-red-500' 
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    {scenario.name}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Building Design */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Building Design</h3>
              
              <div>
                <label className="text-xs text-gray-400">Number of Floors</label>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={numFloors}
                  onChange={(e) => setNumFloors(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 mt-1">{numFloors} floors</div>
              </div>
              
              <div>
                <label className="text-xs text-gray-400">Material</label>
                <select
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  className="w-full bg-gray-700 rounded px-2 py-1 text-sm"
                >
                  <option value="Steel">Steel (Ductile)</option>
                  <option value="Concrete">Concrete (Moderate)</option>
                  <option value="Wood">Wood (Flexible)</option>
                  <option value="Masonry">Masonry (Brittle!)</option>
                </select>
              </div>
              
              <div>
                <label className="text-xs text-gray-400">Structural System</label>
                <select
                  value={systemType}
                  onChange={(e) => setSystemType(e.target.value)}
                  className="w-full bg-gray-700 rounded px-2 py-1 text-sm"
                >
                  <option value="MomentFrame">Moment Frame</option>
                  <option value="BracedFrame">Braced Frame</option>
                  <option value="ShearWallCore">Shear Wall</option>
                  <option value="DualSystem">Dual System (Best)</option>
                  <option value="UnreinforcedMasonry">URM (Dangerous!)</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="baseIso"
                  checked={baseIsolated}
                  onChange={(e) => setBaseIsolated(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="baseIso" className="text-sm">Base Isolation</label>
              </div>
              
              <div>
                <label className="text-xs text-gray-400">Added Damping</label>
                <input
                  type="range"
                  min={0}
                  max={0.15}
                  step={0.01}
                  value={extraDamping}
                  onChange={(e) => setExtraDamping(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 mt-1">{(extraDamping * 100).toFixed(0)}%</div>
              </div>
            </div>
            
            {/* Code/Hazard Parameters */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Code/Hazard Parameters</h3>
              <div>
                <label className="text-xs text-gray-400">Site Class</label>
                <select
                  value={siteClass}
                  onChange={(e) => setSiteClass(e.target.value as any)}
                  className="w-full bg-gray-700 rounded px-2 py-1 text-sm"
                >
                  <option value="B">B (Rock)</option>
                  <option value="C">C (Very Dense Soil)</option>
                  <option value="D">D (Stiff Soil)</option>
                  <option value="E">E (Soft Soil)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">Ss (0.2s spectral accel, g)</label>
                <input type="range" min={0.1} max={2.0} step={0.05} value={Ss} onChange={(e)=>setSs(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500 mt-1">{Ss.toFixed(2)} g</div>
              </div>
              <div>
                <label className="text-xs text-gray-400">S1 (1.0s spectral accel, g)</label>
                <input type="range" min={0.05} max={0.8} step={0.01} value={S1} onChange={(e)=>setS1(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500 mt-1">{S1.toFixed(2)} g</div>
              </div>
              <div>
                <label className="text-xs text-gray-400">R (Response Modification Factor)</label>
                <input type="range" min={3} max={8} step={0.5} value={R} onChange={(e)=>setR(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500 mt-1">{R.toFixed(1)}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400">Importance Factor, Ie</label>
                <input type="range" min={1.0} max={1.5} step={0.05} value={Ie} onChange={(e)=>setIe(Number(e.target.value))} className="w-full" />
                <div className="text-xs text-gray-500 mt-1">{Ie.toFixed(2)}</div>
              </div>
            </div>

            {/* Earthquake Parameters */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Earthquake</h3>
              
              <div>
                <label className="text-xs text-gray-400">Peak Ground Acceleration</label>
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={pgaG}
                  onChange={(e) => setPgaG(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 mt-1">
                  {pgaG.toFixed(2)}g 
                  <span className="ml-2">
                    ({pgaG < 0.2 ? "Minor" : pgaG < 0.4 ? "Moderate" : pgaG < 0.6 ? "Strong" : "Extreme"})
                  </span>
                </div>
              </div>
              
              <div>
                <label className="text-xs text-gray-400">Duration (seconds)</label>
                <input
                  type="range"
                  min={5}
                  max={60}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 mt-1">{duration}s</div>
              </div>
              
              <div>
                <label className="text-xs text-gray-400">Dominant Frequency (Hz)</label>
                <input
                  type="range"
                  min={0.2}
                  max={5}
                  step={0.1}
                  value={freqHz}
                  onChange={(e) => setFreqHz(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 mt-1">{freqHz.toFixed(1)} Hz</div>
              </div>
              
              <div>
                <label className="text-xs text-gray-400">Motion Type</label>
                <select
                  value={motionType}
                  onChange={(e) => setMotionType(e.target.value as any)}
                  className="w-full bg-gray-700 rounded px-2 py-1 text-sm"
                >
                  <option value="realistic">Realistic (P + S waves)</option>
                  <option value="pulse">Near-Fault Pulse</option>
                  <option value="harmonic">Harmonic (Test)</option>
                </select>
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="space-y-2">
              <button
                onClick={() => runSimulation()}
                disabled={loading}
                className="w-full py-3 bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-lg font-semibold transition disabled:opacity-50"
              >
                {loading ? "Simulating..." : "Run Simulation"}
              </button>
            </div>
            
            {error && (
              <div className="p-3 bg-red-900 bg-opacity-30 border border-red-600 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
          
          {/* Center & Right: Visualization & Results */}
          <div className="lg:col-span-2 space-y-4">
            {/* Main visualization */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Building Response</h3>
                {result && (
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setIsAnimating(!isAnimating)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                    >
                      {isAnimating ? "Pause" : "Play"}
                    </button>
                    <div className="text-xs text-gray-400">
                      Time: {(frameIndex * result.dt).toFixed(2)}s
                    </div>
                  </div>
                )}
              </div>
              
              <div className="h-96 bg-gray-900 rounded-lg relative overflow-hidden">
                {result ? (
                  <BuildingVisualization data={result} frame={frameIndex} />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600">
                    <div className="text-center">
                      <div className="text-6xl mb-4">🏢</div>
                      <div>Run a simulation to see the building response</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Results grid */}
            {result && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Damage report */}
                <DamageReport damage={result.damage} />
                
                {/* Spectral values & metrics */}
                <div className="bg-gray-900 rounded-lg p-4">
                  <h3 className="text-lg font-bold mb-3">Response Spectrum</h3>
                  
                  <div className="space-y-3">
                    <div className="bg-gray-800 rounded p-3">
                      <div className="text-xs text-gray-400">Spectral Acceleration</div>
                      <div className="text-2xl font-bold text-blue-400">
                        {result.spectralValues.Sa.toFixed(3)}g
                      </div>
                    </div>
                    
                    <div className="bg-gray-800 rounded p-3">
                      <div className="text-xs text-gray-400">Spectral Displacement</div>
                      <div className="text-2xl font-bold text-green-400">
                        {(result.spectralValues.Sd * 100).toFixed(2)}cm
                      </div>
                    </div>
                    
                    <div className="bg-gray-800 rounded p-3">
                      <div className="text-xs text-gray-400">Spectral Velocity</div>
                      <div className="text-2xl font-bold text-yellow-400">
                        {(result.spectralValues.Sv * 100).toFixed(2)}cm/s
                      </div>
                    </div>
                    
                    {/* Resonance warning */}
                    {Math.abs(1 / freqHz - result.inputs.fundamentalPeriod) < 0.2 && (
                      <div className="p-2 bg-orange-900 bg-opacity-30 rounded text-sm text-orange-400">
                        ⚠️ Near resonance condition detected!
                      </div>
                    )}
                  </div>
                </div>

                {/* Code Design Checks */}
                {result.designMetrics && (
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-bold mb-3">Code Design Checks</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-800 rounded p-3">
                        <div className="text-xs text-gray-400">SDS</div>
                        <div className="text-xl font-bold text-blue-300">{result.designMetrics.SDS.toFixed(3)} g</div>
                      </div>
                      <div className="bg-gray-800 rounded p-3">
                        <div className="text-xs text-gray-400">SD1</div>
                        <div className="text-xl font-bold text-blue-300">{result.designMetrics.SD1.toFixed(3)} g·s</div>
                      </div>
                      <div className="bg-gray-800 rounded p-3">
                        <div className="text-xs text-gray-400">Cs</div>
                        <div className="text-xl font-bold text-green-300">{result.designMetrics.Cs.toFixed(3)}</div>
                      </div>
                      <div className="bg-gray-800 rounded p-3">
                        <div className="text-xs text-gray-400">Base Shear</div>
                        <div className="text-xl font-bold text-green-300">{(result.designMetrics.baseShear_kN).toFixed(1)} kN</div>
                      </div>
                      <div className="bg-gray-800 rounded p-3">
                        <div className="text-xs text-gray-400">Drift Limit</div>
                        <div className={`text-xl font-bold ${result.designMetrics.driftCheck ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(result.designMetrics.driftLimit*100).toFixed(1)}% ({result.designMetrics.driftCheck ? 'PASS' : 'FAIL'})
                        </div>
                      </div>
                      <div className="bg-gray-800 rounded p-3">
                        <div className="text-xs text-gray-400">T1</div>
                        <div className="text-xl font-bold text-yellow-300">{result.inputs.fundamentalPeriod.toFixed(2)} s</div>
                      </div>
                    </div>
                    {/* Story shear table */}
                    <div className="mt-3 max-h-48 overflow-y-auto pr-2 text-xs">
                      <div className="font-semibold mb-1">Story Shear (kN):</div>
                      {result.designMetrics.storyShearN.slice().map((v, i) => (
                        <div className="flex justify-between py-0.5" key={i}>
                          <span>F{i+1}</span>
                          <span>{(v/1000).toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}