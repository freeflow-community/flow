import { links } from "@/site.config";
import { migrateTabs } from "@/lib/snippets";
import { CodeTabs } from "@/components/code-tabs";
import { Reveal } from "@/components/reveal";
import {
  Button,
  Container,
  Section,
  SectionHeading,
} from "@/components/ui";
import { ArrowRight, Check, Discord, Slack } from "@/components/icons";

const steps = [
  {
    n: "01",
    title: "Export the old place",
    body: "Slack hands you a zip. Discord hands you a guild your bot can read.",
  },
  {
    n: "02",
    title: "Point an agent at it",
    body: "One command, two environment variables.",
  },
  {
    n: "03",
    title: "Watch it rebuild",
    body: "Channels, threads, DMs, files and emoji, with authors and timestamps intact.",
  },
  {
    n: "04",
    title: "Rehearse, then commit",
    body: "It’s idempotent. Run it Friday, fix what broke, run it again Sunday.",
  },
];

const carried = [
  "Public and private channels",
  "Threads and replies, nested correctly",
  "1:1 and group DMs",
  "File attachments, re-encrypted on arrival",
  "Custom emoji",
  "Reactions and who reacted",
  "Original authors and timestamps",
  "Channel membership and topics",
];

export function Migrate() {
  return (
    <Section id="migrate" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Moving off Slack or Discord?"
            title={
              <>
                Send an agent to do the{" "}
                <em className="serif-accent text-accent">packing</em>.
              </>
            }
            body="Teams stay somewhere they’ve outgrown because of the years of context nobody wants to retype. So don’t retype it. You bring the people; the agent brings everything else."
          />
        </Reveal>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-start lg:gap-14">
          <div>
            <div className="flex flex-col gap-px overflow-hidden rounded-panel border border-line bg-line">
              {steps.map((s, i) => (
                <Reveal key={s.n} delay={i * 70}>
                  <div className="flex gap-4 bg-paper p-5 sm:p-6">
                    <span className="font-mono text-[13px] text-accent">
                      {s.n}
                    </span>
                    <div>
                      <h3 className="text-[1rem] font-semibold">{s.title}</h3>
                      <p className="mt-1.5 text-[14.5px] leading-relaxed text-body">
                        {s.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={300}>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  href={links.migrate}
                  size="lg"
                  icon={<ArrowRight className="size-[18px]" />}
                >
                  Plan your migration
                </Button>
                <span className="inline-flex items-center gap-2 text-[13.5px] text-muted">
                  <Slack className="size-4" />
                  <Discord className="size-[17px]" />
                  Slack and Discord supported
                </span>
              </div>
            </Reveal>
          </div>

          <div className="flex flex-col gap-6">
            <Reveal delay={120}>
              <CodeTabs tabs={migrateTabs} />
            </Reveal>

            <Reveal delay={200}>
              <div className="rounded-panel border border-line bg-paper p-6">
                <h3 className="text-[1rem] font-semibold">
                  What comes across with you
                </h3>
                <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {carried.map((c) => (
                    <li
                      key={c}
                      className="flex items-start gap-2 text-[14px] leading-snug text-body"
                    >
                      <Check className="mt-0.5 size-[15px] shrink-0 text-free" />
                      {c}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 border-t border-line pt-4 text-[13.5px] text-muted">
                  Your old workspace stays exactly where it is until you are
                  ready to close it. Nothing about this is one-way.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
