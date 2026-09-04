import { CollaborationDemo } from "@/components/collaboration-demo";
import { PrismAvatar } from "@/components/prism-avatar";
import { Reveal } from "@/components/reveal";
import { Container } from "@/components/ui";
import { Check, Code, Lock, Server, Sparkle } from "@/components/icons";

function SmallMessage({ initials, color, width }: { initials: string; color: string; width: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex size-6 items-center justify-center rounded-full text-[7px] font-semibold text-white" style={{ backgroundColor: color }}>
        {initials}
      </span>
      <span className={`h-2 rounded-full bg-line-strong ${width}`} />
    </div>
  );
}

function OldWayVisual() {
  return (
    <div className="mt-7 grid min-h-[230px] grid-cols-[1fr_58px_0.92fr] items-center gap-2">
      <div className="rounded-xl border border-line-strong bg-paper p-4 shadow-sm">
        <div className="text-[10px] font-semibold text-ink">Team chat</div>
        <div className="mt-4 space-y-3.5">
          <SmallMessage initials="RC" color="#2f8f87" width="w-20 sm:w-24" />
          <SmallMessage initials="DM" color="#c75d35" width="w-16 sm:w-20" />
          <SmallMessage initials="MH" color="#365fa6" width="w-20 sm:w-28" />
        </div>
      </div>
      <svg className="h-[190px] w-full overflow-visible text-accent" viewBox="0 0 58 190" fill="none" aria-hidden="true">
        <path d="M1 77 C28 77 24 46 50 46" stroke="currentColor" strokeWidth="1.8" strokeDasharray="5 5" />
        <path d="M1 112 C28 112 24 148 50 148" stroke="currentColor" strokeWidth="1.8" strokeDasharray="5 5" />
        <path d="m47 41 7 5-7 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m47 143 7 5-7 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-line-strong bg-paper p-3 shadow-sm">
          <div className="text-[9px] font-semibold text-ink">Terminal</div>
          <div className="mt-2 rounded-md bg-[#17111f] p-3 font-mono text-[7px] leading-relaxed text-white/55">&gt; compare deploys<br />reading 14 files…</div>
        </div>
        <div className="rounded-xl border border-line-strong bg-paper p-3 shadow-sm">
          <div className="text-[9px] font-semibold text-ink">Copied result</div>
          <div className="mt-3 flex gap-2"><span className="text-[12px] text-muted">▧</span><div className="flex-1 space-y-2 pt-1"><div className="h-1.5 w-full rounded-full bg-line" /><div className="h-1.5 w-2/3 rounded-full bg-line" /></div></div>
        </div>
      </div>
    </div>
  );
}

