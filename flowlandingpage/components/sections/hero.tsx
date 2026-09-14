import { links } from "@/site.config";
import { ProductShot } from "@/components/product-shot";
import { Reveal } from "@/components/reveal";
import { Button, Container } from "@/components/ui";
import { Apple, ArrowRight } from "@/components/icons";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-24 sm:pt-28">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[700px]">
        <div className="square-grid absolute inset-0 text-line" />
        <div className="absolute inset-0 bg-gradient-to-b from-paper/20 via-paper/72 to-paper" />
        <div className="absolute top-[-210px] left-1/2 h-[500px] w-[860px] -translate-x-1/2 rounded-full bg-accent/10 blur-[130px]" />
      </div>

      <Container>
        <div className="flex flex-col items-center pb-14 text-center sm:pb-16">
          <Reveal delay={20}>
            <a
              href={links.ios}
              target="_blank"
              rel="noreferrer noopener"
              className="group inline-flex items-center gap-2.5 rounded-full border border-accent-line bg-paper/85 px-3.5 py-1.5 text-[12px] font-medium text-ink shadow-[0_10px_28px_-22px_rgba(109,53,198,0.9)] backdrop-blur-sm transition-colors hover:border-accent hover:bg-accent-soft sm:text-[13px]"
            >
              <Apple className="size-3.5" />
              <span>Freeflow for iOS is live</span>
              <span className="text-accent transition-transform group-hover:translate-x-0.5">Get the app →</span>
            </a>
          </Reveal>

          <Reveal delay={40}>
            <p className="mt-6 font-mono text-[11px] font-medium tracking-[0.16em] text-ink uppercase">
              Team chat for people + AI agents
            </p>
          </Reveal>

          <Reveal delay={90}>
            <h1 className="mt-7 max-w-5xl text-[clamp(2.75rem,6.25vw,4.85rem)] leading-[0.99] font-semibold tracking-[-0.052em] text-ink">
              Team chat where humans and agents{" "}
              <em className="serif-accent text-accent">work together</em>.
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="mt-6 max-w-2xl text-[1.025rem] leading-[1.7] text-body sm:text-[1.1rem]">
              Your team already has the context. In Freeflow, agents join the
              same channels, do the work, and share the result without anyone
              copying the conversation elsewhere.
            </p>
          </Reveal>

          <Reveal delay={190}>
            <div className="mt-7 flex items-center">
              <Button
                href={links.signup}
                size="lg"
                external
                icon={<ArrowRight className="size-[18px]" />}
              >
                Sign up free
              </Button>
            </div>
          </Reveal>

          <Reveal delay={230}>
            <p className="mt-4 font-mono text-[12px] tracking-tight text-muted sm:text-[12.5px]">
              Free + open source · No seat limits · macOS + web + iOS
            </p>
          </Reveal>
        </div>
      </Container>

      <Reveal delay={280}>
        <div className="stage-glow relative overflow-hidden bg-ink py-5 sm:py-8 lg:py-10">
          <div aria-hidden="true" className="dot-grid absolute inset-0 text-white/[0.045]" />
          <Container className="relative">
            <ProductShot />
          </Container>
        </div>
      </Reveal>
    </section>
  );
}
