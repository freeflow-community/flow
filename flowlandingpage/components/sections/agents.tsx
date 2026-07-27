import { links } from "@/site.config";
import { AgentConsole } from "@/components/agent-console";
import { Reveal } from "@/components/reveal";
import { Button, Container, Section, SectionHeading } from "@/components/ui";
import { ArrowRight, Github } from "@/components/icons";

const setup = [
  {
    n: "01",
    title: "Name it and say what it's for",
    body: "One sentence. “Review pull requests before anyone merges them.”",
  },
  {
    n: "02",
    title: "Scope what it can touch",
    body: "Which repos it reads, which commands it runs. Change your mind anytime.",
  },
  {
    n: "03",
    title: "Invite it to a channel",
    body: "It shows up as a member and starts working in the thread.",
  },
];

export function Agents() {
  return (
    <Section id="agents" tone="dark" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 text-white/5"
      />
      <Container className="relative">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
          <div>
            <Reveal>
              <SectionHeading
                align="left"
                dark
                lead="Your channels already hold every decision."
                title={
                  <>
                    Now something can{" "}
                    <em className="serif-accent text-[#a5b4fc]">act</em> on
                    them.
                  </>
                }
                body="Agents here aren’t apps you install. They’re members you describe. Because they live in the thread, they start with everything your team already said, instead of asking you to explain it again."
              />
            </Reveal>

            <div className="mt-10 flex flex-col divide-y divide-white/10 border-t border-white/10">
              {setup.map((s, i) => (
                <Reveal key={s.n} delay={i * 80}>
                  <div className="flex gap-4 py-5">
                    <span className="font-mono text-[13px] text-[#a5b4fc]">
                      {s.n}
                    </span>
                    <div>
                      <h3 className="text-[1rem] font-semibold text-white">
                        {s.title}
                      </h3>
                      <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/55">
                        {s.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={300}>
              <p className="mt-6 text-[14px] text-white/45">
                That&rsquo;s the whole setup. No marketplace, no OAuth dance, no
                third party holding your context.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button
                  href={links.signup}
                  variant="invert"
                  size="lg"
                  external
                  icon={<ArrowRight className="size-[18px]" />}
                >
                  Try it free
                </Button>
                <Button
                  href={links.github}
                  variant="ghost"
                  size="lg"
                  external
                  className="text-white hover:bg-white/10"
                  icon={<Github className="size-[18px]" />}
                >
                  Read the code
                </Button>
              </div>
            </Reveal>
          </div>

          <Reveal delay={140} className="lg:sticky lg:top-24">
            <AgentConsole />
            <p className="mt-4 text-center text-[13px] text-white/40">
              Type your own, or pick one. The responses are scripted; the
              interaction is not.
            </p>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
