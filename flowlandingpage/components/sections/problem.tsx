import { problems } from "@/lib/content";
import { Reveal } from "@/components/reveal";
import { Container, Section, SectionHeading } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * The whole argument in one picture: one line climbs with headcount, the other
 * never leaves the floor. No dollar figures. We do not quote competitor
 * pricing we cannot verify, and the shape is the point anyway.
 */
function CostChart() {
  const marks = [
    { label: "10", x: 120 },
    { label: "50", x: 320 },
    { label: "200", x: 520 },
    { label: "500 people", x: 720 },
  ];

  return (
    <svg
      viewBox="0 0 820 300"
      className="h-auto w-full"
      role="img"
      aria-label="As headcount grows, per-seat chat costs climb while Freeflow stays at zero."
    >
      {/* gridlines */}
      {[60, 110, 160, 210].map((y) => (
        <line
          key={y}
          x1="60"
          x2="780"
          y1={y}
          y2={y}
          stroke="var(--color-line)"
          strokeWidth="1"
        />
      ))}
      <line
        x1="60"
        x2="780"
        y1="240"
        y2="240"
        stroke="var(--color-line-strong)"
        strokeWidth="1"
      />

      {/* per-seat cost climbing */}
      <path
        d="M120 226 L320 186 L520 116 L720 46"
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="7 6"
      />
      {[
        [120, 226],
        [320, 186],
        [520, 116],
        [720, 46],
      ].map(([cx, cy]) => (
        <circle
          key={`${cx}`}
          cx={cx}
          cy={cy}
          r="4.5"
          fill="var(--color-paper)"
          stroke="var(--color-muted)"
          strokeWidth="2.5"
        />
      ))}
      <text
        x="720"
        y="26"
        textAnchor="end"
        fill="var(--color-muted)"
        fontSize="15"
        fontWeight="500"
      >
        Per-seat chat
      </text>

      {/* Freeflow, flat on the floor */}
      <path
        d="M120 240 L720 240"
        fill="none"
        stroke="var(--color-free)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {[120, 320, 520, 720].map((cx) => (
        <circle
          key={cx}
          cx={cx}
          cy="240"
          r="4.5"
          fill="var(--color-free)"
        />
      ))}
      <text
        x="120"
        y="270"
        fill="var(--color-free)"
        fontSize="15"
        fontWeight="600"
      >
        Freeflow: $0, forever
      </text>

      {/* headcount axis */}
      {marks.map((m) => (
        <text
          key={m.label}
          x={m.x}
          y="292"
          textAnchor="middle"
          fill="var(--color-muted)"
          fontSize="13"
        >
          {m.label}
        </text>
      ))}

      {/* y hint */}
      <text
        x="52"
        y="60"
        textAnchor="end"
        fill="var(--color-muted)"
        fontSize="13"
      >
        cost
      </text>
    </svg>
  );
}

export function Problem() {
  return (
    <Section tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="You’re not paying for chat."
            title={
              <>
                You’re paying{" "}
                <em className="serif-accent text-accent">rent</em>.
              </>
            }
          />
        </Reveal>

        <Reveal delay={100}>
          <div className="mt-12 rounded-surface border border-line bg-paper p-6 sm:p-9">
            <CostChart />
          </div>
        </Reveal>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {problems.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <div className="flex h-full items-start gap-3 rounded-panel border border-line bg-paper p-5">
                <Icon name={p.icon} className="mt-0.5 size-5 shrink-0 text-accent" />
                <div>
                  <h3 className="text-[15px] leading-snug font-semibold">
                    {p.title}
                  </h3>
                  <p className="mt-1 text-[14px] leading-snug text-body">
                    {p.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
