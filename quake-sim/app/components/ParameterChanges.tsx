"use client";

import React, { useEffect, useMemo, useState } from "react";

interface ParameterChange {
  parameter: string;
  currentValue: any;
  recommendedValue: any;
  reason: string;
}

interface ParameterChangesProps {
  changes: ParameterChange[];
  onApplyChange: (parameter: string, value: any) => void;
  onApplyAll: () => void;
}

const parameterLabels: Record<string, string> = {
  material: "Material",
  systemType: "Structural System",
  baseIsolated: "Base Isolation",
  numFloors: "Number of Floors",
  massPerFloor: "Mass per Floor (kg)",
  storyHeight: "Story Height (m)",
  extraDamping: "Extra Damping (%)",
  buildingWidth: "Building Width (m)",
};

export default function ParameterChanges({
  changes,
  onApplyChange,
  onApplyAll,
}: ParameterChangesProps) {
  if (!changes || changes.length === 0) {
    return null;
  }

  // Track which parameters were applied (by parameter key)
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ id: number; text: string } | null>(
    null
  );

  const labelFor = (param: string) => parameterLabels[param] || param;

  const showToast = (text: string) => {
    const id = Date.now();
    setToast({ id, text });
    // Auto-hide after 1.6s
    setTimeout(() => {
      setToast((cur) => (cur && cur.id === id ? null : cur));
    }, 1600);
  };

  const formatValue = (value: any, parameter: string): string => {
    if (typeof value === "boolean") {
      return value ? "Enabled" : "Disabled";
    }
    if (parameter === "extraDamping" && typeof value === "number") {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    return String(value);
  };

  return (
    <div className="relative mt-6 rounded-xl p-6 bg-slate-950/95 border border-slate-800 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-sky-600/20 text-sky-300 rounded-lg p-2 border border-sky-500/30">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-50">
              AI recommendations
            </h3>
            <p className="text-xs text-slate-500">
              Apply individually or apply all. Applied items turn into a green tick.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            onApplyAll();
            // Mark all as applied and show toast
            const next: Record<string, boolean> = {};
            for (const ch of changes) next[ch.parameter] = true;
            setApplied(next);
            showToast(`Applied all ${changes.length} changes`);
          }}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-50 rounded-lg text-xs font-medium transition-colors shadow-sm border border-slate-700 flex items-center gap-2"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          Apply all
        </button>
      </div>

      {/* Changes List */}
      <div className="space-y-3">
        {changes.map((change, index) => (
          <div
            key={index}
            className={[
              "relative rounded-lg p-4 border transition-colors bg-slate-950",
              "border-slate-800 hover:border-slate-600",
            ].join(" ")}
          >
            {/* Applied badge */}
            {applied[change.parameter] && (
              <div className="absolute -top-2 -right-2 bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded-full shadow-md border border-emerald-400/60">
                Applied
              </div>
            )}

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block px-2 py-0.5 bg-slate-900 text-slate-200 text-[10px] font-semibold rounded border border-slate-700">
                    {labelFor(change.parameter)}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <div className="text-[11px] text-slate-500 mb-1">Current</div>
                    <div className="text-sm font-semibold text-slate-200 bg-slate-900 rounded px-3 py-2 border border-slate-800">
                      {formatValue(change.currentValue, change.parameter)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 mb-1">Recommended</div>
                    <div className="text-sm font-semibold text-sky-300 bg-slate-900 rounded px-3 py-2 border border-sky-700/40">
                      {formatValue(change.recommendedValue, change.parameter)}
                    </div>
                  </div>
                </div>
                <div className="text-[12px] text-slate-300 bg-slate-900 border border-slate-800 p-3 rounded">
                  <span className="font-semibold text-slate-200">Reason:</span>{" "}
                  {change.reason}
                </div>
              </div>

              {applied[change.parameter] ? (
                <div className="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold shadow-md border border-emerald-400/60 flex items-center gap-1">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Applied
                </div>
              ) : (
                <button
                  onClick={() => {
                    onApplyChange(change.parameter, change.recommendedValue);
                    setApplied((prev) => ({
                      ...prev,
                      [change.parameter]: true,
                    }));
                    showToast(
                      `Applied ${labelFor(change.parameter)} → ${formatValue(
                        change.recommendedValue,
                        change.parameter
                      )}`
                    );
                  }}
                  className="shrink-0 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-50 rounded-lg text-xs font-medium transition-colors shadow-sm border border-slate-700 flex items-center gap-2"
                  title="Apply this change"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  Apply
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Note */}
      <div className="mt-4 pt-3 border-t border-slate-800 text-center">
        <p className="text-[11px] text-slate-500">
          Applying updates inputs. Re-run the simulation to visualize impact.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm shadow-lg border border-emerald-400/60">
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
