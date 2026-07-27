import { links } from "@/site.config";
import { stackFacts, treeLines } from "@/lib/content";
import { Reveal } from "@/components/reveal";
import {
  CodePanel,
  Container,
  Section,
  SectionHeading,
  TextLink,
} from "@/components/ui";
import { Lock, Server, Shield } from "@/components/icons";

const guarantees = [
  {
    icon: Lock,
    title: "Encrypted at rest",
    body: "Messages encrypted in Postgres. File blobs AES-256-GCM on disk.",
  },
  {
    icon: Shield,
    title: "Tokens never ride in URLs",
    body: "Single-use handoff codes. macOS sessions live in the Keychain.",
  },
  {
    icon: Server,
    title: "Real-time without the magic",
    body: "A WebSocket at /v1/ws. NATS fans events out server-side.",
  },
];

export function Architecture() {
  return (
    <Section id="architecture" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="You are going to run this."
            title={
              <>
                So you should be able to{" "}
                <em className="serif-accent text-accent">read</em> it.
              </>
            }
            body="A pnpm monorepo and a SwiftPM package. Boring, current technology, chosen so whoever inherits this repo can find their way around without a tour."
          />
        </Reveal>

        <div className="mt-14 grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          <Reveal>
            <CodePanel title="flow/" lines={treeLines} />
          </Reveal>

          <Reveal delay={120}>
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

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {guarantees.map((g, i) => (
            <Reveal key={g.title} delay={i * 80}>
              <div className="flex h-full flex-col rounded-panel border border-line bg-paper p-6">
                <g.icon className="size-5 text-accent" />
                <h3 className="mt-3.5 text-[1rem] font-semibold">{g.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-body">
                  {g.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={260}>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
            <TextLink href={links.storage} external>
              Storage design
            </TextLink>
            <TextLink href={links.deployment} external>
              Deployment and runbooks
            </TextLink>
            <TextLink href={links.overview} external>
              Product scope and non-goals
            </TextLink>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
