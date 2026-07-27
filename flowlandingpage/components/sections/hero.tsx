import { links, specs } from "@/site.config";
import { ProductShot } from "@/components/product-shot";
import { Reveal } from "@/components/reveal";
import { Button, Container, Stat } from "@/components/ui";
import {
  Apple,
  ArrowRight,
  Check,
  Github,
  Hash,
  Lock,
  Sparkle,
  Users,
} from "@/components/icons";

/** What Freeflow is, in five chips, so nobody has to guess it is a chat app. */
const chips = [
  { icon: Hash, label: "Channels & threads" },
  { icon: Users, label: "DMs & group DMs" },
  { icon: Lock, label: "Encrypted files" },
  { icon: Sparkle, label: "Agents as members" },
  { icon: Apple, label: "macOS & web" },
];

function FloatingCard({
  initials,
  color,
  name,
  line,
  meta,
  tone = "accent",
  className = "",
  delay = "0s",
}: {
  initials: string;
  color: string;
  name: string;
  line: string;
  meta: string;
  tone?: "accent" | "free";
  className?: string;
  delay?: string;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ animationDelay: delay }}
      className={`float absolute z-10 hidden w-[220px] rounded-panel border border-line bg-paper p-3.5 shadow-[0_18px_44px_-14px_rgba(11,12,16,0.3)] xl:block ${className}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[9.5px] font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {initials}
        </span>
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
        <span
          className={`ml-auto inline-flex size-4 items-center justify-center rounded-full ${
            tone === "free" ? "bg-free text-white" : "bg-accent text-white"
          }`}
        >
          <Check className="size-2.5" />
        </span>
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-body">{line}</p>
      <p className="mt-1 font-mono text-[10.5px] text-muted">{meta}</p>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-20">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-grid absolute inset-x-0 top-0 h-[560px] text-line" />
        <div className="absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-paper/40 via-paper/85 to-paper" />
        <div className="absolute top-[-140px] left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <Container>
        <div className="flex flex-col items-center gap-7 text-center">
          <Reveal delay={60}>
            <h1 className="max-w-4xl text-[clamp(2.6rem,6.2vw,4.6rem)] leading-[1.03] font-semibold tracking-[-0.035em] text-ink">
              Team chat where humans and agents{" "}
              <em className="serif-accent text-accent">work together</em>.
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="max-w-2xl text-[1.125rem] leading-[1.65] text-body">
              Freeflow is free, open source, and built by the people who use it.
              Bring your team. Bring your agents.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Button
                href={links.signup}
                size="lg"
                external
                icon={<ArrowRight className="size-[18px]" />}
              >
                Sign up free
              </Button>
              <Button
                href={links.github}
                variant="secondary"
                size="lg"
                external
                icon={<Github className="size-[18px]" />}
              >
                Self-host it
              </Button>
            </div>
          </Reveal>

          <Reveal delay={220}>
            <p className="font-mono text-[12.5px] tracking-tight text-muted">
              No credit card. No seat count. No trial to expire.
            </p>
          </Reveal>

          <Reveal delay={260}>
            <ul className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {chips.map((c) => (
                <li
                  key={c.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/80 px-3 py-1.5 text-[13px] text-body backdrop-blur-sm"
                >
                  <c.icon className="size-[14px] text-muted" />
                  {c.label}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* product shot, with two agent actions floating alongside it */}
        <Reveal delay={300} className="relative mt-14 sm:mt-16">
          <FloatingCard
            className="-top-7 -left-7"
            initials="RB"
            color="#4f46e5"
            name="review-bot"
            line="Approved #412 and merged it."
            meta="4 findings · 1 fix pushed"
            delay="0s"
          />
          <FloatingCard
            className="-right-7 -bottom-8"
            initials="DB"
            color="#047857"
            name="deploy-bot"
            line="Shipped 7c31de9 to staging."
            meta="health check green · p99 41ms"
            tone="free"
            delay="1.4s"
          />
          <ProductShot />
        </Reveal>

        <Reveal delay={340}>
          <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line pt-10 sm:mt-14 lg:grid-cols-4">
            {specs.map((s) => (
              <Stat key={s.label} value={s.value} label={s.label} />
            ))}
          </div>
        </Reveal>

        <Reveal delay={380}>
          <p className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-line pt-8 text-center text-[14.5px] text-body">
            Built in the open.
            <a
              href={links.github}
              target="_blank"
              rel="noreferrer noopener"
              className="group inline-flex items-center gap-1.5 font-medium text-accent hover:text-accent-hover"
            >
              Read the code, file an issue, or send a pull request
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
