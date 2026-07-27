import { links } from "@/site.config";
import { Reveal } from "@/components/reveal";
import {
  Button,
  Card,
  Container,
  IconChip,
  Section,
  SectionHeading,
} from "@/components/ui";
import {
  ArrowRight,
  Branch,
  Bug,
  Check,
  Code,
  Github,
  Hash,
  Play,
  PullRequest,
  Rotate,
  Shield,
  Terminal,
} from "@/components/icons";

/* -------------------------------------------------------------------------- */
/*  Capabilities                                                               */
/* -------------------------------------------------------------------------- */

const capabilities = [
  {
    icon: PullRequest,
    title: "Review pull requests",
    body: "Reads the diff, posts findings in the thread — file, line, and a patch.",
  },
  {
    icon: Shield,
    title: "Hold the merge button",
    body: "Blocks the PR with no tests, or the one opened before the weekend.",
  },
  {
    icon: Play,
    title: "Run CI on demand",
    body: "Triggers the job and streams output back inline. No dashboard.",
  },
  {
    icon: Rotate,
    title: "Ship it, then unship it",
    body: "Deploy from the channel. Roll back with one message.",
  },
  {
    icon: Bug,
    title: "Triage what broke",
    body: "Bisects to the commit, opens the issue, assigns whoever touched it last.",
  },
  {
    icon: Code,
    title: "Answer from the codebase",
    body: "Ask where a flag is set. Get a file path and a line number.",
  },
];

const controls = [
  {
    title: "Scoped when you create it, revoked in a click",
    body: "Take away a repo or a command and the agent stops. Nothing to unwind.",
  },
  {
    title: "Scoped to the channels you invite it to",
    body: "Keep the one with merge rights in a private channel.",
  },
  {
    title: "The audit trail is the transcript",
    body: "Who asked, what it did, what it returned — in order, in public.",
  },
  {
    title: "Your runner, your credentials",
    body: "Deploy keys never leave your network to make chat useful.",
  },
];

const slashCommands = [
  "/review 412",
  "/ci run e2e",
  "/deploy staging",
  "/rollback prod",
  "/bisect p99",
  "/whoowns fanout.ts",
];

/* -------------------------------------------------------------------------- */
/*  The thread mock — a PR going from opened to merged without leaving chat    */
/* -------------------------------------------------------------------------- */

