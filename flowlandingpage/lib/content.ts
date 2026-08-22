/**
 * All list-shaped copy for the site. Editing text here never touches JSX.
 *
 * Copy rule: cards get ONE sentence. If an idea needs a paragraph, it needs a
 * diagram instead. Nothing here is invented — every claim maps to something in
 * the repo (docs/specs/overview.md, CHANGELOG.md).
 */

export type IconName =
  | "message"
  | "users"
  | "lock"
  | "bolt"
  | "code"
  | "layers"
  | "shield"
  | "server"
  | "globe"
  | "apple"
  | "sparkle"
  | "box"
  | "terminal"
  | "hash";

/* -------------------------------------------------------------------------- */
/*  Problem                                                                    */
/* -------------------------------------------------------------------------- */

export const problems = [
  {
    icon: "users" as IconName,
    title: "The bill grows with the team",
    body: "Every hire raises the invoice before they raise revenue.",
  },
  {
    icon: "message" as IconName,
    title: "Your history sits behind a paywall",
    body: "The decision you made 18 months ago is in there. You just can't read it.",
  },
  {
    icon: "lock" as IconName,
    title: "Your bots hit someone else's ceiling",
    body: "Rate limits, app review, permissions you can't grant.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/*  How it works                                                               */
/* -------------------------------------------------------------------------- */

export const steps = [
  {
    n: "01",
    title: "Run one command",
    body: "Docker brings up Postgres and NATS. One process serves the API, the socket, and the web client.",
  },
  {
    n: "02",
    title: "Invite your team",
    body: "Share a freeflow:// link. They open the web client, or install the native macOS app.",
  },
  {
    n: "03",
    title: "Add your agents",
    body: "Describe what one should do and point it at a repo. It shows up as a member.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/*  Free forever                                                               */
/* -------------------------------------------------------------------------- */

export const freeFacts = [
  {
    icon: "shield" as IconName,
    title: "MIT, not source-available",
    body: "Fork it, ship it, sell what you build on it.",
  },
  {
    icon: "users" as IconName,
    title: "Seats aren't a unit we count",
    body: "Ten people or ten thousand. There's nobody to bill.",
  },
  {
    icon: "message" as IconName,
    title: "Every message, kept",
    body: "No 90-day wall. Your Postgres, your history.",
  },
  {
    icon: "box" as IconName,
    title: "No tier above this one",
    body: "No Pro, no Business+, no Enterprise Grid.",
  },
  {
    icon: "lock" as IconName,
    title: "Nothing leaves your servers",
    body: "No telemetry. No analytics beacon. No vendor copy.",
  },
  {
    icon: "code" as IconName,
    title: "Check it yourself",
    body: "Every claim on this page is greppable.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/*  Features — bullets do the talking, no paragraphs                           */
/* -------------------------------------------------------------------------- */

export const featureGroups = [
  {
    icon: "message" as IconName,
    title: "Core messaging",
    points: [
      "Public and private channels",
      "Threads and replies",
      "Unread tracking",
      "Presence and typing",
    ],
  },
  {
    icon: "users" as IconName,
    title: "Direct messages",
    points: [
      "1:1 direct messages",
      "Private group DMs",
      "Persistent self-DM",
      "Multiple workspaces",
    ],
  },
  {
    icon: "bolt" as IconName,
    title: "Rich composing",
    points: [
      "Live Markdown as you type",
      "Enterable code-block editor",
      "Emoji shortcodes and reactions",
      "@user · @channel · @here",
    ],
  },
  {
    icon: "lock" as IconName,
    title: "Files, encrypted",
    points: [
      "AES-256-GCM on your disk",
      "Drag, drop, or paste",
      "Image lightbox and GIFs",
      "In-app PDF reader",
    ],
  },
  {
    icon: "sparkle" as IconName,
    title: "Agents, built in",
    points: [
      "Agents as channel members",
      "They read the thread they're in",
      "Run against your repos",
      "Scoped and revocable",
    ],
  },
  {
    icon: "apple" as IconName,
    title: "Two clients, one feature set",
    points: [
      "Native macOS, offline-capable",
      "React 19 web client",
      "Keychain sessions",
      "freeflow:// deep links",
    ],
  },
] as const;

/* -------------------------------------------------------------------------- */
/*  Architecture                                                               */
/* -------------------------------------------------------------------------- */

export const stackFacts = [
  { label: "Server", value: "Fastify 5 · Drizzle · Postgres 16 · NATS" },
  { label: "Web", value: "React 19 · Vite · Tailwind 4 · TanStack Query" },
  { label: "Native", value: "SwiftUI · Swift 6 · GRDB · macOS 14+" },
  { label: "Transport", value: "REST + WebSocket at /v1/ws" },
  { label: "At rest", value: "Encrypted messages · AES-256-GCM blobs" },
  { label: "Runtime", value: "Node 22+ · pnpm 10 · Docker" },
];

export const treeLines = [
  "packages/",
  "  server/   Fastify 5 + Drizzle + Postgres 16 + NATS",
  "            REST, WebSocket gateway, Slack-compat API",
  "  web/      React 19 + Vite + Tailwind 4",
  "  shared/   Zod schemas shared server <-> web",
  "  infra/    docker-compose: Postgres (5442), NATS",
  "apps/",
  "  macos/    SwiftUI, offline-capable, GRDB cache,",
  "            Keychain sessions, freeflow:// deep links",
];

/* -------------------------------------------------------------------------- */
/*  Comparison                                                                 */
/* -------------------------------------------------------------------------- */

export type Cell = "yes" | "no" | "partial" | string;

export const compareColumns = [
  "Freeflow",
  "Slack Free",
  "Slack Pro",
  "Discord",
] as const;

export const compareRows: { label: string; note?: string; cells: Cell[] }[] = [
  { label: "Cost per user", cells: ["$0", "$0", "paid seat", "$0"] },
  {
    label: "Message history",
    cells: ["Unlimited", "90 days", "Unlimited", "Unlimited"],
  },
  { label: "Run it on your own servers", cells: ["yes", "no", "no", "no"] },
  { label: "Source code you can read", cells: ["yes", "no", "no", "no"] },
  { label: "Fork and modify it", cells: ["yes", "no", "no", "no"] },
  { label: "Messages encrypted in your DB", cells: ["yes", "no", "no", "no"] },
  { label: "Native desktop client", cells: ["macOS", "yes", "yes", "yes"] },
  { label: "Agents built into the platform", cells: ["yes", "no", "no", "no"] },
  {
    label: "Agents that review PRs and deploy",
    cells: ["yes", "partial", "partial", "partial"],
  },
  {
    label: "Your conversations stay on your servers",
    cells: ["yes", "no", "no", "no"],
  },
  { label: "Vendor can change the terms", cells: ["no", "yes", "yes", "yes"] },
];

/* -------------------------------------------------------------------------- */
/*  Non-goals — stated plainly, because pretending is worse                     */
/* -------------------------------------------------------------------------- */

export const nonGoals = [
  { label: "Canvas", note: "Use a doc tool you like." },
  { label: "BlockKit", note: "Agents post Markdown." },
  { label: "Huddles, audio, video", note: "Not a calls product." },
  { label: "Message search", note: "On the roadmap." },
  { label: "Drafts", note: "Not shipped." },
  { label: "External / guest orgs", note: "Single-tenant by design." },
];

/* -------------------------------------------------------------------------- */
/*  FAQ                                                                        */
/* -------------------------------------------------------------------------- */

export const faqs = [
  {
    q: "What is the catch?",
    a: "You run it. Freeflow gives you the server, both clients, and the deployment docs — you bring a box and a Postgres. If you would rather someone else own uptime at 3am, pay for a hosted product. Freeflow is for teams who would rather own it.",
  },
  {
    q: "Do I need to write code to get an agent?",
    a: "No. Describe what it should do, point it at a repo, and give it a channel — the agent runtime is part of Freeflow, not something you install. Code is the escape hatch when you want custom tools, not the price of entry.",
  },
  {
    q: "Which model runs the agents?",
    a: "Yours. Freeflow ships the runtime — the seat in the channel, the thread context, the tool calls, the permission model. You point it at whichever provider or self-hosted model you already trust, and swap it without rewriting your agents.",
  },
  {
    q: "Can an agent really merge my pull requests?",
    a: "It can, and whether it should is your call. You scope what an agent can touch when you create it — repos, commands, channels — and revoke any of it in a click. Most teams start read-only, then hand over the merge button for a narrow case once they trust it. Every action lands in the transcript.",
  },
  {
    q: "How are messages and files protected?",
    a: "Messages are encrypted at rest in Postgres. File blobs use AES-256-GCM on disk. macOS sessions live in the Keychain, and the web-to-app handoff uses a single-use code so raw tokens never travel in a URL.",
  },
  {
    q: "What does Freeflow deliberately not do?",
    a: "Canvas, BlockKit, video calls, message search, drafts, and guest orgs. These are ruled non-goals written down in the spec, not oversights. Search is the one most teams ask for. (Audio-only voice huddles shipped — video/screenshare didn't.)",
  },
  {
    q: "Windows, Linux, iOS?",
    a: "The web client runs everywhere and is served by the API server itself, so every platform works today. The native client is macOS 14+. An iOS design doc exists; a Windows client is what a fork is for.",
  },
  {
    q: "Can I migrate without losing everything?",
    a: "That is what the migration agents do. Point one at a Slack export or Discord guild and it rebuilds channels, threads, DMs, files, and emoji with authors and timestamps intact. It is idempotent, so you can rehearse.",
  },
  {
    q: "How stable is this, honestly?",
    a: "Phases 1–6 are complete and every feature ships on both clients or gets a written entry in the parity ledger. The changelog is public — read it before you trust it with your team.",
  },
];
