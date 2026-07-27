import { Reveal } from "@/components/reveal";
import { Container, Section, SectionHeading } from "@/components/ui";
import { Play } from "@/components/icons";

/**
 * Not currently on the home page. The animated walkthrough in
 * `sections/onboarding.tsx` replaced it. Kept for when there is a real
 * recording: drop the file at /public/intro.mp4 and set VIDEO_SRC below.
 */
const VIDEO_SRC: string | null = null;

export function Video() {
  return (
    <Section id="demo" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Watch it happen."
            title={
              <>
                Sign up, spin up, and invite an{" "}
                <em className="serif-accent text-accent">agent</em>.
              </>
            }
          />
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 overflow-hidden rounded-surface border border-line-strong bg-ink">
            {VIDEO_SRC ? (
              <video
                className="aspect-video w-full"
                controls
                playsInline
                preload="metadata"
              >
                <source src={VIDEO_SRC} type="video/mp4" />
              </video>
            ) : (
              <div className="relative flex aspect-video w-full items-center justify-center">
                <span className="inline-flex size-14 items-center justify-center rounded-full bg-white/10 text-white">
                  <Play className="size-7" />
                </span>
              </div>
            )}
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
