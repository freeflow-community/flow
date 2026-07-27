import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { links, routes } from "@/site.config";
import { migrateTabs } from "@/lib/snippets";
import { CodeTabs } from "@/components/code-tabs";
import { PageHero } from "@/components/page-hero";
import { Reveal } from "@/components/reveal";
import { FinalCta } from "@/components/sections/final-cta";
import {
  Button,
  Card,
  Container,
  Section,
  SectionHeading,
  TerminalPanel,
  TextLink,
} from "@/components/ui";
import { ArrowRight, Check, Cross, Discord, Github, Slack } from "@/components/icons";

export const metadata: Metadata = {
  title: "Migrate from Slack or Discord",
  description:
    "Point an agent at your Slack export or Discord guild and it rebuilds the whole ecosystem inside Freeflow — channels, threads, DMs, files, emoji, authors, timestamps.",
};

const timeline = [
  {
    when: "Week 0 — Friday",
    title: "Rehearse in the dark",
    body: "Spin Freeflow up on a spare box, run the importer in dry-run, and read the report. You will find two custom emoji with broken names and one channel nobody has posted in since 2021. Nothing is at stake yet.",
  },
  {
    when: "Week 0 — Weekend",
    title: "Fix what the rehearsal found",
    body: "Map the handful of accounts that do not resolve, decide which archived channels are worth carrying, and re-run. The importer is idempotent, so re-running is boring rather than dangerous.",
  },
  {
    when: "Week 1 — Sunday night",
    title: "Run it for real",
    body: "Final export, final import, invite links out. Your old workspace stays live and read-only for as long as you want a safety net.",
  },
  {
    when: "Week 1 — Monday",
    title: "People just open a different app",
    body: "The channels have the same names. The threads have the same replies. The pinned deploy checklist is still pinned. Nobody has to be retrained on chat.",
  },
];

const carriedYes = [
  "Public channels, with topics and purposes",
  "Private channels, with their membership",
  "Threads and replies, nested correctly",
  "1:1 DMs and private group DMs",
  "File attachments, re-encrypted on arrival",
  "Custom emoji",
  "Reactions, with who reacted",
  "Original authors and timestamps",
  "Pins and channel bookmarks",
  "User profiles, avatars, and timezones",
];

const carriedNo = [
  "Slack Canvases — Freeflow has no canvas surface",
  "BlockKit message layouts — collapsed to Markdown",
  "Huddle and call history — no calls product",
  "Workflow Builder automations — rewrite as agents",
  "Discord voice channels and stage events",
];

export default function MigratePage() {
  // Hidden for now. Flip `routes.migrate` in site.config.ts to publish it.
  if (!routes.migrate) notFound();

  return (
    <>
      <PageHero
        title={
          <>
            Send an agent to do the{" "}
            <em className="serif-accent text-accent">packing</em>.
          </>
        }
        body="Nobody stays on a chat platform they have outgrown because they love it. They stay because moving means abandoning eight years of context — every decision, every thread, every file somebody will need in nine months. Freeflow's importers exist so that stops being a reason."
        actions={
          <>
            <Button
              href={links.docs}
              size="lg"
              external
              icon={<Github className="size-[18px]" />}
            >
              Migration docs
            </Button>
            <Button href={links.selfHost} variant="secondary" size="lg">
              Set up a target server first
            </Button>
          </>
        }
      />

      <Section tone="paper">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-16">
            <div>
              <SectionHeading
                align="left"
                lead="Two environment variables."
                title={
                  <>
                    One{" "}
                    <em className="serif-accent text-accent">command</em>.
                  </>
                }
                body="The importer talks to Freeflow through the same admin API your own tooling would use. There is no privileged back door, which also means you can read exactly what it is about to do before you let it."
              />

              <div className="mt-9">
                <TerminalPanel
                  caption="migration — bash"
                  commands={[
                    {
                      note: "Rehearsal: writes nothing, reports everything",
                      cmd: "pnpm flow:import --from slack-export.zip --dry-run",
                    },
                    {
                      note: "The real thing, once the report looks right",
                      cmd: "pnpm flow:import --from slack-export.zip",
                    },
                  ]}
                />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 text-[13.5px] text-muted">
                <span className="inline-flex items-center gap-2">
                  <Slack className="size-4" /> Standard Slack export
                </span>
                <span className="text-line-strong">·</span>
                <span className="inline-flex items-center gap-2">
                  <Discord className="size-[17px]" /> Discord guild via bot token
                </span>
              </div>
            </div>

            <Reveal delay={100} className="lg:sticky lg:top-24">
              <CodeTabs tabs={migrateTabs} />
              <p className="mt-4 text-[13.5px] text-muted">
                Or drive the importers directly from your own script — they are
                ordinary TypeScript classes, not a CLI you have to reverse
                engineer.
              </p>
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section tone="mist">
        <Container>
          <SectionHeading
            lead="Most of it comes."
            title={
              <>
                We are{" "}
                <em className="serif-accent text-accent">specific</em> about the
                rest.
              </>
            }
            body="A migration tool that promises everything is a migration tool that surprises you on Sunday night. Here is the honest split."
          />

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full">
                <h3 className="flex items-center gap-2 text-[1.0625rem] font-semibold">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-free-soft text-free">
                    <Check className="size-[14px]" />
                  </span>
                  Comes with you
                </h3>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {carriedYes.map((c) => (
                    <li
                      key={c}
                      className="flex items-start gap-2 text-[14px] leading-snug text-body"
                    >
                      <Check className="mt-0.5 size-[15px] shrink-0 text-free" />
                      {c}
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>

            <Reveal delay={90}>
              <Card className="h-full">
                <h3 className="flex items-center gap-2 text-[1.0625rem] font-semibold">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-warn-soft text-warn">
                    <Cross className="size-[14px]" />
                  </span>
                  Does not
                </h3>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {carriedNo.map((c) => (
                    <li
                      key={c}
                      className="flex items-start gap-2 text-[14px] leading-snug text-body"
                    >
                      <Cross className="mt-0.5 size-[15px] shrink-0 text-muted" />
                      {c}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 border-t border-line pt-4 text-[13.5px] text-muted">
                  Every item here is a ruled non-goal rather than a bug. If one
                  of them is load-bearing for your team, say so before you
                  migrate, not after.
                </p>
              </Card>
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section tone="paper">
        <Container>
          <SectionHeading
            lead="Not a big-bang cutover."
            title={
              <>
                A rehearsal, then a{" "}
                <em className="serif-accent text-accent">Sunday</em>.
              </>
            }
            body="The importer being idempotent is the whole trick. You get to be wrong twice for free."
          />

          <ol className="mt-12 flex flex-col gap-px overflow-hidden rounded-panel border border-line bg-line">
            {timeline.map((t, i) => (
              <Reveal key={t.title} delay={i * 70}>
                <li className="grid gap-2 bg-paper p-6 sm:grid-cols-[180px_1fr] sm:gap-8">
                  <span className="font-mono text-[12.5px] text-accent">
                    {t.when}
                  </span>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold">{t.title}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-body">
                      {t.body}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>

          <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row">
            <Button
              href={links.selfHost}
              size="lg"
              icon={<ArrowRight className="size-[18px]" />}
            >
              Stand up a server first
            </Button>
            <Button href={links.agents} variant="secondary" size="lg">
              Then bring your agents across
            </Button>
          </div>

          <div className="mt-8">
            <TextLink href={links.deployment} external>
              Production deployment guide
            </TextLink>
          </div>
        </Container>
      </Section>

      <FinalCta />
    </>
  );
}
