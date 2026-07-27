import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { links, routes } from "@/site.config";
import { agentTabs } from "@/lib/snippets";
import { AgentConsole } from "@/components/agent-console";
import { CodeTabs } from "@/components/code-tabs";
import { PageHero } from "@/components/page-hero";
import { Reveal } from "@/components/reveal";
import { FinalCta } from "@/components/sections/final-cta";
import { Workflows } from "@/components/sections/workflows";
import {
  Button,
  Card,
  Container,
  IconChip,
  Section,
  SectionHeading,
  TextLink,
} from "@/components/ui";
import { ArrowRight, Check, Github, Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Agents that live in your channels",
  description:
    "Freeflow is AI-native team chat. Agents are members, not apps — they read the thread, run against your repos, and answer where the question was asked.",
};

const outOfTheBox = [
  "Read any repo you scope it to",
  "Search the codebase",
  "Open, review, and comment on PRs",
  "Run tests and CI jobs",
  "Push a branch",
  "Deploy and roll back",
  "Open and assign issues",
  "Run your runbooks",
  "Read the thread it's in",
  "Read past incidents in the channel",
  "Reply in threads and react",
  "Ask a human before it does the scary thing",
];

const ideas = [
  {
    icon: "code" as const,
    title: "The reviewer",
    body: "Reads every PR the moment it opens and posts what a tired human misses at 6pm.",
  },
  {
    icon: "terminal" as const,
    title: "The on-call runner",
    body: "Takes a plain-English instruction in #incidents and runs the runbook step in front of everyone.",
  },
  {
    icon: "sparkle" as const,
    title: "The archivist",
    body: "Reads a month of channel history and writes the summary nobody had time to write.",
  },
  {
    icon: "shield" as const,
    title: "The gatekeeper",
    body: "The last thing between main and a Friday deploy.",
  },
];

const whyHere = [
  {
    title: "It already has the context",
    body: "The agent lives in the thread where the incident is being argued about. It doesn't need a summary of what's happening — it read it.",
  },
  {
    title: "Nothing gets installed",
    body: "No marketplace, no OAuth dance, no third-party service holding a copy of your conversations to be useful.",
  },
  {
    title: "The permission model is a sentence",
    body: "This agent can read these repos, run these commands, in these channels. Change your mind and it changes immediately.",
  },
  {
    title: "The audit trail is the transcript",
    body: "Every action lands in the channel as a message. Who asked, what it did, what came back — scrollable by anyone, forever.",
  },
];

export default function AgentsPage() {
  // Hidden for now. Flip `routes.agents` in site.config.ts to publish it.
  if (!routes.agents) notFound();

  return (
    <>
      <PageHero
        title={
          <>
            Chat that can{" "}
            <em className="serif-accent text-accent">do</em> things.
          </>
        }
        body="Chat is where your team decides everything and where your team does nothing. Freeflow closes that gap. Agents here aren't apps you install — they're members you describe, working in the thread that already holds the context."
        actions={
          <>
            <Button
              href={links.agentMembers}
              size="lg"
              external
              icon={<Github className="size-[18px]" />}
            >
              Agent docs
            </Button>
            <Button href={links.agentsDesign} variant="secondary" size="lg" external>
              Design notes
            </Button>
          </>
        }
      />

      <Section tone="paper">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-start lg:gap-14">
            <Reveal>
              <AgentConsole />
              <p className="mt-4 text-[13px] text-muted">
                Type your own or pick one. Responses are scripted — the shape of
                the interaction is not.
              </p>
            </Reveal>

            <div>
              <SectionHeading
                align="left"
                lead="Why it works better here"
                title={
                  <>
                    than in a{" "}
                    <em className="serif-accent text-accent">tab</em> somewhere
                    else.
                  </>
                }
                body="An assistant in another window starts every conversation from zero. An agent with a seat in the channel starts from everything your team already said."
              />

              <div className="mt-9 flex flex-col divide-y divide-line border-y border-line">
                {whyHere.map((w) => (
                  <div key={w.title} className="py-5">
                    <h3 className="text-[1rem] font-semibold">{w.title}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-body">
                      {w.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="mist">
        <Container>
          <SectionHeading
            lead="No setup, no scopes to request."
            title={
              <>
                Here&rsquo;s what it can do on{" "}
                <em className="serif-accent text-accent">day one</em>.
              </>
            }
          />

          <div className="mt-12 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {outOfTheBox.map((m) => (
              <div
                key={m}
                className="flex items-center gap-2.5 rounded-[10px] border border-line bg-paper px-4 py-3"
              >
                <Check className="size-[15px] shrink-0 text-free" />
                <span className="text-[14px] text-ink">{m}</span>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-[14px] text-muted">
            You choose which of these each agent gets. None of it is on by
            default.
          </p>
        </Container>
      </Section>

      <Section tone="paper">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-16">
            <div>
              <SectionHeading
                align="left"
                lead="Describe it in a sentence."
                title={
                  <>
                    Drop to{" "}
                    <em className="serif-accent text-accent">code</em> when you
                    want more.
                  </>
                }
                body="Most agents never need a file. When one does — a custom tool, a private data source, a rule that only makes sense at your company — it's ordinary TypeScript running on your own machines."
              />

              <div className="mt-8">
                <TextLink href={links.agentsDesign} external>
                  How the runtime works
                </TextLink>
              </div>
            </div>

            <Reveal delay={100} className="lg:sticky lg:top-24">
              <CodeTabs tabs={agentTabs} />
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section tone="mist">
        <Container>
          <SectionHeading
            lead="Not chatbots."
            title={
              <>
                Colleagues that happen to be{" "}
                <em className="serif-accent text-accent">software</em>.
              </>
            }
          />

          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {ideas.map((idea, i) => (
              <Reveal key={idea.title} delay={(i % 2) * 80}>
                <Card className="h-full bg-paper">
                  <IconChip>
                    <Icon name={idea.icon} className="size-[19px]" />
                  </IconChip>
                  <h3 className="mt-4 text-[1.0625rem] font-semibold">
                    {idea.title}
                  </h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-body">
                    {idea.body}
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row">
            <Button
              href={links.github}
              size="lg"
              external
              icon={<Github className="size-[18px]" />}
            >
              Clone the repo
            </Button>
            <Button
              href={links.migrate}
              variant="secondary"
              size="lg"
              icon={<ArrowRight className="size-[18px]" />}
            >
              Bring your history across
            </Button>
          </div>
        </Container>
      </Section>

      <Workflows />

      <FinalCta />
    </>
  );
}
