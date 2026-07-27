import { links } from "@/site.config";
import { Reveal } from "@/components/reveal";
import { Badge, Container, TextLink } from "@/components/ui";

const phases = [
  { n: "1", label: "Foundation", done: true },
  { n: "2", label: "DMs, reactions, files, mentions", done: true },
  { n: "3", label: "Retheme + status system", done: true },
  { n: "4", label: "Slack app compatibility", done: true },
  { n: "5", label: "Attachment & thread UX", done: true },
  { n: "6", label: "Text and PDF previews", done: true },
  { n: "7", label: "In flight", done: false },
];

/**
 * Deliberately not a testimonial wall. This project has no customer logos to
 * show, so it shows the changelog instead — which this audience trusts more.
 */
export function Status() {
  return (
    <section className="border-y border-line bg-paper py-14">
      <Container>
        <Reveal>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-14">
            <div className="max-w-md">
              <h2 className="text-[1.25rem] font-semibold">
                Built in the open, at a readable pace.
              </h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-body">
                No customer logos here — Freeflow is young and pretending otherwise
                would be the first lie on this page. What it has instead is a
                public changelog, a parity ledger, and a decision log you can
                argue with.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2">
                <TextLink href={links.changelog} external>
                  Read the changelog
                </TextLink>
                <TextLink href={links.decisionLog} external>
                  Decision log
                </TextLink>
              </div>
            </div>

            <ol className="grid flex-1 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:max-w-xl">
              {phases.map((p) => (
                <li
                  key={p.n}
                  className="flex items-center gap-3 bg-paper px-4 py-3"
                >
                  <span className="font-mono text-[12px] text-muted">
                    {`0${p.n}`}
                  </span>
                  <span className="flex-1 truncate text-[13.5px] text-ink">
                    {p.label}
                  </span>
                  <Badge tone={p.done ? "free" : "muted"}>
                    {p.done ? "done" : "wip"}
                  </Badge>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
