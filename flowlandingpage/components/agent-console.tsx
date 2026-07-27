"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import {
  ArrowRight,
  Bug,
  Box,
  Branch,
  Check,
  Code,
  Github,
  Hash,
  Play,
  Server,
  Sparkle,
} from "@/components/icons";

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

type Step = { icon: Glyph; label: string; detail?: string };

type Scenario = {
  id: string;
  prompt: string;
  match: string[];
  steps: Step[];
  reply: string;
};

/**
 * Scripted, but every step is something the agent runtime actually does.
 * The point of the demo is the shape of the interaction, not a live model.
 */
const scenarios: Scenario[] = [
  {
    id: "review",
    prompt: "review PR #412 before I merge it",
    match: ["review", "pr", "412", "diff", "merge"],
    steps: [
      { icon: Code, label: "Read the diff", detail: "6 files · +248 −31" },
      { icon: Play, label: "Ran the test suite", detail: "412 passed" },
      { icon: Bug, label: "Found a blocking issue", detail: "blob.ts:88" },
      { icon: Branch, label: "Pushed a fix", detail: "sam/blob-encryption" },
    ],
    reply:
      "The IV is reused across writes in blob.ts:88, which breaks the GCM guarantee. I pushed a fix and I'm holding the merge until e2e goes green.",
  },
  {
    id: "latency",
    prompt: "why is p99 up since this morning?",
    match: ["p99", "latency", "slow", "why", "regress", "up"],
    steps: [
      { icon: Server, label: "Compared the last two deploys" },
      { icon: Branch, label: "Bisected to a1f9c02" },
      { icon: Code, label: "Read gateway/fanout.ts" },
    ],
    reply:
      "a1f9c02 moved the NATS publish inside the write transaction, so every message now waits on the commit. Want me to open a revert?",
  },
  {
    id: "ship",
    prompt: "ship staging",
    match: ["ship", "deploy", "staging", "release", "rollout"],
    steps: [
      { icon: Check, label: "Checked CI", detail: "green" },
      { icon: Box, label: "Built 7c31de9" },
      { icon: Play, label: "Deployed to staging" },
      { icon: Server, label: "Health check passing", detail: "4m" },
    ],
    reply:
      "Staging is on 7c31de9 and p99 is steady at 41ms. Say the word and I'll roll it back.",
  },
  {
    id: "owner",
    prompt: "who owns fanout.ts?",
    match: ["who", "own", "blame", "wrote", "fanout"],
    steps: [
      { icon: Code, label: "Searched the repo" },
      { icon: Github, label: "Read git blame" },
    ],
    reply:
      "Sam Okonkwo. 14 of the last 20 commits, most recently three days ago, and Priya reviewed nine of them.",
  },
];

