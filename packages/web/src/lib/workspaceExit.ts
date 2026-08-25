import type { WorkspaceMemberDTO } from '@flow/shared';

/**
 * Which way out of a workspace the menu offers (#340).
 *
 * - `leave` — anyone but the owner: just go.
 * - `transferFirst` — owner with company; leaving is refused until they hand
 *   the workspace over.
 * - `delete` — owner alone; nobody to hand it to, so ending it is the only way
 *   out.
 *
 * The same rule lives in `WorkspaceExit.swift` for macOS and iOS, and has to
 * agree with the server's delete guard — a client that decides differently
 * either hides a legitimate action or offers one the server will refuse.
 */
export type WorkspaceExit = 'leave' | 'transferFirst' | 'delete';

/**
 * `roster` is `undefined` while the member list is still loading, and that must
 * never read as "nobody else here": concluding it offered Delete on workspaces
 * full of people, which the server then refused with 409. `delete` is returned
 * only for a roster that positively contains `me`; anything less falls back to
 * a non-destructive answer.
 */
export function workspaceExit(
  role: string | undefined,
  roster: WorkspaceMemberDTO[] | undefined,
  me: string | undefined,
): WorkspaceExit {
  if (role !== 'owner') return 'leave';
  if (!roster || !me || !roster.some((m) => m.userId === me)) return 'transferFirst';
  const others = roster.some((m) => m.userId !== me && !m.isAgent && !m.isBot);
  return others ? 'transferFirst' : 'delete';
}
