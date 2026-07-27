"use client";

import { useState } from "react";

export type CodeTab = {
  id: string;
  label: string;
  file: string;
  lines: string[];
};

/**
 * Tabbed code panel. Comments are dimmed so the shape of the API reads at a
 * glance without pulling in a syntax highlighter.
 */
export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(tabs[0].id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="overflow-hidden rounded-surface border border-white/10 bg-graphite">
      <div
        role="tablist"
        aria-label="Agent code examples"
        className="thin-scroll flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-2"
      >
        {tabs.map((tab) => {
          const on = tab.id === current.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => setActive(tab.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                on
                  ? "bg-white/15 text-white"
                  : "text-white/45 hover:bg-white/5 hover:text-white/75"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[11.5px] text-white/35">
          {current.file}
        </span>
      </div>

      <pre className="thin-scroll overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.8] sm:px-5 sm:text-[13px]">
        <code>
          {current.lines.map((line, i) => {
            const comment = line.trim().startsWith("//");
            return (
              <span
                key={`${current.id}-${i}`}
                className={`block whitespace-pre ${
                  comment ? "text-white/35" : "text-white/85"
                }`}
              >
                {line === "" ? " " : line}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
