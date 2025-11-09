"use client";

import React from "react";

interface OptimizationRecommendationsProps {
  recommendations: string;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
}

export default function OptimizationRecommendations({
  recommendations,
  loading = false,
  error = null,
  onClose,
}: OptimizationRecommendationsProps) {
  // Parse markdown-style formatting
  const parseRecommendations = (text: string) => {
    const lines = text.split("\n");
    const parsed: React.ReactNode[] = [];
    let currentSection: string | null = null;
    let inList = false;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      
      // Headers (### or ##)
      if (trimmed.match(/^#{1,3}\s+/)) {
        if (inList) inList = false;
        const headerText = trimmed.replace(/^#{1,3}\s+/, "");
        const level = (trimmed.match(/^#{1,3}/)?.[0].length || 1);
        
        parsed.push(
          <h3
            key={`header-${idx}`}
            className={`font-bold mt-6 mb-3 ${
              level === 1
                ? "text-2xl text-indigo-700"
                : level === 2
                ? "text-xl text-indigo-600"
                : "text-lg text-indigo-500"
            }`}
          >
            {headerText}
          </h3>
        );
      }
      // Bullet points
      else if (trimmed.match(/^[-*•]\s+/)) {
        inList = true;
        const content = trimmed.replace(/^[-*•]\s+/, "");
        
        // Detect priority markers
        let priorityColor = "text-gray-700";
        let priorityIcon = "";
        if (content.includes("🔴")) {
          priorityColor = "text-red-600 font-semibold";
          priorityIcon = "🔴";
        } else if (content.includes("🟡")) {
          priorityColor = "text-amber-600 font-semibold";
          priorityIcon = "🟡";
        } else if (content.includes("🟢")) {
          priorityColor = "text-green-600";
          priorityIcon = "🟢";
        }

        parsed.push(
          <li key={`bullet-${idx}`} className={`ml-6 mb-2 ${priorityColor}`}>
            <span className="inline-block w-2 h-2 bg-indigo-400 rounded-full mr-3 align-middle"></span>
            {content}
          </li>
        );
      }
      // Bold text (**text**)
      else if (trimmed.match(/\*\*[^*]+\*\*/)) {
        const formatted = trimmed.replace(
          /\*\*([^*]+)\*\*/g,
          '<strong class="font-bold text-gray-900">$1</strong>'
        );
        parsed.push(
          <p
            key={`bold-${idx}`}
            className="mb-2 text-gray-700"
            dangerouslySetInnerHTML={{ __html: formatted }}
          />
        );
      }
      // Regular paragraph
      else if (trimmed.length > 0 && !trimmed.startsWith("---")) {
        parsed.push(
          <p key={`para-${idx}`} className="mb-2 text-gray-700">
            {trimmed}
          </p>
        );
      }
      // Horizontal rule
      else if (trimmed.startsWith("---")) {
        parsed.push(<hr key={`hr-${idx}`} className="my-4 border-gray-300" />);
      }
    });

    return parsed;
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-300 rounded-lg p-6 mt-6">
        <div className="flex items-start">
          <div className="shrink-0">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-lg font-semibold text-red-800">
              Optimization Error
            </h3>
            <p className="mt-2 text-red-700">{error}</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-3 text-red-600 hover:text-red-800"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

}
