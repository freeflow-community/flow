import { compareColumns, compareRows, type Cell } from "@/lib/content";
import { Reveal } from "@/components/reveal";
import { Container, Section, SectionHeading } from "@/components/ui";
import { Check, Cross, Dash } from "@/components/icons";

function CellValue({ value, highlight }: { value: Cell; highlight: boolean }) {
  if (value === "yes") {
    return (
      <span
        className={`inline-flex size-6 items-center justify-center rounded-full ${
          highlight ? "bg-free text-white" : "bg-free-soft text-free"
        }`}
      >
        <Check className="size-[14px]" />
        <span className="sr-only">Yes</span>
      </span>
    );
  }
  if (value === "no") {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-mist text-muted">
        <Cross className="size-[14px]" />
        <span className="sr-only">No</span>
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-warn-soft text-warn">
        <Dash className="size-[14px]" />
        <span className="sr-only">Partial</span>
      </span>
    );
  }
  return (
    <span
      className={`font-mono text-[13px] ${
        highlight ? "font-medium text-ink" : "text-body"
      }`}
    >
      {value}
    </span>
  );
}

export function Compare() {
  return (
    <Section id="compare" tone="paper">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Slack is a good product."
            title={
              <>
                It is just not{" "}
                <em className="serif-accent text-accent">yours</em>.
              </>
            }
            body="Where Slack is genuinely better, we have said so. Where the difference is structural rather than a feature, that is the whole point of the table."
          />
        </Reveal>

        <Reveal delay={120}>
          <div className="thin-scroll mt-14 -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
              <caption className="sr-only">
                Freeflow compared with Slack Free, Slack Pro, and Discord
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-paper px-4 pb-4 text-[13px] font-medium text-muted"
                  >
                    <span className="sr-only">Capability</span>
                  </th>
                  {compareColumns.map((col, i) => (
                    <th
                      key={col}
                      scope="col"
                      className={`px-4 pb-4 text-center text-[14px] font-semibold ${
                        i === 0 ? "text-accent" : "text-body"
                      }`}
                    >
                      {col}
                      {i === 0 ? (
                        <span className="mt-1 block font-mono text-[10.5px] font-normal tracking-wide text-free uppercase">
                          MIT · self-hosted
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-t border-line bg-paper px-4 py-3.5 align-middle text-[14.5px] font-normal text-ink"
                    >
                      {row.label}
                      {row.note ? (
                        <span className="mt-0.5 block text-[12.5px] text-muted">
                          {row.note}
                        </span>
                      ) : null}
                    </th>
                    {row.cells.map((cell, c) => (
                      <td
                        key={`${row.label}-${c}`}
                        className={`border-t border-line px-4 py-3.5 text-center align-middle ${
                          c === 0 ? "bg-accent-soft/45" : ""
                        }`}
                      >
                        <CellValue value={cell} highlight={c === 0} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <p className="mt-6 text-center text-[13.5px] text-muted">
            Slack does things Freeflow deliberately does not, including Canvas, huddles,
            BlockKit, message search.{" "}
            <a href="#faq" className="text-accent hover:text-accent-hover">
              We list every one of them below.
            </a>
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
