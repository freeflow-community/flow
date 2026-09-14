"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check } from "@/components/icons";
import { PrismAvatar } from "@/components/prism-avatar";

const steps = [
  {
    number: "01",
    title: "Invite your agent",
    body: "Add an agent to your channel like any teammate.",
  },
  {
    number: "02",
    title: "Mention it in a channel",
    body: "Ask for anything using @agent. The agent reads the thread.",
  },
  {
    number: "03",
    title: "Keep working together",
    body: "The agent shows progress, shares results, and you steer.",
  },
] as const;

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[9px] font-semibold text-white"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function DemoFrame({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative mt-5 h-[205px] overflow-hidden rounded-panel border bg-paper p-5 text-left transition-all duration-500 ${
        active
          ? "-translate-y-1 border-accent-line shadow-[0_24px_54px_-36px_rgba(109,53,198,0.85)]"
          : "border-line"
      }`}
    >
      {children}
    </div>
  );
}

function AgentRow({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className={`flex gap-2.5 ${muted ? "opacity-55" : ""}`}>
      <PrismAvatar />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-ink">
          Prism
          <span className="rounded bg-accent-soft px-1 font-mono text-[7px] tracking-wide text-accent uppercase">
            agent
          </span>
          <span className="font-normal text-muted">9:15 AM</span>
        </div>
        <div className="mt-0.5 text-[11px] leading-[1.45] text-body">{children}</div>
      </div>
    </div>
  );
}

function InviteFrame({ active }: { active: boolean }) {
  return (
    <DemoFrame active={active}>
      <div className="flex gap-2.5">
        <Avatar initials="RC" color="#2f8f87" />
        <div>
          <div className="flex items-baseline gap-2 text-[10.5px] font-semibold text-ink">Rina Cole <span className="font-normal text-muted">9:14 AM</span></div>
          <p className="mt-0.5 text-[11px] leading-[1.45] text-body">
            <span className="font-medium text-accent">@Prism</span> mind taking a look at PR #412 before I merge?
          </p>
          <span className="mt-2 inline-flex rounded-full border border-line bg-mist px-2 py-0.5 text-[9px] text-body">👀 2</span>
        </div>
      </div>
      <div className="my-4 h-px bg-line" />
      <AgentRow>Got it. Checking the diff.</AgentRow>
    </DemoFrame>
  );
}

function WorkFrame({ active }: { active: boolean }) {
  return (
    <DemoFrame active={active}>
      <AgentRow>Reading 26 messages…</AgentRow>
      <div className="ml-[38px] mt-3 flex gap-1.5" aria-label="Agent working">
        {[0, 1, 2, 3, 4].map((dot) => (
          <span
            key={dot}
            className={`size-2 rounded-full bg-accent ${active ? "typing-dot" : "opacity-30"}`}
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </div>
      <div className="my-5 h-px bg-line" />
      <AgentRow muted={!active}>Running tests and tracing the changed path…</AgentRow>
      <div className="absolute inset-x-5 bottom-5 overflow-hidden rounded-full bg-accent-soft">
        <span className={`block h-1 bg-accent transition-[width] duration-[1600ms] ${active ? "w-[78%]" : "w-[24%]"}`} />
      </div>
    </DemoFrame>
  );
}

function ResultFrame({ active }: { active: boolean }) {
  return (
    <DemoFrame active={active}>
      <AgentRow>Two issues found. Patch ready.</AgentRow>
      <div className="mt-4 rounded-xl border border-line bg-mist p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-semibold text-ink">PR #412 review</span>
          <span className="rounded-full bg-free-soft px-2 py-0.5 font-mono text-[7px] text-free uppercase">Ready</span>
        </div>
        <div className="mt-3 space-y-2">
          {["Race condition", "Missing error path", "Tests passing"].map((task, index) => (
            <div key={task} className="flex items-center gap-2">
              <span className={`inline-flex size-3.5 items-center justify-center rounded-full border ${index === 0 ? "border-free bg-free text-white" : "border-line-strong bg-paper"}`}>
                {index === 0 ? <Check className="size-2" /> : null}
              </span>
              <span className="text-[9px] text-body">{task}</span>
              <span className={`ml-auto size-1.5 rounded-full ${active ? "bg-free" : "bg-line-strong"}`} />
            </div>
          ))}
        </div>
      </div>
    </DemoFrame>
  );
}

export function CollaborationDemo() {
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setRunning(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setRunning(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % steps.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div ref={rootRef} className="grid items-end gap-4 lg:grid-cols-[1fr_32px_1fr_32px_1fr]">
      {steps.map((step, index) => (
        <div key={step.number} className={index === 0 ? "" : "contents"}>
          {index > 0 ? (
          <ArrowRight className="mb-[92px] hidden size-5 self-end justify-self-center text-ink lg:block" />
          ) : null}
          <button
            type="button"
            onClick={() => setActive(index)}
            onMouseEnter={() => setActive(index)}
            className="block w-full text-left"
            aria-label={`Show step ${step.number}: ${step.title}`}
          >
            <div className="flex gap-3">
              <span className="font-mono text-[12px] font-medium text-accent">{step.number}</span>
              <div>
                <h3 className="text-[15px] font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-[13px] leading-snug text-body">{step.body}</p>
              </div>
            </div>
            {index === 0 ? <InviteFrame active={active === index} /> : null}
            {index === 1 ? <WorkFrame active={active === index} /> : null}
            {index === 2 ? <ResultFrame active={active === index} /> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
