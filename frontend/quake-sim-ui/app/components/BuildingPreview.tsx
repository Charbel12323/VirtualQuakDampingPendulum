import React from "react";

export type BuildingPreviewProps = {
  numFloors: number;
  buildingWidth: number;
  storyHeight: number;
  material: string;
  baseIsolated: boolean;
  systemType: string;
};

export default function BuildingPreview({
  numFloors,
  buildingWidth,
  storyHeight,
  material,
  baseIsolated,
  systemType,
}: BuildingPreviewProps) {
  const baseWidthPx = Math.max(90, Math.min(260, buildingWidth * 3.0));
  const totalHeightM = Math.max(0, numFloors) * storyHeight;

  const colors = {
    Steel: "bg-sky-500/30 border-sky-500/40 shadow-sky-500/20",
    Concrete: "bg-slate-400/25 border-slate-400/40 shadow-slate-400/20",
    Wood: "bg-amber-500/25 border-amber-500/40 shadow-amber-500/20",
    Masonry: "bg-rose-500/25 border-rose-500/40 shadow-rose-500/20",
  } as const;
  const colorKey = (colors as any)[material] || colors.Concrete;

  return (
    <div className="h-full w-full relative flex flex-col overflow-hidden bg-linear-to-b from-slate-900 to-slate-800">
      <div className="absolute inset-x-0 top-0 h-24 bg-linear-to-b from-slate-700/20 to-transparent pointer-events-none" />

      <div className="flex-1 relative flex items-end justify-center pb-3">
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-linear-to-r from-amber-700 via-amber-600 to-amber-700 shadow-lg" />

        {baseIsolated && (
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-10 h-3 bg-blue-500/70 rounded-full shadow-lg shadow-blue-500/30 animate-pulse"
              />
            ))}
          </div>
        )}

        <div
          className="relative flex flex-col-reverse items-center"
          style={{ transition: "transform 120ms ease" }}
        >
          {Array.from({ length: Math.max(0, numFloors) }).map((_, i) => {
            const floorIdx = i;
            const taper =
              1 - (floorIdx / Math.max(1, numFloors - 1)) * 0.1;
            const floorWidth = baseWidthPx * taper;

            return (
              <div key={floorIdx} className="relative mb-1">
                <div
                  className={[
                    "relative h-5 rounded-sm border shadow-sm transition-all duration-200",
                    colorKey,
                  ].join(" ")}
                  style={{ width: `${floorWidth}px` }}
                >
                  {floorIdx < numFloors - 1 && (
                    <div className="absolute -bottom-5 left-0 right-0 flex justify-between px-6">
                      {[0, 1, 2, 3].map((c) => (
                        <div
                          key={c}
                          className="w-1 h-5 bg-slate-700/90 rounded-full"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-900/60 backdrop-blur-sm px-4 py-3 flex items-center justify-between text-[11px] text-slate-300">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700 text-slate-200">
            {material}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700 text-slate-200">
            {systemType}
          </span>
          {baseIsolated && (
            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/40 text-blue-300">
              Base isolation
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 font-mono">
          <span>
            Width:{" "}
            <span className="text-slate-100 font-semibold">
              {buildingWidth.toFixed(0)}
            </span>{" "}
            m
          </span>
          <span>
            Floors:{" "}
            <span className="text-slate-100 font-semibold">
              {numFloors}
            </span>
          </span>
          <span>
            Total height:{" "}
            <span className="text-slate-100 font-semibold">
              {totalHeightM.toFixed(1)}
            </span>{" "}
            m
          </span>
        </div>
      </div>

      <div className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-md bg-slate-900/70 border border-slate-700 text-slate-300">
        Preview
      </div>
    </div>
  );
}
