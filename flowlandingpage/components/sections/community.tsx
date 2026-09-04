import { links } from "@/site.config";
import { Reveal } from "@/components/reveal";
import {
  Button,
  Container,
  IconChip,
  Section,
  SectionHeading,
  TextLink,
} from "@/components/ui";
import { Github, Icon } from "@/components/icons";

const facts = [
  {
    icon: "shield" as const,
    title: "MIT licensed",
    body: "Fork it, run it, sell what you build on it. No CLA, no clock ticking toward a licence change.",
  },
  {
    icon: "users" as const,
    title: "Community built",
    body: "The roadmap is a public issue tracker. Disagree with a decision and you can argue it in the open or ship the alternative.",
  },
  {
    icon: "server" as const,
    title: "Hosted or self-hosted",
    body: "Same features either way, same price either way. Start on ours, move to yours whenever you feel like it.",
  },
  {
    icon: "lock" as const,
    title: "Nothing phones home",
    body: "No telemetry, no analytics beacon, no vendor holding a copy of what your team said to each other.",
  },
];

export function Community() {
  return (
    <Section id="open-source" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Nobody owns this."
            title={
              <>
                Not a corporation. Not a{" "}
                <em className="serif-accent text-free">founder</em>. Not us.
              </>
            }
            body="Every chat tool your team has outgrown was owned by someone with a quarter to hit. Freeflow is built in the open by the people who run it. There’s no investor to satisfy, no acquisition to survive, and no version where your history quietly moves behind a paywall."
          />
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {facts.map((f, i) => (
            <Reveal key={f.title} delay={(i % 2) * 80}>
              <div className="flex h-full items-start gap-4 rounded-panel border border-line bg-paper p-6">
                <IconChip tone="free">
                  <Icon name={f.icon} className="size-[19px]" />
                </IconChip>
                <div>
                  <h3 className="text-[1.0625rem] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-body">
                    {f.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={220}>
          <div className="mt-6 rounded-surface border border-free/20 bg-free-soft p-8 sm:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
              <div className="max-w-2xl">
                <h3 className="text-[1.4rem] leading-snug font-semibold text-ink sm:text-[1.7rem]">
                  We can&rsquo;t start charging you for the copy you already
                  have.
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-body">
                  Anyone can relicense future code. Nobody can reach backwards
                  and revoke the version sitting in your repo. That&rsquo;s not
                  a promise from us. It&rsquo;s how the licence works.
                </p>
                <div className="mt-4">
                  <TextLink href={links.license} external>
                    Read the licence
                  </TextLink>
                </div>
              </div>

              <Button
                href={links.github}
                size="lg"
                external
                icon={<Github className="size-[18px]" />}
              >
                Star it on GitHub
              </Button>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
