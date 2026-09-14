import { links } from "@/site.config";
import { Reveal } from "@/components/reveal";
import { Button, Container } from "@/components/ui";
import { ArrowRight, Github, Logo } from "@/components/icons";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-accent-soft pb-9 sm:pb-12">
      <div aria-hidden="true" className="square-grid absolute inset-0 text-accent/10" />
      <Container className="relative">
        <Reveal>
          <div className="relative overflow-hidden rounded-surface bg-ink px-6 py-9 sm:px-10 sm:py-10 lg:px-14">
            <div aria-hidden="true" className="dot-grid pointer-events-none absolute inset-0 text-white/5" />
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-[300px] w-[620px] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px]" />

            <div className="relative flex flex-col gap-9 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4 sm:gap-6">
                <span className="mt-1 inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_14px_38px_-16px_rgba(124,58,237,0.9)] sm:size-14">
                  <Logo className="size-7 sm:size-8" />
                </span>
                <div>
                  <h2 className="max-w-xl text-[clamp(2rem,4.2vw,3.35rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-white">
                    Bring your team.<br />Bring your agents.
                  </h2>
                  <p className="mt-4 font-mono text-[11px] tracking-tight text-white/40 sm:text-[12px]">
                    Free · Open source · No seat limits · macOS + web + iOS
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-start gap-3 lg:items-center">
                <Button
                  href={links.signup}
                  size="lg"
                  external
                  className="min-w-48"
                  icon={<ArrowRight className="size-[18px]" />}
                >
                  Sign up free
                </Button>
                <a
                  href={links.github}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-2 text-[13px] font-medium text-white/60 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white"
                >
                  View on GitHub <Github className="size-4" />
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