function Avatar({
  initials,
  color,
}: {
  initials: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-[7px] text-[11.5px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

function Author({
  name,
  time,
  app = false,
}: {
  name: string;
  time: string;
  app?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[13.5px] font-semibold text-ink">{name}</span>
      {app ? (
        <span className="rounded bg-accent-soft px-1 py-px font-mono text-[9.5px] tracking-wide text-accent uppercase">
          app
        </span>
      ) : null}
      <span className="text-[11px] text-muted">{time}</span>
    </div>
  );
}

function Finding({
  severity,
  file,
  text,
}: {
  severity: "block" | "warn" | "note";
  file: string;
  text: string;
}) {
  const tone = {
    block: "bg-[#dc2626]",
    warn: "bg-warn",
    note: "bg-muted",
  } as const;

  return (
    <li className="flex items-start gap-2.5 py-2">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone[severity]}`} />
      <span className="min-w-0">
        <span className="block font-mono text-[11.5px] text-muted">{file}</span>
        <span className="block text-[13px] leading-snug text-body">{text}</span>
      </span>
    </li>
  );
}

function CheckPill({ label, state }: { label: string; state: "pass" | "run" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] ${
        state === "pass"
          ? "border-free/20 bg-free-soft text-free"
          : "border-line bg-mist text-muted"
      }`}
    >
      {state === "pass" ? (
        <Check className="size-[13px]" />
      ) : (
        <span className="typing-dot size-1.5 rounded-full bg-muted" />
      )}
      {label}
    </span>
  );
}

function PrThread() {
  return (
    <div className="overflow-hidden rounded-surface border border-line-strong bg-paper shadow-[0_24px_60px_-28px_rgba(11,12,16,0.28)]">
      <div className="flex items-center gap-2 border-b border-line bg-mist px-5 py-3">
        <Hash className="size-4 text-muted" />
        <span className="text-[13.5px] font-semibold text-ink">engineering</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="size-1.5 rounded-full bg-[#3fbf7f]" />
          thread · 6 replies
        </span>
      </div>

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {/* the PR lands in the channel */}
        <div className="rounded-panel border border-line bg-mist p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-free-soft text-free">
              <PullRequest className="size-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[14px] font-semibold text-ink">
                  Encrypt file blobs before write
                </span>
                <span className="font-mono text-[12px] text-muted">#412</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <Branch className="size-[13px]" />
                  sam/blob-encryption → main
                </span>
                <span className="text-free">+248</span>
                <span className="text-[#dc2626]">−31</span>
              </div>
            </div>
            <span className="hidden shrink-0 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[11px] text-body sm:inline">
              opened
            </span>
          </div>
        </div>

        {/* the agent reviews it */}
        <div className="flex gap-3">
          <Avatar initials="RB" color="#4f46e5" />
          <div className="min-w-0 flex-1">
            <Author name="review-bot" time="14:06" app />
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-body">
              Read the diff. Encryption path looks right — three things before
              this merges.
            </p>
            <ul className="mt-2 divide-y divide-line rounded-panel border border-line px-4 py-1">
              <Finding
                severity="block"
                file="packages/server/src/storage/blob.ts:88"
                text="The IV is reused across writes for the same file id. Generate it per write or the GCM guarantee is gone."
              />
              <Finding
                severity="warn"
                file="packages/server/src/storage/blob.ts:140"
                text="Decrypt failures swallow the error and return an empty buffer. That will look like data loss to a caller."
              />
              <Finding
                severity="note"
                file="docs/design/STORAGE.md"
                text="Worth documenting the key rotation path before this ships, since it changes what a restore needs."
              />
            </ul>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-body">
              Pushed a fix for the first one to{" "}
              <span className="font-mono text-[12.5px] text-ink">
                sam/blob-encryption
              </span>
              . Holding the merge until CI is green.
            </p>
          </div>
        </div>

        {/* checks */}
        <div className="flex flex-wrap gap-2 pl-11">
          <CheckPill label="unit · 412 passed" state="pass" />
          <CheckPill label="typecheck" state="pass" />
          <CheckPill label="e2e · running" state="run" />
        </div>

        {/* a human answers in one line */}
        <div className="flex gap-3">
          <Avatar initials="PR" color="#c2410c" />
          <div className="min-w-0 flex-1">
            <Author name="Priya Raman" time="14:11" />
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-body">
              Nice catch on the IV. <code className="rounded border border-line bg-mist px-1.5 py-0.5 font-mono text-[12px] text-ink">/merge --squash when green</code>
            </p>
          </div>
        </div>

        {/* and it ships */}
        <div className="flex gap-3">
          <Avatar initials="RB" color="#4f46e5" />
          <div className="min-w-0 flex-1">
            <Author name="review-bot" time="14:19" app />
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-body">
              e2e green. Squashed and merged as{" "}
              <span className="font-mono text-[12.5px] text-ink">7c31de9</span>,
              deployed to staging, health check passing for 4 minutes.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-free/20 bg-free-soft px-2 py-[3px] text-[11.5px] text-free">
                <Check className="size-3" />
                merged
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-mist px-2 py-[3px] text-[11.5px] text-body">
                <Rotate className="size-3" />
                rollback ready
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-mist px-5 py-3">
        <span className="font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
          in this channel
        </span>
        {slashCommands.map((c) => (
          <code
            key={c}
            className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-[11.5px] text-body"
          >
            {c}
          </code>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function Workflows() {
  return (
    <Section id="workflows" tone="paper">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Your pipeline already posts in chat."
            title={
              <>
                Now it can take{" "}
                <em className="serif-accent text-accent">orders</em>.
              </>
            }
            body="A webhook tells you the build broke, then goes quiet. An agent with a seat in the channel reads the failure, proposes the fix, and merges it when you say so."
          />
        </Reveal>

        <Reveal delay={120} className="mt-14">
          <PrThread />
        </Reveal>

        <Reveal delay={180}>
          <p className="mx-auto mt-6 max-w-xl text-center text-[14px] text-muted">
            Every message above is an ordinary API call against your own server.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((c, i) => (
            <Reveal key={c.title} delay={(i % 3) * 80}>
              <Card className="h-full">
                <IconChip>
                  <c.icon className="size-[19px]" />
                </IconChip>
                <h3 className="mt-4 text-[1.0625rem] font-semibold">
                  {c.title}
                </h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-body">
                  {c.body}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>

        {/* control and audit */}
        <Reveal delay={240}>
          <div className="mt-8 overflow-hidden rounded-surface bg-ink p-8 sm:p-10">
            <div className="grid gap-9 lg:grid-cols-[1fr_1.5fr] lg:gap-14">
              <div>
                <h3 className="text-[1.5rem] leading-snug font-semibold text-white sm:text-[1.75rem]">
                  Handing an agent the merge button is only sane if you can take
                  it back.
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-white/60">
                  Here is exactly what an agent holds — and exactly how you take
                  it away.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Button
                    href={links.agents}
                    variant="invert"
                    icon={<ArrowRight className="size-[17px]" />}
                  >
                    How agents work
                  </Button>
                  <Button
                    href={links.agentsDesign}
                    variant="ghost"
                    external
                    className="text-white hover:bg-white/10"
                    icon={<Github className="size-[17px]" />}
                  >
                    Design notes
                  </Button>
                </div>
              </div>

              <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
                {controls.map((c) => (
                  <div key={c.title}>
                    <dt className="text-[14.5px] font-semibold text-white">
                      {c.title}
                    </dt>
                    <dd className="mt-1.5 text-[14px] leading-relaxed text-white/55">
                      {c.body}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              href={links.agentMembers}
              size="lg"
              external
              icon={<Terminal className="size-[18px]" />}
            >
              Build your first agent
            </Button>
            <Button href={links.agents} variant="secondary" size="lg">
              See what people build
            </Button>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