function NewWayVisual() {
  return (
    <div className="mt-7 min-h-[230px] overflow-hidden rounded-xl border border-line-strong bg-paper shadow-sm">
      <div className="grid min-h-[184px] grid-cols-[1.02fr_0.98fr]">
        <div className="space-y-5 border-r border-line p-4 sm:p-5">
          <SmallMessage initials="RC" color="#2f8f87" width="w-20 sm:w-28" />
          <SmallMessage initials="DM" color="#c75d35" width="w-16 sm:w-24" />
          <SmallMessage initials="MH" color="#365fa6" width="w-20 sm:w-28" />
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-[10px] font-semibold text-ink">Incident investigation</div>
          <div className="mt-4 space-y-3">
            {[
              ["Compare deploys", true],
              ["Trace regression", true],
              ["Draft patch", true],
              ["Run tests", false],
            ].map(([task, done]) => (
              <div key={task as string} className="flex items-center gap-2">
                <span className={`inline-flex size-3.5 items-center justify-center rounded-full border ${done ? "border-free bg-free-soft text-free" : "border-line-strong"}`}>{done ? <Check className="size-2.5" /> : null}</span>
                <span className="h-1.5 flex-1 rounded-full bg-line-strong" />
                <span className={`size-1.5 rounded-full ${done ? "bg-free" : "bg-accent"}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[8px] text-body sm:px-5">
        <PrismAvatar className="size-6 rounded-md" />
        <strong className="text-ink">Prism</strong>
        <span className="rounded bg-accent-soft px-1 font-mono text-[6px] text-accent uppercase">agent</span>
        <span>Posted findings and a patch</span>
        <span className="ml-auto inline-flex size-5 items-center justify-center rounded-full bg-free-soft text-free"><Check className="size-3" /></span>
      </div>
    </div>
  );
}

const benefits = [
  {
    title: "Agents are members",
    body: "Agents join your channels, read the thread, and participate.",
  },
  {
    title: "Context stays shared",
    body: "Agents see the full conversation. No copy-paste needed.",
  },
  {
    title: "Work stays visible",
    body: "Progress and results live right beside the conversation.",
  },
  {
    title: "Yours by default",
    body: "You control your data. Open source, always.",
  },
] as const;

function BenefitVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="space-y-2.5 rounded-xl border border-line bg-mist p-3">
        {[
          ["RC", "#2f8f87"],
          ["DM", "#c75d35"],
          ["MH", "#365fa6"],
        ].map(([initials, color]) => (
          <div key={initials} className="flex items-center gap-2">
            <span className="inline-flex size-5 items-center justify-center rounded-full text-[7px] font-semibold text-white" style={{ backgroundColor: color as string }}>{initials}</span>
            <span className="h-1.5 w-20 rounded-full bg-line-strong" />
            <span className="ml-auto size-1.5 rounded-full bg-free" />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <PrismAvatar className="size-5 rounded-[6px]" />
          <span className="h-1.5 w-12 rounded-full bg-line-strong" />
          <span className="rounded bg-accent-soft px-1 font-mono text-[6px] text-accent uppercase">agent</span>
          <span className="ml-auto size-1.5 rounded-full bg-free" />
        </div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="rounded-xl border border-line bg-mist p-3">
        <div className="flex gap-2">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#2f8f87] text-[7px] font-semibold text-white">RC</span>
          <div className="flex-1 space-y-1.5 pt-1"><div className="h-1.5 w-4/5 rounded-full bg-line-strong" /><div className="h-1.5 w-3/5 rounded-full bg-line" /></div>
        </div>
        <div className="my-3 h-px bg-line" />
        <div className="flex gap-2">
          <span className="inline-flex size-5 items-center justify-center rounded-md bg-accent text-[9px] text-white">✦</span>
          <div className="flex-1 space-y-1.5 pt-1"><div className="h-1.5 w-full rounded-full bg-line-strong" /><div className="h-1.5 w-2/3 rounded-full bg-line" /></div>
        </div>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="rounded-xl border border-line bg-mist p-3">
        <div className="text-[9px] font-semibold text-ink">PR #412 review</div>
        <div className="mt-2.5 space-y-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <span className={`inline-flex size-3 items-center justify-center rounded-full border ${item === 0 ? "border-free bg-free-soft text-free" : "border-line-strong bg-paper"}`}>{item === 0 ? <Check className="size-2" /> : null}</span>
              <span className={`h-1.5 rounded-full bg-line-strong ${item === 1 ? "w-14" : "w-20"}`} />
              <span className="ml-auto size-1.5 rounded-full bg-free" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[116px] items-center justify-center gap-5 text-accent">
      <Code className="size-14" />
      <span className="inline-flex size-12 items-center justify-center rounded-full border border-line-strong bg-paper text-ink shadow-sm"><Lock className="size-6" /></span>
    </div>
  );
}

export function BeforeAfter() {
  return (
    <section id="why-freeflow" className="relative overflow-hidden bg-paper py-16 sm:py-20">
      <div aria-hidden="true" className="square-grid absolute inset-0 text-line/35" />
      <Container className="relative">
        <Reveal>
          <h2 className="mx-auto max-w-3xl text-center text-[clamp(1.8rem,3vw,2.55rem)] leading-tight font-semibold tracking-[-0.04em] text-ink">
            Stop moving the work out of the conversation.
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <Reveal>
            <article className="h-full rounded-panel border border-line-strong bg-paper p-6">
              <p className="font-mono text-[10px] tracking-[0.12em] text-muted uppercase">The old way</p>
              <h3 className="mt-3 max-w-xs text-[1.25rem] leading-[1.1] font-semibold text-ink">Humans talk here.<br />Agents work over there.</h3>
              <OldWayVisual />
            </article>
          </Reveal>
          <Reveal delay={80}>
            <article className="h-full rounded-panel border border-accent bg-paper p-6 shadow-[0_18px_50px_-40px_rgba(109,53,198,0.8)]">
              <p className="font-mono text-[10px] tracking-[0.12em] text-muted uppercase">With Freeflow</p>
              <h3 className="mt-3 max-w-xs text-[1.25rem] leading-[1.1] font-semibold text-ink">The agent works<br />in the channel.</h3>
              <NewWayVisual />
            </article>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

export function HowItWorksStory() {
  return (
    <section id="how-it-works" className="bg-paper py-14 sm:py-18">
      <Container>
        <Reveal>
          <h2 className="text-center text-[clamp(1.8rem,3vw,2.55rem)] leading-tight font-semibold tracking-[-0.04em] text-ink">Mention it. Watch it work. Keep steering.</h2>
        </Reveal>
        <Reveal delay={80} className="mt-9"><CollaborationDemo /></Reveal>
      </Container>
    </section>
  );
}

export function Benefits() {
  return (
    <section id="benefits" className="bg-paper py-16 sm:py-20">
      <Container>
        <Reveal>
          <h2 className="text-center text-[clamp(1.8rem,3vw,2.55rem)] leading-tight font-semibold tracking-[-0.04em] text-ink">Built for shared work, not solo prompts.</h2>
        </Reveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((benefit, index) => (
            <Reveal key={benefit.title} delay={index * 50}>
              <article className="flex h-full min-h-[285px] flex-col rounded-panel border border-line-strong bg-paper p-5">
                <h3 className="text-[16px] font-semibold text-ink">{benefit.title}</h3>
                <p className="mt-2 text-[14px] leading-[1.5] text-body">{benefit.body}</p>
                <div className="mt-auto pt-6"><BenefitVisual index={index} /></div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function OpenSourceBand() {
  const items = [
    { label: "Bring your coding agent", Icon: Sparkle },
    { label: "Hosted or self-hosted", Icon: Server },
    { label: "Free and open source", Icon: Code },
  ];

  return (
    <section id="open-source" className="relative overflow-hidden border-t border-accent-line bg-accent-soft pt-10 pb-7 sm:pt-12">
      <div aria-hidden="true" className="square-grid absolute inset-0 text-accent/10" />
      <Container className="relative">
        <Reveal>
          <h2 className="text-center text-[clamp(1.8rem,3vw,2.55rem)] leading-tight font-semibold tracking-[-0.04em] text-ink">Open to any agent. Your work stays yours.</h2>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {items.map(({ label, Icon }) => (
              <div key={label} className="flex items-center justify-center gap-3 rounded-xl border border-line-strong bg-paper px-4 py-3 text-[14px] font-medium text-ink shadow-sm">
                <Icon className="size-4 text-ink" /> {label}
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
