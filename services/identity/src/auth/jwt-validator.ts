import crypto from 'node:crypto';
import { z } from 'zod';
import { PrincipalType } from '../domain/types.js';

export const JWTHeaderSchema = z.object({
  alg: z.enum(['HS256', 'RS256']),
  typ: z.literal('JWT').optional(),
});

export const JWTPayloadSchema = z.object({
  iss: z.string().url(),
  aud: z.string(),
  sub: z.string().min(1),
  tenant_id: z.string().uuid(),
  principal_type: z.nativeEnum(PrincipalType),
  exp: z.number().int().positive(),
  nbf: z.number().int().positive().optional(),
  iat: z.number().int().positive().optional(),
  email: z.string().email().optional(),
  roles: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  service_name: z.string().optional(),
  hardware_fingerprint: z.string().optional(),
});

export type JWTPayload = z.infer<typeof JWTPayloadSchema>;

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

export function base64UrlEncode(str: string | Buffer): string {
  const buf = typeof str === 'string' ? Buffer.from(str) : str;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export interface JWTVerifyOptions {
  issuer: string;
  audience: string;
  secretKey: string;
  clockToleranceSeconds?: number;
}

export function verifyJWT(token: string, options: JWTVerifyOptions): JWTPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('MALFORMED_JWT: Token must consist of 3 dot-separated parts.');
  }

  const [rawHeader, rawPayload, rawSignature] = parts;

  // 1. Decode & validate header
  let headerObj: unknown;
  try {
    headerObj = JSON.parse(base64UrlDecode(rawHeader));
  } catch {
    throw new Error('MALFORMED_JWT: Header is not valid JSON.');
  }
  const header = JWTHeaderSchema.parse(headerObj);

  // 2. Signature verification (HS256)
  if (header.alg === 'HS256') {
    const expectedSig = crypto
      .createHmac('sha256', options.secretKey)
      .update(`${rawHeader}.${rawPayload}`)
      .digest();
    const expectedBase64UrlSig = base64UrlEncode(expectedSig);

    if (!crypto.timingSafeEqual(Buffer.from(rawSignature), Buffer.from(expectedBase64UrlSig))) {
      throw new Error('INVALID_SIGNATURE: JWT signature verification failed.');
    }
  } else {
    throw new Error(
      `UNSUPPORTED_ALGORITHM: Algorithm ${header.alg} is not supported in foundation mode.`,
    );
  }

  // 3. Decode & validate payload claims
  let payloadObj: unknown;
  try {
    payloadObj = JSON.parse(base64UrlDecode(rawPayload));
  } catch {
    throw new Error('MALFORMED_JWT: Payload is not valid JSON.');
  }

  const payload = JWTPayloadSchema.parse(payloadObj);

  // 4. Validate Issuer and Audience
  if (payload.iss !== options.issuer) {
    throw new Error(
      `ISSUER_MISMATCH: Token issuer '${payload.iss}' does not match expected '${options.issuer}'.`,
    );
  }

  if (payload.aud !== options.audience) {
    throw new Error(
      `AUDIENCE_MISMATCH: Token audience '${payload.aud}' does not match expected '${options.audience}'.`,
    );
  }

  // 5. Expiration & Not Before Checks
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSeconds || 0;

  if (payload.exp + tolerance < nowSeconds) {
    throw new Error('TOKEN_EXPIRED: Token expiration date has passed.');
  }

  if (payload.nbf && payload.nbf - tolerance > nowSeconds) {
    throw new Error('TOKEN_NOT_YET_VALID: Token not valid before specified timestamp.');
  }

  return payload;
}
