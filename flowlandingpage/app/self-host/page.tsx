import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { links, routes } from "@/site.config";
import { stackFacts, treeLines } from "@/lib/content";
import { PageHero } from "@/components/page-hero";
import { Reveal } from "@/components/reveal";
import { FinalCta } from "@/components/sections/final-cta";
import {
  Button,
  Card,
  Code,
  CodePanel,
  Container,
  IconChip,
  Section,
  SectionHeading,
  TerminalPanel,
  TextLink,
} from "@/components/ui";
import { Apple, ArrowRight, Github, Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Self-host Freeflow",
  description:
    "Node 22, pnpm 10, Docker, and one box. Run the API, the WebSocket gateway, and the web client from a single process on infrastructure you control.",
};

const prerequisites = [
  { label: "Node", value: "22 or newer" },
  { label: "pnpm", value: "10" },
  { label: "Docker", value: "for Postgres 16 and NATS" },
  { label: "Xcode", value: "26, only for the macOS client" },
  { label: "macOS", value: "14+, only for the macOS client" },
  { label: "Ports", value: "8787 app · 5442 Postgres" },
];

const operational = [
  {
    icon: "lock" as const,
    title: "Key management",
    body: "Message encryption and AES-256-GCM file encryption both take keys from your environment. Rotate them the way you rotate everything else. The deployment doc covers the procedure and what it costs you.",
  },
  {
    icon: "server" as const,
    title: "Backups that actually restore",
    body: "Postgres holds the messages; the blob directory holds the encrypted files. Back up both together, and test the restore, because a backup you have never restored is a rumour.",
  },
  {
    icon: "globe" as const,
    title: "Putting it behind a domain",
    body: "Terminate TLS at your reverse proxy, forward the WebSocket upgrade to /v1/ws, and point the macOS client at the same host. There is nothing exotic in the path.",
  },
  {
    icon: "box" as const,
    title: "Object storage when you outgrow disk",
    body: "File blobs sit behind a storage interface designed from the start to swap in R2 or S3 with presigned transfer. The design doc describes the migration before you need it.",
  },
];

