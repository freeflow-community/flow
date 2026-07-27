import { featureGroups } from "@/lib/content";
import { Reveal } from "@/components/reveal";
import {
  Card,
  Container,
  IconChip,
  Section,
  SectionHeading,
} from "@/components/ui";
import { Check, Icon } from "@/components/icons";

export function Features() {
  return (
    <Section id="features" tone="paper">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Not a proof of concept."
            title={
              <>
                The whole{" "}
                <em className="serif-accent text-accent">product</em>, on day
                one.
              </>
            }
          />
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {featureGroups.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80}>
              <Card className="flex h-full flex-col">
                <div className="flex items-center gap-3">
                  <IconChip>
                    <Icon name={f.icon} className="size-[19px]" />
                  </IconChip>
                  <h3 className="text-[1.0625rem] font-semibold">{f.title}</h3>
                </div>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {f.points.map((p) => (
                    <li
                      key={p}
                      className="flex items-start gap-2.5 text-[14px] leading-snug text-body"
                    >
                      <Check className="mt-0.5 size-[15px] shrink-0 text-accent" />
                      {p}
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
