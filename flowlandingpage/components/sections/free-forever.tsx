import { links } from "@/site.config";
import { freeFacts } from "@/lib/content";
import { Reveal } from "@/components/reveal";
import {
  Card,
  Container,
  IconChip,
  Section,
  SectionHeading,
  TextLink,
} from "@/components/ui";
import { Icon } from "@/components/icons";

export function FreeForever() {
  return (
    <Section id="free" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Free isn’t a trial."
            title={
              <>
                It&rsquo;s the{" "}
                <em className="serif-accent text-free">licence</em>.
              </>
            }
          />
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {freeFacts.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 70}>
              <Card className="flex h-full items-start gap-3.5 bg-paper">
                <IconChip tone="free">
                  <Icon name={f.icon} className="size-[19px]" />
                </IconChip>
                <div>
                  <h3 className="text-[15px] leading-snug font-semibold">
                    {f.title}
                  </h3>
                  <p className="mt-1 text-[14px] leading-snug text-body">
                    {f.body}
                  </p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>

        {/* The promise, stated once, plainly. */}
        <Reveal delay={220}>
          <div className="mt-6 overflow-hidden rounded-surface border border-free/20 bg-free-soft">
            <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[1.5fr_1fr] lg:items-center">
              <div>
                <h3 className="text-[1.4rem] leading-snug font-semibold text-ink sm:text-[1.7rem]">
                  We can&rsquo;t start charging you for the copy you already
                  have.
                </h3>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-body">
                  Anyone can relicense future code. Nobody can reach backwards
                  and revoke the version sitting in your repo. Clone it once and
                  the exit is permanent.
                </p>
                <div className="mt-5">
                  <TextLink href={links.license} external>
                    Read the licence
                  </TextLink>
                </div>
              </div>

              <ul className="flex flex-col gap-3 border-t border-free/15 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                {[
                  ["Seats", "not counted"],
                  ["History", "never truncated"],
                  ["Features", "all of them"],
                  ["Telemetry", "none"],
                ].map(([k, v]) => (
                  <li
                    key={k}
                    className="flex items-baseline justify-between gap-4 text-[14.5px]"
                  >
                    <span className="text-body">{k}</span>
                    <span className="font-mono text-[13px] text-free">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