function pick(query: string): Scenario {
  const q = query.toLowerCase();
  let best = scenarios[0];
  let bestScore = 0;
  for (const s of scenarios) {
    const score = s.match.reduce((n, k) => (q.includes(k) ? n + 1 : n), 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

export function AgentConsole() {
  const [value, setValue] = useState("");
  const [run, setRun] = useState<{
    scenario: Scenario;
    prompt: string;
    step: number;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const started = useRef(false);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const start = useCallback((scenario: Scenario, prompt: string) => {
    clearTimers();
    setValue("");
    setRun({ scenario, prompt, step: -1 });
  }, []);

  /* advance one step at a time */
  useEffect(() => {
    if (!run) return;
    if (run.step >= run.scenario.steps.length) return;
    const delay = run.step === -1 ? 720 : 540;
    const t = window.setTimeout(() => {
      setRun((r) => (r ? { ...r, step: r.step + 1 } : r));
    }, delay);
    timers.current.push(t);
    return () => window.clearTimeout(t);
  }, [run]);

  /* type the first question out, like a person would */
  const typeAndSend = useCallback(
    (scenario: Scenario) => {
      clearTimers();
      setRun(null);
      let i = 0;
      const tick = () => {
        i += 1;
        setValue(scenario.prompt.slice(0, i));
        if (i < scenario.prompt.length) {
          timers.current.push(window.setTimeout(tick, 34));
        } else {
          timers.current.push(
            window.setTimeout(() => start(scenario, scenario.prompt), 460),
          );
        }
      };
      timers.current.push(window.setTimeout(tick, 350));
    },
    [start],
  );

  /* kick off once the console scrolls into view */
  useEffect(() => {
    const node = rootRef.current;
    if (!node || started.current) return;

    if (typeof IntersectionObserver === "undefined") {
      started.current = true;
      typeAndSend(scenarios[0]);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            typeAndSend(scenarios[0]);
            io.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [typeAndSend]);

  useEffect(() => () => clearTimers(), []);

  const busy = run !== null && run.step < run.scenario.steps.length;
  const done = run !== null && run.step >= run.scenario.steps.length;

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-surface border border-line-strong bg-paper shadow-[0_28px_70px_-24px_rgba(0,0,0,0.55)]"
    >
      {/* channel header */}
      <div className="flex items-center gap-2 border-b border-line bg-mist px-4 py-3">
        <Hash className="size-4 text-muted" />
        <span className="text-[13.5px] font-semibold text-ink">engineering</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2 py-1 text-[11px] text-muted">
          <span className="size-1.5 rounded-full bg-[#3fbf7f]" />
          agent online
        </span>
      </div>

      {/* transcript */}
      <div className="flex min-h-[300px] flex-col gap-4 px-4 py-4 sm:min-h-[330px] sm:px-5">
        {run ? (
          <>
            <div className="flex gap-2.5">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[#3f6212] text-[10px] font-semibold text-white">
                YO
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-ink">You</span>
                  <span className="text-[11px] text-muted">now</span>
                </div>
                <p className="text-[13.5px] leading-relaxed text-body">
                  {run.prompt}
                </p>
              </div>
            </div>

            <div className="flex gap-2.5">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-accent text-[10px] font-semibold text-white">
                <Sparkle className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-ink">
                    freeflow agent
                  </span>
                  <span className="rounded bg-accent-soft px-1 py-px font-mono text-[9px] tracking-wide text-accent uppercase">
                    agent
                  </span>
                </div>

                {run.step === -1 ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="typing-dot size-1.5 rounded-full bg-muted" />
                    <span
                      className="typing-dot size-1.5 rounded-full bg-muted"
                      style={{ animationDelay: "160ms" }}
                    />
                    <span
                      className="typing-dot size-1.5 rounded-full bg-muted"
                      style={{ animationDelay: "320ms" }}
                    />
                  </div>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {run.scenario.steps.map((s, i) => {
                      if (i > run.step) return null;
                      const complete = i < run.step;
                      const StepIcon = s.icon;
                      return (
                        <li
                          key={s.label}
                          className={`flex items-center gap-2.5 rounded-[9px] border px-3 py-2 text-[13px] ${
                            complete
                              ? "border-line bg-mist text-body"
                              : "border-accent-line bg-accent-soft text-accent"
                          }`}
                        >
                          <StepIcon
                            className={`size-[15px] shrink-0 ${
                              complete ? "text-free" : ""
                            }`}
                          />
                          <span className="truncate">{s.label}</span>
                          {s.detail ? (
                            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                              {s.detail}
                            </span>
                          ) : null}
                          {complete ? (
                            <Check className="size-[14px] shrink-0 text-free" />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {done ? (
                  <p className="mt-3 text-[13.5px] leading-relaxed text-body">
                    {run.scenario.reply}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[13.5px] text-muted">Ask the agent something.</p>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-line bg-mist px-4 py-3.5 sm:px-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = value.trim();
            if (!q || busy) return;
            start(pick(q), q);
          }}
          className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3 py-2"
        >
          <Sparkle className="size-4 shrink-0 text-accent" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask the agent to do something…"
            aria-label="Ask the agent"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || value.trim().length === 0}
            aria-label="Send"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity disabled:opacity-30"
          >
            <ArrowRight className="size-4" />
          </button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">
            try
          </span>
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => start(s, s.prompt)}
              className="rounded-full border border-line bg-paper px-2.5 py-1 text-[12px] text-body transition-colors hover:border-accent-line hover:text-accent"
            >
              {s.prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