export default function SelfHostPage() {
  // Hidden for now. Flip `routes.selfHost` in site.config.ts to publish it.
  if (!routes.selfHost) notFound();

  return (
    <>
      <PageHero
        title={
          <>
            One box. One process.{" "}
            <em className="serif-accent text-accent">Yours</em>.
          </>
        }
        body="The Freeflow server hosts the REST API, the WebSocket gateway, the Slack-compatible API, and the built web client. That means a working deployment is a single service in front of a Postgres and a NATS. It is small enough to reason about and small enough to move somewhere else when you feel like it."
        actions={
          <>
            <Button
              href={links.deployment}
              size="lg"
              external
              icon={<Github className="size-[18px]" />}
            >
              Deployment guide
            </Button>
            <Button href={links.github} variant="secondary" size="lg" external>
              Clone the repo
            </Button>
          </>
        }
      />

      <Section tone="paper">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-14">
            <div>
              <SectionHeading
                align="left"
                lead="Run it on your laptop"
                title={
                  <>
                    before you trust it with a{" "}
                    <em className="serif-accent text-accent">team</em>.
                  </>
                }
                body="Three commands gets you a complete Freeflow at 127.0.0.1:8787, with the API, real-time gateway, and web client included."
              />

              <div className="mt-9">
                <TerminalPanel
                  caption="freeflow · bash"
                  commands={[
                    {
                      note: "1. Infrastructure: Postgres on host port 5442, plus NATS",
                      cmd: "cd packages/infra && docker compose up -d",
                    },
                    {
                      note: "2. Install and build every workspace package",
                      cmd: "pnpm install && pnpm build",
                    },
                    {
                      note: "3. Migrate the schema, then start the server",
                      cmd: "cd packages/server && pnpm migrate && pnpm dev",
                    },
                  ]}
                />
              </div>

              <p className="mt-4 text-[14.5px] leading-relaxed text-body">
                Open <Code>http://127.0.0.1:8787</Code>. After rebuilding{" "}
                <Code>packages/web/dist</Code>, restart the server so it picks up
                the new bundle. Run the suite with <Code>pnpm test</Code>.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <Reveal delay={80}>
                <div className="rounded-panel border border-line bg-paper p-6">
                  <h3 className="text-[1rem] font-semibold">Prerequisites</h3>
                  <dl className="mt-4 flex flex-col divide-y divide-line">
                    {prerequisites.map((p) => (
                      <div
                        key={p.label}
                        className="flex items-baseline justify-between gap-4 py-2.5"
                      >
                        <dt className="text-[14px] text-body">{p.label}</dt>
                        <dd className="font-mono text-[13px] text-ink">
                          {p.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Reveal>

              <Reveal delay={140}>
                <div className="rounded-panel border border-line bg-paper p-6">
                  <div className="flex items-center gap-2.5">
                    <Apple className="size-[18px] text-ink" />
                    <h3 className="text-[1rem] font-semibold">
                      The macOS client
                    </h3>
                  </div>
                  <div className="mt-4 rounded-[10px] border border-line bg-mist px-4 py-3 font-mono text-[12.5px] leading-[1.9] text-ink">
                    <div>
                      <span className="text-free select-none">$ </span>cd
                      apps/macos
                    </div>
                    <div>
                      <span className="text-free select-none">$ </span>swift run
                      Freeflow
                    </div>
                    <div>
                      <span className="text-free select-none">$ </span>
                      tools/make-app.sh
                    </div>
                  </div>
                  <p className="mt-3.5 text-[14px] leading-relaxed text-body">
                    <Code>make-app.sh</Code> packages <Code>dist/Freeflow.app</Code>{" "}
                    and registers <Code>freeflow://</Code> so invite links open the
                    desktop app instead of a browser tab.
                  </p>
                  <div className="mt-4">
                    <TextLink href={links.macosReadme} external>
                      Cache, Keychain, and invites
                    </TextLink>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="mist">
        <Container>
          <SectionHeading
            lead="A monorepo you can hold"
            title={
              <>
                in your{" "}
                <em className="serif-accent text-accent">head</em>.
              </>
            }
            body="Four workspace packages and one SwiftPM app. Nothing generated, nothing hidden behind a build step you cannot inspect."
          />

          <div className="mt-12 grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-start">
            <Reveal>
              <CodePanel title="flow/" lines={treeLines} />
            </Reveal>
            <Reveal delay={100}>
              <dl className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
                {stackFacts.map((s) => (
                  <div
                    key={s.label}
                    className="flex flex-col gap-1 bg-paper px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
                  >
                    <dt className="shrink-0 font-mono text-[11px] tracking-[0.1em] text-muted uppercase sm:w-24">
                      {s.label}
                    </dt>
                    <dd className="text-[14px] text-ink">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section tone="paper">
        <Container>
          <SectionHeading
            lead="The unglamorous half"
            title={
              <>
                is the half that{" "}
                <em className="serif-accent text-accent">matters</em>.
              </>
            }
            body="Owning your chat means owning your backups, your keys, and your 3am pager. Freeflow documents all three rather than pretending they evaporate."
          />

          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {operational.map((o, i) => (
              <Reveal key={o.title} delay={(i % 2) * 80}>
                <Card className="h-full">
                  <IconChip>
                    <Icon name={o.icon} className="size-[19px]" />
                  </IconChip>
                  <h3 className="mt-4 text-[1.0625rem] font-semibold">
                    {o.title}
                  </h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-body">
                    {o.body}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
            <TextLink href={links.deployment} external>
              Deployment and runbooks
            </TextLink>
            <TextLink href={links.storage} external>
              Storage and blob transfer
            </TextLink>
            <TextLink href={links.issues} external>
              Report a problem
            </TextLink>
          </div>

          <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row">
            <Button
              href={links.migrate}
              size="lg"
              icon={<ArrowRight className="size-[18px]" />}
            >
              Now bring your history across
            </Button>
            <Button href={links.agents} variant="secondary" size="lg">
              And your agents
            </Button>
          </div>
        </Container>
      </Section>

      <FinalCta />
    </>
  );
}
