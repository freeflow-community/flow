import { links } from "@/site.config";
import { Reveal } from "@/components/reveal";
import { Button, Container } from "@/components/ui";
import { ArrowRight, Github } from "@/components/icons";

export function FinalCta() {
  return (
    <section className="bg-paper py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-surface bg-ink px-7 py-16 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden="true"
              className="dot-grid pointer-events-none absolute inset-0 text-white/5"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 left-1/2 h-[320px] w-[640px] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px]"
            />

            <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
              <h2 className="text-[clamp(2rem,4.4vw,3.25rem)] leading-[1.06] font-semibold text-white">
                Stop renting your team&rsquo;s{" "}
                <em className="serif-accent text-[#a5b4fc]">conversations</em>.
              </h2>

              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <Button
                  href={links.signup}
                  variant="invert"
                  size="lg"
                  external
                  icon={<ArrowRight className="size-[18px]" />}
                >
                  Sign up free
                </Button>
                <Button
                  href={links.github}
                  variant="ghost"
                  size="lg"
                  external
                  className="text-white hover:bg-white/10"
                  icon={<Github className="size-[18px]" />}
                >
                  Self-host it
                </Button>
              </div>

              <p className="font-mono text-[12.5px] tracking-tight text-white/40">
                Open source · Community built · No seats, no tiers, no expiry
              </p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
