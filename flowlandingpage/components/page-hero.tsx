import type { ReactNode } from "react";
import { Reveal } from "@/components/reveal";
import { Container } from "@/components/ui";

export function PageHero({
  title,
  body,
  actions,
}: {
  title: ReactNode;
  body: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-line pt-32 pb-16 sm:pt-40 sm:pb-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-grid absolute inset-0 text-line" />
        <div className="absolute inset-0 bg-gradient-to-b from-paper/50 via-paper/90 to-paper" />
      </div>

      <Container>
        <div className="flex max-w-3xl flex-col gap-6">
          <Reveal delay={60}>
            <h1 className="text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
              {title}
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="max-w-2xl text-[1.0625rem] leading-[1.7] text-body">
              {body}
            </p>
          </Reveal>
          {actions ? (
            <Reveal delay={180}>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">{actions}</div>
            </Reveal>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
