"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Hash, Sparkle } from "@/components/icons";

type Phase = "typing" | "working" | "done";

const stages = [
  {
    key: "signup",
    title: "Sign up",
    blurb: "Email and a name. Nothing to configure.",
    typed: "priya@acme.dev",
  },
  {
    key: "workspace",
    title: "Create a workspace",
    blurb: "Name it. Your first channels come with it.",
    typed: "Acme Engineering",
  },
  {
    key: "agent",
    title: "Invite an agent",
    blurb: "It joins the channel and starts working.",
    typed: "/invite @review-bot",
  },
] as const;

function Field({
  label,
  value,
  caret,
  mono = false,
}: {
  label: string;
  value: string;
  caret: boolean;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-muted">
        {label}
      </span>
      <span className="flex h-10 items-center rounded-[9px] border border-line-strong bg-paper px-3">
        <span
          className={`text-[13.5px] text-ink ${mono ? "font-mono text-[13px]" : ""}`}
        >
          {value}
        </span>
        {caret ? (
          <span className="caret ml-px inline-block h-4 w-px bg-ink/60" />
        ) : null}
      </span>
    </label>
  );
}

export function OnboardingDemo() {
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const [live, setLive] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);

  /* only start once it is on screen */
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setLive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setLive(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  /* type, act, settle, advance, loop */
  useEffect(() => {
    if (!live) return;

    const target = stages[step].typed;
    const timers: number[] = [];
    let i = 0;

    setTyped("");
    setPhase("typing");

    const tick = () => {
      i += 1;
      setTyped(target.slice(0, i));
      if (i < target.length) {
        timers.push(window.setTimeout(tick, 46));
      } else {
        timers.push(window.setTimeout(() => setPhase("working"), 420));
        timers.push(window.setTimeout(() => setPhase("done"), 1250));
        timers.push(
          window.setTimeout(
            () => setStep((s) => (s + 1) % stages.length),
            3400,
          ),
        );
      }
    };

    timers.push(window.setTimeout(tick, 520));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [step, live]);

  const typing = phase === "typing";
  const done = phase === "done";

  return (
    <div ref={rootRef} className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-10">
      {/* step rail */}
      <ol className="flex flex-col gap-2">
        {stages.map((s, i) => {
          const active = i === step;
          const passed = i < step;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={`w-full rounded-panel border px-4 py-3.5 text-left transition-colors ${
                  active
                    ? "border-accent-line bg-accent-soft"
                    : "border-line bg-paper hover:border-line-strong"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      active
                        ? "bg-accent text-white"
                        : passed
                          ? "bg-free text-white"
                          : "bg-mist text-muted"
                    }`}
                  >
                    {passed ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span
                    className={`text-[15px] font-semibold ${
                      active ? "text-accent" : "text-ink"
                    }`}
                  >
                    {s.title}
                  </span>
                </span>
                <span className="mt-1 block pl-[30px] text-[13.5px] leading-snug text-body">
                  {s.blurb}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* stage */}
      <div className="overflow-hidden rounded-surface border border-line-strong bg-mist shadow-[0_20px_50px_-30px_rgba(11,12,16,0.35)]">
        <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-[11px] text-muted">
            {step === 2 ? "freeflow / #engineering" : "freeflow / get started"}
          </span>
        </div>

        <div className="flex min-h-[292px] items-center justify-center p-6 sm:min-h-[320px] sm:p-8">
          {/* 1. sign up */}
          {step === 0 ? (
            <div className="w-full max-w-sm rounded-panel border border-line bg-paper p-6">
              <h3 className="text-[1.0625rem] font-semibold">
                Create your account
              </h3>
              <p className="mt-1 text-[13.5px] text-body">
                Free, and it stays that way.
              </p>
              <div className="mt-5 flex flex-col gap-4">
                <Field label="Email" value={typed} caret={typing} />
                <button
                  type="button"
                  tabIndex={-1}
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-full text-[14px] font-medium transition-colors ${
                    done ? "bg-free text-white" : "bg-accent text-white"
                  }`}
                >
                  {done ? (
                    <>
                      <Check className="size-4" />
                      Account created
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* 2. create a workspace */}
          {step === 1 ? (
            <div className="w-full max-w-sm rounded-panel border border-line bg-paper p-6">
              <h3 className="text-[1.0625rem] font-semibold">
                Name your workspace
              </h3>
              <p className="mt-1 text-[13.5px] text-body">
                You can rename it later.
              </p>
              <div className="mt-5 flex flex-col gap-4">
                <Field label="Workspace" value={typed} caret={typing} />
                {done ? (
                  <div className="flex flex-col gap-1.5 rounded-[9px] border border-line bg-mist p-3">
                    <span className="text-[12px] font-medium text-free">
                      Workspace ready
                    </span>
                    {["general", "engineering"].map((c) => (
                      <span
                        key={c}
                        className="flex items-center gap-1.5 text-[13px] text-ink"
                      >
                        <Hash className="size-3.5 text-muted" />
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-medium text-white"
                  >
                    Create workspace
                    <ArrowRight className="size-4" />
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* 3. invite an agent */}
          {step === 2 ? (
            <div className="w-full max-w-md">
              <div className="rounded-panel border border-line bg-paper">
                <div className="flex flex-col gap-3 px-4 py-4">
                  {done ? (
                    <>
                      <p className="text-[12.5px] text-muted">
                        review-bot joined #engineering
                      </p>
                      <div className="flex gap-2.5">
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-accent text-white">
                          <Sparkle className="size-4" />
                        </span>
                        <div>
                          <span className="flex items-baseline gap-2">
                            <span className="text-[13px] font-semibold text-ink">
                              review-bot
                            </span>
                            <span className="rounded bg-accent-soft px-1 py-px font-mono text-[9px] tracking-wide text-accent uppercase">
                              agent
                            </span>
                          </span>
                          <p className="text-[13.5px] leading-relaxed text-body">
                            Here. Point me at a repo and I&rsquo;ll start
                            reviewing pull requests.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="py-6 text-center text-[13px] text-muted">
                      No agents in this channel yet.
                    </p>
                  )}
                </div>

                <div className="border-t border-line px-4 py-3">
                  <span className="flex h-10 items-center rounded-[9px] border border-line-strong px-3">
                    <span className="font-mono text-[13px] text-ink">
                      {typed}
                    </span>
                    {typing ? (
                      <span className="caret ml-px inline-block h-4 w-px bg-ink/60" />
                    ) : null}
                    {!typing && !done ? (
                      <span className="ml-auto flex gap-[3px]">
                        <span className="typing-dot size-1.5 rounded-full bg-muted" />
                        <span
                          className="typing-dot size-1.5 rounded-full bg-muted"
                          style={{ animationDelay: "160ms" }}
                        />
                        <span
                          className="typing-dot size-1.5 rounded-full bg-muted"
                          style={{ animationDelay: "320ms" }}
                        />
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
