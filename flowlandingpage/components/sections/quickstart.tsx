import { links } from "@/site.config";
import { Reveal } from "@/components/reveal";
import {
  Button,
  Code,
  Container,
  Section,
  SectionHeading,
  TerminalPanel,
  TextLink,
} from "@/components/ui";
import { Apple, ArrowRight, Github } from "@/components/icons";

export function Quickstart() {
  return (
    <Section id="quickstart" tone="mist">
      <Container>
        <Reveal>
          <SectionHeading
            lead="Stop reading."
            title={
              <>
                It runs in about{" "}
                <em className="serif-accent text-accent">four</em> minutes.
              </>
            }
            body="Node 22+, pnpm 10, and Docker. One process serves the API, the WebSocket gateway, and the web client at 127.0.0.1:8787."
          />
        </Reveal>

        <div className="mt-14 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <Reveal>
            <TerminalPanel
              caption="freeflow · bash"
              commands={[
                {
                  note: "1. Infrastructure: Postgres on 5442, plus NATS",
                  cmd: "cd packages/infra && docker compose up -d",
                },
                {
                  note: "2. Install and build the monorepo",
                  cmd: "pnpm install && pnpm build",
                },
                {
                  note: "3. Migrate and run — API, WebSocket, and web client",
                  cmd: "cd packages/server && pnpm migrate && pnpm dev",
                },
              ]}
            />
            <p className="mt-4 text-[13.5px] text-body">
              Open <Code>http://127.0.0.1:8787</Code> and you are in. Rebuild{" "}
              <Code>packages/web/dist</Code> and restart the server to pick up
              web changes.
            </p>
          </Reveal>

          <div className="flex flex-col gap-5">
            <Reveal delay={100}>
              <div className="rounded-panel border border-line bg-paper p-6">
                <div className="flex items-center gap-2.5">
                  <Apple className="size-[18px] text-ink" />
                  <h3 className="text-[1rem] font-semibold">
                    Then the native client
                  </h3>
                </div>
                <div className="mt-4 rounded-[10px] border border-line bg-mist px-4 py-3 font-mono text-[12.5px] leading-[1.9] text-ink">
                  <div>
                    <span className="text-free select-none">$ </span>cd
                    apps/macos
                  </div>
                  <div>
                    <span className="text-free select-none">$ </span>swift run
                    Freeflow
                  </div>
                  <div>
                    <span className="text-free select-none">$ </span>
                    tools/make-app.sh
                  </div>
                </div>
                <p className="mt-3.5 text-[14px] leading-relaxed text-body">
                  Or open <Code>Package.swift</Code> in Xcode. The packaging
                  script produces <Code>dist/Freeflow.app</Code> and registers{" "}
                  <Code>freeflow://</Code> links so invites open the desktop app.
                </p>
                <div className="mt-4">
                  <TextLink href={links.macosReadme} external>
                    macOS client notes
                  </TextLink>
                </div>
              </div>
            </Reveal>

            <Reveal delay={180}>
              <div className="rounded-panel border border-line bg-paper p-6">
                <h3 className="text-[1rem] font-semibold">
                  Then put it somewhere real
                </h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-body">
                  One box with Postgres and NATS runs a few hundred people
                  comfortably. The deployment doc covers topology, backups, key
                  management, and the 3am runbooks.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2">
                  <TextLink href={links.selfHost}>Self-hosting guide</TextLink>
                  <TextLink href={links.deployment} external>
                    Production runbooks
                  </TextLink>
                </div>
              </div>
            </Reveal>
          </div>
        </div>

        <Reveal delay={240}>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              href={links.github}
              size="lg"
              external
              icon={<Github className="size-[18px]" />}
            >
              Clone the repo
            </Button>
            <Button
              href={links.selfHost}
              variant="secondary"
              size="lg"
              icon={<ArrowRight className="size-[18px]" />}
            >
              Read the self-host guide
            </Button>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
