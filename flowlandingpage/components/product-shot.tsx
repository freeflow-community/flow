import Image from "next/image";
import { AppMock } from "@/components/app-mock";

/**
 * The hero visual.
 *
 * TO USE A REAL SCREENSHOT:
 *   1. Drop the file at /public/screenshot.png (2x, ~2400px wide, light UI)
 *   2. Set SCREENSHOT below to "/screenshot.png"
 * Until then this renders the built mock, which is real DOM and stays sharp.
 */
const SCREENSHOT: string | null = null;

export function ProductShot() {
  if (!SCREENSHOT) return <AppMock />;

  return (
    <div className="overflow-hidden rounded-surface border border-line-strong bg-paper shadow-[0_28px_70px_-24px_rgba(11,12,16,0.32)]">
      <Image
        src={SCREENSHOT}
        alt="The Freeflow client: channels, threads, and an agent replying in #engineering"
        width={2400}
        height={1500}
        priority
        className="h-auto w-full"
      />
    </div>
  );
}
