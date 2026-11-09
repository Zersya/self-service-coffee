import { createHash, timingSafeEqual } from 'node:crypto';

export function verifyPkceS256(
  codeVerifier: string | undefined,
  codeChallenge: string | undefined,
): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const digest = createHash('sha256').update(codeVerifier).digest('base64url');
  try {
    const expected = Buffer.from(codeChallenge, 'utf8');
    const actual = Buffer.from(digest, 'utf8');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
