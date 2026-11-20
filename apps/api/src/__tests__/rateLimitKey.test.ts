// v1.59.1: rate limits count per signed-in person, else per address. They
// used to count per session id, which is new on every cookieless request.
import { describe, it, expect } from 'vitest';
import type express from 'express';
import { rateLimitKey } from '../server/app.js';

const req = (ip: string, userId?: string, sessionID = String(Math.random())) =>
  ({ ip, sessionID, session: userId ? { userId } : {} }) as unknown as express.Request;

describe('rateLimitKey', () => {
  it('signed out: the same address is one bucket, whatever the session id', () => {
    expect(rateLimitKey(req('203.0.113.7'))).toBe(rateLimitKey(req('203.0.113.7')));
    expect(rateLimitKey(req('203.0.113.7'))).not.toBe(rateLimitKey(req('203.0.113.8')));
  });

  it('signed in: one bucket per person, across addresses', () => {
    expect(rateLimitKey(req('203.0.113.7', 'u1'))).toBe(rateLimitKey(req('198.51.100.1', 'u1')));
    expect(rateLimitKey(req('203.0.113.7', 'u1'))).not.toBe(rateLimitKey(req('203.0.113.7', 'u2')));
  });

  it('IPv6 addresses in one /56 share a bucket', () => {
    expect(rateLimitKey(req('2001:db8:0:1::1'))).toBe(rateLimitKey(req('2001:db8:0:1::2')));
  });
});
