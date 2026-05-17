import { createHmac, timingSafeEqual } from 'crypto';

export interface JwtPayload {
  sub: string;
  role: 'rider' | 'driver' | 'admin';
  exp?: number;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const [rawHeader, rawPayload, rawSignature] = token.split('.');
  if (!rawHeader || !rawPayload || !rawSignature) throw new Error('malformed jwt');

  const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8')) as {
    alg?: string;
  };
  if (header.alg !== 'HS256') throw new Error('unsupported jwt algorithm');

  const expected = createHmac('sha256', secret)
    .update(`${rawHeader}.${rawPayload}`)
    .digest('base64url');
  const provided = Buffer.from(rawSignature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    throw new Error('bad signature');
  }

  const payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8')) as JwtPayload;
  if (!payload.sub || !payload.role) throw new Error('missing claims');
  if (payload.exp && payload.exp * 1000 <= Date.now()) throw new Error('jwt expired');
  return payload;
}
