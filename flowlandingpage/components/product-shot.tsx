import { Check, Hash, Logo, Menu, Users } from "@/components/icons";
import { PrismAvatar } from "@/components/prism-avatar";

const teammates = [
  ["Rina Cole", "#2f8f87"],
  ["Dev Malik", "#c75d35"],
  ["Milo Hart", "#365fa6"],
] as const;

function MiniAvatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ring-2 ring-paper"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
      <span className="absolute right-0 bottom-0 size-2 rounded-full border-2 border-paper bg-free" />
    </span>
  );
}

function PersonMessage({
  initials,
  color,
  name,
  time,
  reaction,
  children,
}: {
  initials: string;
  color: string;
  name: string;
  time: string;
  reaction?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <MiniAvatar initials={initials} color={color} />
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold text-ink sm:text-[12px]">{name}</span>
          <span className="text-[8px] text-muted sm:text-[9px]">{time}</span>
        </div>
        <p className="mt-0.5 text-[10px] leading-[1.45] text-body sm:text-[11px]">{children}</p>
        {reaction ? <span className="mt-1.5 inline-flex rounded-full border border-line bg-mist px-2 py-0.5 text-[8px] text-body">{reaction}</span> : null}
      </div>
    </div>
  );
}

function InvestigationResult() {
  return (
    <div className="demo-pop mt-4 max-w-[570px] overflow-hidden rounded-xl border border-line-strong bg-paper shadow-[0_12px_30px_-24px_rgba(11,12,16,0.45)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[14px] font-semibold text-ink sm:text-[16px]">Root cause found</span>
        <span className="rounded-full bg-free-soft px-2 py-1 font-mono text-[8px] font-medium text-free">● Patch ready</span>
      </div>
      <div className="grid sm:grid-cols-[1.15fr_0.85fr]">
        <div className="p-4">
          <div className="font-mono text-[8px] tracking-wide text-muted uppercase">Commit a1f9c02</div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink">NATS publish moved inside the write transaction.</p>
          <div className="mt-3 rounded-lg bg-[#17111f] p-3 font-mono text-[7px] leading-[1.7] sm:text-[8px]">
            <div className="text-[#f3a6a6]">- await tx.publish(subject, payload)</div>
            <div className="text-[#92e4b6]">+ tx.onCommit(() =&gt;</div>
            <div className="pl-3 text-[#92e4b6]">nats.publish(subject, payload))</div>
          </div>
        </div>
        <div className="border-t border-line bg-[#fbfafc] p-4 sm:border-t-0 sm:border-l">
          <div className="font-mono text-[8px] tracking-wide text-muted uppercase">Impact</div>
          <div className="mt-1 text-[10px] font-medium text-ink">p99 latency +184ms</div>
          <div className="mt-4 font-mono text-[8px] tracking-wide text-muted uppercase">Next step</div>
          <div className="mt-2 flex items-center gap-2 text-[9px] text-body"><span className="inline-flex size-4 items-center justify-center rounded-full bg-free-soft text-free"><Check className="size-2.5" /></span> Review and merge</div>
          <div className="mt-4 text-[8px] text-muted">Compared</div>
          <div className="text-[9px] text-body">2 deploys · 14 files</div>
        </div>
      </div>
    </div>
  );
}

