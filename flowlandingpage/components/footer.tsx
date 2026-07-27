import Link from "next/link";
import { links, site } from "@/site.config";
import { Container } from "@/components/ui";
import { Github, Logo } from "@/components/icons";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-paper">
      <Container className="py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo className="size-7 text-ink" />
            <span className="text-[17px] font-semibold tracking-tight text-ink">
              Freeflow
            </span>
          </Link>

          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-7 gap-y-3">
            <a
              href={links.github}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 text-[15px] text-body transition-colors hover:text-ink"
            >
              <Github className="size-[17px]" />
              GitHub
            </a>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13.5px] text-muted">
            © {year} {site.name}. Free and open source.
          </p>
          <p className="text-[13.5px] text-muted">
            An independent project. Not affiliated with Slack Technologies or
            Discord Inc.
          </p>
        </div>
      </Container>
    </footer>
  );
}
