import { describe, expect, it } from 'vitest';
import {
  AGENT_INFERENCE_TOKEN_TTL_SECONDS,
  mintAgentInferenceToken,
} from '../src/services/huddleInference.js';

describe('agent Huddle inference token', () => {
  it('contains only a short-lived inference grant', async () => {
    const token = await mintAgentInferenceToken(
      'test-key',
      'test-secret-at-least-32-bytes-long',
      'agent-user-id',
    );
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
      sub: string;
      inference: { perform: boolean };
      video?: unknown;
      sip?: unknown;
      nbf: number;
      exp: number;
    };

    expect(claims.sub).toBe('flow-agent-agent-user-id');
    expect(claims.inference).toEqual({ perform: true });
    expect(claims.video).toBeUndefined();
    expect(claims.sip).toBeUndefined();
    expect(claims.exp - claims.nbf).toBe(AGENT_INFERENCE_TOKEN_TTL_SECONDS);
  });
});
