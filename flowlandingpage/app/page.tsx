import { site } from "@/site.config";
import { Hero } from "@/components/sections/hero";
import {
  BeforeAfter,
  Benefits,
  HowItWorksStory,
  OpenSourceBand,
} from "@/components/sections/collaboration-story";
import { FinalCta } from "@/components/sections/final-cta";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: site.name,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "macOS, Web",
  description: site.description,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free forever. Hosted or self-hosted.",
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <BeforeAfter />
      <HowItWorksStory />
      <Benefits />
      <OpenSourceBand />
      <FinalCta />
    </>
  );
}
