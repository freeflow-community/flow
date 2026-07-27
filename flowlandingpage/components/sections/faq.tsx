import { links } from "@/site.config";
import { faqs, nonGoals } from "@/lib/content";
import { Reveal } from "@/components/reveal";
import {
  Container,
  Section,
  SectionHeading,
  TextLink,
} from "@/components/ui";
import { Chevron } from "@/components/icons";

export function Faq() {
  return (
    <Section id="faq" tone="paper">
      <Container>
        {/* Non-goals first — leading with the limitations buys the answers below */}
        <Reveal>
          <div className="rounded-surface border border-warn/20 bg-warn-soft p-7 sm:p-9">
            <div className="grid gap-7 lg:grid-cols-[1fr_1.25fr] lg:items-center lg:gap-12">
              <div>
                <h2 className="text-[clamp(1.6rem,3vw,2.15rem)] leading-tight font-semibold">
                  Here is what Freeflow{" "}
                  <em className="serif-accent text-warn">won&rsquo;t</em> do.
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-body">
                  These are decisions written down in the spec, not gaps we are
                  quietly hoping you miss. If one of them is load-bearing for
                  your team, Freeflow is the wrong choice today — and we would
                  rather you find that out here than in week three.
                </p>
                <div className="mt-4">
                  <TextLink href={links.overview} external>
                    Read the scope document
                  </TextLink>
                </div>
              </div>

              <ul className="grid gap-px overflow-hidden rounded-panel border border-warn/15 bg-warn/15 sm:grid-cols-2">
                {nonGoals.map((n) => (
                  <li key={n.label} className="bg-paper px-4 py-3.5">
                    <span className="block text-[14.5px] font-medium text-ink">
                      {n.label}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {n.note}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-20">
            <SectionHeading
              lead="The things you were about to ask"
              title={
                <>
                  answered{" "}
                  <em className="serif-accent text-accent">straight</em>.
                </>
              }
            />
          </div>
        </Reveal>

        <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-3">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={Math.min(i, 4) * 50}>
              <details className="group rounded-panel border border-line bg-paper open:border-line-strong">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-5 py-4 text-[15.5px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Chevron className="size-[18px] shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <div className="px-5 pb-5 text-[14.5px] leading-relaxed text-body">
                  {f.a}
                </div>
              </details>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <p className="mt-10 text-center text-[14.5px] text-body">
            Still unsure?{" "}
            <a
              href={links.discussions}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-accent hover:text-accent-hover"
            >
              Ask in Discussions
            </a>{" "}
            — the maintainers answer there in public, which is the only kind of
            answer worth having.
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