export function ProductShot() {
  return (
    <div className="overflow-hidden rounded-[1.1rem] border border-white/15 bg-paper shadow-[0_30px_90px_-30px_rgba(0,0,0,0.75)]">
      <div className="grid min-h-[570px] md:grid-cols-[230px_minmax(0,1fr)] lg:min-h-[650px] lg:grid-cols-[265px_minmax(0,1fr)]">
        <aside className="relative hidden overflow-hidden bg-[linear-gradient(180deg,#7136ca_0%,#5a27aa_58%,#4a1e91_100%)] p-4 text-white md:flex md:flex-col lg:p-5">
          <div aria-hidden="true" className="absolute -top-16 -left-16 size-72 rounded-full bg-[#994df0]/35 blur-3xl" />
          <div className="relative flex items-center gap-2.5">
            <Logo className="size-8" />
            <span className="text-[13px] font-semibold">Flow Home Team</span>
            <span className="ml-auto text-white/55">⌄</span>
          </div>
          <div className="relative mt-5 flex items-center gap-2 text-[11px] text-white/65">
            <span className="inline-flex size-8 items-center justify-center rounded-lg border border-dashed border-white/30">＋</span>
            <span>Activity</span>
          </div>
          <p className="relative mt-6 font-mono text-[8px] tracking-[0.16em] text-white/45 uppercase">Channels</p>
          <div className="relative mt-2 space-y-0.5">
            {["general", "engineering", "product", "deploys", "random"].map((channel) => (
              <div
                key={channel}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] lg:text-[11px] ${channel === "engineering" ? "bg-white/16 font-medium text-white" : "text-white/64"}`}
              >
                <Hash className="size-3" /> {channel}
              </div>
            ))}
          </div>
          <p className="relative mt-6 font-mono text-[8px] tracking-[0.16em] text-white/45 uppercase">Direct messages</p>
          <div className="relative mt-2 space-y-2.5">
            {teammates.map(([name, color]) => (
              <div key={name} className="flex items-center gap-2 text-[10px] text-white/68 lg:text-[11px]">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                {name}
              </div>
            ))}
            <div className="flex items-center gap-2 text-[10px] text-white lg:text-[11px]">
              <PrismAvatar className="size-4 rounded-[5px]" />
              Prism
              <span className="rounded bg-white/12 px-1 font-mono text-[7px] uppercase">agent</span>
            </div>
          </div>
          <div className="relative mt-auto rounded-lg border border-white/12 bg-white/10 px-3 py-2.5 text-center text-[10px] text-white/85">
            ✦ &nbsp; Invite your Agent
          </div>
          <div className="relative mt-4 flex items-center gap-2.5 border-t border-white/10 pt-4">
            <MiniAvatar initials="RC" color="#2f8f87" />
            <div>
              <div className="text-[10px] font-medium">Rina Cole</div>
              <div className="text-[8px] text-white/55">Online <span className="text-[#63df9d]">●</span></div>
            </div>
            <span className="ml-auto text-white/50">⌄</span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col bg-paper">
          <div className="flex h-16 items-center gap-3 border-b border-line px-4 sm:px-5">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink sm:text-[15px]"><Hash className="size-4 text-muted" /> engineering</div>
              <p className="ml-5 text-[9px] text-muted sm:text-[10px]">Investigating the latency regression.</p>
            </div>
            <div className="ml-auto hidden -space-x-2 sm:flex">
              <MiniAvatar initials="RC" color="#2f8f87" />
              <MiniAvatar initials="DM" color="#c75d35" />
              <MiniAvatar initials="MH" color="#365fa6" />
              <MiniAvatar initials="TS" color="#7153a8" />
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-mist text-[8px] font-medium text-body ring-2 ring-paper">+3</span>
            </div>
            <button type="button" className="hidden h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-[10px] font-medium text-ink sm:flex">
              <Users className="size-3.5" /> Join
            </button>
            <Menu className="size-4 text-muted" />
          </div>

          <div className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="max-w-[760px] space-y-5">
              <PersonMessage initials="RC" color="#2f8f87" name="Rina Cole" time="9:12 AM" reaction="👀 3">
                Gateway p99 jumped after the fan-out change.<br />Did anything move in the last deploy?
              </PersonMessage>
              <PersonMessage initials="DM" color="#c75d35" name="Dev Malik" time="9:13 AM" reaction="👍 2">
                I can reproduce it on staging. The spike started with yesterday&apos;s release.
              </PersonMessage>
              <PersonMessage initials="MH" color="#365fa6" name="Milo Hart" time="9:14 AM">
                <span className="font-medium text-accent">@Prism</span> can you compare the last two deploys and tell us what changed?
              </PersonMessage>

              <div className="flex gap-3">
                <PrismAvatar />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-ink sm:text-[12px]">Prism</span>
                    <span className="rounded bg-accent-soft px-1 font-mono text-[7px] text-accent uppercase">agent</span>
                    <span className="text-[8px] text-muted sm:text-[9px]">9:14 AM</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-body sm:text-[11px]">
                    Comparing 2 deploys and 14 changed files…
                    <span className="flex gap-1.5" aria-label="Agent working">
                      {[0, 1, 2, 3, 4, 5].map((dot) => (
                        <span key={dot} className="typing-dot size-1.5 rounded-full bg-accent" style={{ animationDelay: `${dot * 100}ms` }} />
                      ))}
                    </span>
                  </div>
                  <InvestigationResult />
                  <span className="mt-2 inline-flex rounded-full border border-line bg-mist px-2 py-0.5 text-[8px] text-body">✅ 3</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-line p-3 sm:p-4">
            <div className="flex h-11 items-center rounded-lg border border-line bg-paper px-3 text-[10px] text-muted sm:text-[11px]">
              ＋ &nbsp; Message #engineering
              <span className="ml-auto mr-3 hidden sm:inline">☺</span>
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-white">↑</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
