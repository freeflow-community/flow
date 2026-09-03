// Sign in with Apple (native iOS flow). The app runs ASAuthorizationController
// and posts the resulting **identity token** (a signed JWT) here — same shape
// as the Google ID-token flow: no client secret, no redirect, no server-side
// exchange. jose verifies the signature against Apple's rotating JWKS (cached
// by createRemoteJWKSet), the issuer, the audience (the app's bundle id — what
// Apple uses as the client id for native apps) and the expiry.
//
// Apple quirks this file absorbs:
// - `email_verified` arrives as a boolean *or* the string "true".
// - The user's name is never in the token — Apple hands it to the client once,
//   on first authorization, so the client forwards it in the request body and
//   it only matters when the sign-in creates the account.
// - Private-relay addresses (@privaterelay.appleid.com) are real, verified,
//   routable emails; they need no special casing (no workspace can open domain
//   self-registration to the relay domain — it's not anyone's org domain).
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import type { OAuthSignInResponse } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { issueSession, toUserDTO } from './auth.js';
import { resolveOAuthUser, selfRegisterByDomain } from './oauthAccounts.js';

const { users } = schema;

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

/** The subset of the verified identity-token payload we act on. */
export interface AppleClaims {
  /** Apple's stable user id — the durable join key (survives an email change). */
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Forwarded by the client from the first authorization; not a token claim. */
  name?: string | undefined;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Verify an Apple identity token → its claims. Throws 503 when Sign in with
 * Apple is not configured and 401 when the token doesn't check out. */
export async function verifyAppleIdentityToken(identityToken: string, name?: string): Promise<AppleClaims> {
  const audience = config.appleBundleId;
  if (!audience) throw new ApiError(503, 'apple_disabled', 'Sign in with Apple is not configured on this server');
  jwks ??= createRemoteJWKSet(APPLE_JWKS_URL);
  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, jwks, { issuer: APPLE_ISSUER, audience }));
  } catch (err) {
    // The library's message describes the malformed JWT — useful in the log,
    // noise (and a fingerprinting hint) in the response.
    console.warn(`apple identity token rejected: ${(err as Error).message}`);
    throw new ApiError(401, 'apple_token_invalid', 'that Apple sign-in could not be verified');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email) {
    throw new ApiError(401, 'apple_token_invalid', 'Apple token carried no account');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name,
  };
}

/** Sign in (or register — with Apple they're the same act) and auto-enroll. */
export async function signInWithApple(
  identityToken: string,
  name?: string,
  clientInfo?: string,
): Promise<OAuthSignInResponse> {
  return signInWithAppleClaims(await verifyAppleIdentityToken(identityToken, name), clientInfo);
}

/**
 * Everything after verification. Split out so the whole flow is testable
 * without minting real Apple tokens (same seam as signInWithGoogleClaims).
 */
export async function signInWithAppleClaims(
  claims: AppleClaims,
  clientInfo?: string,
): Promise<OAuthSignInResponse> {
  // An unverified email proves nothing: it can neither link to an existing
  // Flow account nor satisfy the domain self-register rule.
  if (!claims.emailVerified) {
    throw new ApiError(403, 'email_unverified', 'your Apple email address is not verified');
  }
  const email = claims.email.toLowerCase();

  const userId = await resolveOAuthUser({
    provider: 'apple',
    sub: claims.sub,
    email,
    hostedDomain: null,
    name: claims.name,
  });
  const autoJoined = await selfRegisterByDomain(userId, email);

  const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row) throw new ApiError(500, 'internal', 'user vanished during sign-in');
  const token = await issueSession(userId, clientInfo);
  return { token, user: toUserDTO(row, row.id), autoJoined };
}
