import { Hash, Paperclip, Sparkle } from "@/components/icons";

/* -------------------------------------------------------------------------- */
/*  A hand-built replica of the Freeflow client. Real DOM, not a screenshot:   */
/*  stays sharp at any density and reflows on small screens.                   */
/* -------------------------------------------------------------------------- */

function Avatar({
  initials,
  color,
  size = "md",
}: {
  initials: string;
  color: string;
  size?: "md" | "sm";
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[7px] font-semibold text-white ${
        size === "md" ? "size-8 text-[11.5px]" : "size-5 text-[9px]"
      }`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

function Reaction({
  emoji,
  count,
  mine = false,
}: {
  emoji: string;
  count: number;
  mine?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[11.5px] leading-none ${
        mine
          ? "border-accent-line bg-accent-soft text-accent"
          : "border-line bg-mist text-body"
      }`}
    >
      <span className="text-[12px]">{emoji}</span>
      <span className="font-medium tabular-nums">{count}</span>
    </span>
  );
}

function ChannelRow({
  name,
  active = false,
  unread,
  muted = false,
}: {
  name: string;
  active?: boolean;
  unread?: number;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[7px] px-2 py-[5px] text-[13px] ${
        active
          ? "bg-white/15 font-medium text-white"
          : muted
            ? "text-white/35"
            : "text-white/65"
      }`}
    >
      <Hash className="size-[13px] shrink-0 opacity-70" />
      <span className="truncate">{name}</span>
      {unread ? (
        <span className="ml-auto rounded-full bg-white px-1.5 py-px text-[10px] font-semibold text-[#3d1a4a] tabular-nums">
          {unread}
        </span>
      ) : null}
    </div>
  );
}

function DmRow({
  name,
  color,
  initials,
  status = "online",
}: {
  name: string;
  color: string;
  initials: string;
  status?: "online" | "away" | "bot";
}) {
  return (
    <div className="flex items-center gap-2 rounded-[7px] px-2 py-[5px] text-[13px] text-white/65">
      <span className="relative">
        <Avatar initials={initials} color={color} size="sm" />
        <span
          className={`absolute -right-0.5 -bottom-0.5 size-[7px] rounded-full ring-2 ring-[#3d1a4a] ${
            status === "online"
              ? "bg-[#3fbf7f]"
              : status === "bot"
                ? "bg-[#7c6cf5]"
                : "bg-white/30"
          }`}
        />
      </span>
      <span className="truncate">{name}</span>
      {status === "bot" ? (
        <span className="ml-auto rounded bg-white/15 px-1 py-px font-mono text-[9px] tracking-wide text-white/60 uppercase">
          app
        </span>
      ) : null}
    </div>
  );
}

function SidebarLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-4 pb-1 font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">
      {children}
    </div>
  );
}

export function AppMock() {
  return (
    <div className="overflow-hidden rounded-surface border border-line-strong bg-paper shadow-[0_28px_70px_-24px_rgba(11,12,16,0.32),0_8px_24px_-12px_rgba(11,12,16,0.14)]">
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-line bg-mist px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <div className="mx-auto flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1 font-mono text-[11px] text-muted">
          <span className="text-free">●</span>
          127.0.0.1:8787 · your server
        </div>
      </div>

      <div className="flex h-[430px] sm:h-[470px]">
        {/* workspace sidebar */}
        <aside className="hidden w-[188px] shrink-0 flex-col bg-[#3d1a4a] px-2 pt-3 pb-2 md:flex">
          <div className="flex items-center gap-2 px-2 pb-2">
            <span className="inline-flex size-6 items-center justify-center rounded-[6px] bg-white/15 text-[11px] font-bold text-white">
              A
            </span>
            <span className="truncate text-[13.5px] font-semibold text-white">
              Acme Eng
            </span>
          </div>

          <div className="thin-scroll flex-1 overflow-y-auto">
            <SidebarLabel>Channels</SidebarLabel>
            <ChannelRow name="general" />
            <ChannelRow name="engineering" active />
            <ChannelRow name="deploys" unread={3} />
            <ChannelRow name="incidents" />
            <ChannelRow name="design" muted />

            <SidebarLabel>Direct messages</SidebarLabel>
            <DmRow name="Priya Raman" initials="PR" color="#c2410c" />
            <DmRow name="Sam Okonkwo" initials="SO" color="#0e7490" status="away" />
            <DmRow name="review-bot" initials="RB" color="#4f46e5" status="bot" />
            <DmRow name="you (notes)" initials="YO" color="#3f6212" />
          </div>

          <div className="mt-2 flex items-center gap-2 rounded-[7px] bg-white/10 px-2 py-1.5">
            <Avatar initials="YO" color="#3f6212" size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-medium text-white">
                You
              </div>
              <div className="truncate text-[10px] text-white/45">
                🎧 heads-down
              </div>
            </div>
          </div>
        </aside>

        {/* message pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Hash className="size-4 text-muted" />
            <span className="text-[14.5px] font-semibold text-ink">engineering</span>
            <span className="hidden truncate text-[12.5px] text-muted sm:inline">
              ship logs, review threads, and one very opinionated agent
            </span>
            <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[11.5px] text-body sm:flex">
              <span className="size-1.5 rounded-full bg-[#3fbf7f]" />
              12 online
            </span>
          </div>

          <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {/* message 1 */}
            <div className="flex gap-2.5">
              <Avatar initials="PR" color="#c2410c" />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">
                    Priya Raman
                  </span>
                  <span className="text-[11px] text-muted">10:42</span>
                </div>
                <p className="text-[13.5px] leading-relaxed text-body">
                  Gateway p99 jumped after the fan-out change.{" "}
                  <span className="rounded bg-accent-soft px-1 font-medium text-accent">
                    @review-bot
                  </span>{" "}
                  can you diff the last two deploys and tell me what moved?
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <Reaction emoji="👀" count={4} />
                  <Reaction emoji="🔥" count={2} mine />
                </div>
              </div>
            </div>

            {/* agent message */}
            <div className="flex gap-2.5">
              <Avatar initials="RB" color="#4f46e5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">
                    review-bot
                  </span>
                  <span className="rounded bg-accent-soft px-1 py-px font-mono text-[9.5px] tracking-wide text-accent uppercase">
                    app
                  </span>
                  <span className="text-[11px] text-muted">10:42</span>
                </div>
                <p className="text-[13.5px] leading-relaxed text-body">
                  Found it. <span className="font-medium text-ink">a1f9c02</span>{" "}
                  moved the NATS publish inside the write transaction. Patch below,
                  branch is pushed.
                </p>
                <div className="mt-2 overflow-hidden rounded-[10px] border border-line bg-graphite">
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
                    <span className="font-mono text-[10.5px] text-white/45">
                      packages/server/src/gateway/fanout.ts
                    </span>
                    <span className="font-mono text-[10.5px] text-white/30">
                      diff
                    </span>
                  </div>
                  <pre className="thin-scroll overflow-x-auto px-3 py-2.5 font-mono text-[11px] leading-[1.7]">
                    <code>
                      <span className="text-[#f87171]">
                        {"- await tx.publish(subject, payload)"}
                      </span>
                      {"\n"}
                      <span className="text-[#4ade80]">{"+ tx.onCommit(() =>"}</span>
                      {"\n"}
                      <span className="text-[#4ade80]">
                        {"+   nats.publish(subject, payload))"}
                      </span>
                    </code>
                  </pre>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Reaction emoji="🚀" count={7} mine />
                  <Reaction emoji="🧠" count={3} />
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-[3px] text-[11.5px] text-accent">
                    <Sparkle className="size-3" />6 replies
                  </span>
                </div>
              </div>
            </div>

            {/* message 3 */}
            <div className="flex gap-2.5">
              <Avatar initials="SO" color="#0e7490" />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">
                    Sam Okonkwo
                  </span>
                  <span className="text-[11px] text-muted">10:44</span>
                </div>
                <p className="text-[13.5px] leading-relaxed text-body">
                  Shipping it. Also dropped the Q3 latency report here 👇
                </p>
                <div className="mt-2 inline-flex items-center gap-2.5 rounded-[10px] border border-line bg-mist px-3 py-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-[7px] bg-[#dc2626]/10 text-[#dc2626]">
                    <Paperclip className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      latency-q3.pdf
                    </span>
                    <span className="block font-mono text-[10.5px] text-muted">
                      1.4 MB · encrypted at rest
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* typing */}
            <div className="flex items-center gap-2 pl-1 text-[12px] text-muted">
              <span className="flex gap-[3px]">
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
              Priya is typing…
            </div>
          </div>

          {/* composer */}
          <div className="border-t border-line px-4 py-3">
            <div className="flex items-center gap-2 rounded-[10px] border border-line-strong px-3 py-2">
              <span className="text-[13.5px] text-muted">
                Message #engineering
              </span>
              <span className="caret inline-block h-4 w-px bg-ink/50" />
              <span className="ml-auto flex items-center gap-2 text-muted">
                <Paperclip className="size-4" />
                <span className="font-mono text-[11px]">⌘↵</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
