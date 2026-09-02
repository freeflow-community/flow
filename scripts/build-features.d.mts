// Types for the FEATURES.md generator, which is plain ESM so that any tool in
// the repo can run it without a build step. The server imports `buildFeatures`
// to serve the "What's New" help page (#474); the tests import it to assert
// the page and the build version menu really are the same text.
export declare function buildFeatures(root?: string): { markdown: string; summary: string };
