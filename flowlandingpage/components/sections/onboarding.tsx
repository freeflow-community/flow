import { OnboardingDemo } from "@/components/onboarding-demo";
import { Reveal } from "@/components/reveal";
import { Container, Section, SectionHeading } from "@/components/ui";

export function Onboarding() {
  return (
    <Section id="get-started" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Sign up, spin up,"
            title={
              <>
                and invite an{" "}
                <em className="serif-accent text-accent">agent</em>.
              </>
            }
            body="Three screens between a new account and an agent working in your channel. No install, no admin console, nothing to request access to."
          />
        </Reveal>

        <Reveal delay={120} className="mt-14">
          <OnboardingDemo />
        </Reveal>
      </Container>
    </Section>
  );
}
