import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeWalkingResponse, validateWalkingPayload, verifySignature } from './walking.js';

describe('walking integration validation', () => {
  const payload = { origins: [{ lat: 48.2, lng: 16.3 }], destinations: [{ lat: 48.21, lng: 16.31 }] };

  it('bounds destinations and rejects invalid coordinates before provider work', () => {
    expect(validateWalkingPayload(payload)).toBe(true);
    expect(validateWalkingPayload({ ...payload, destinations: Array(26).fill(payload.destinations[0]) })).toBe(false);
    expect(validateWalkingPayload({ ...payload, origins: [{ lat: Infinity, lng: 16.3 }] })).toBe(false);
    expect(validateWalkingPayload({ ...payload, origins: [{ lat: '48.2', lng: 16.3 }] })).toBe(false);
  });

  it('checks timestamp, body and signature and safely rejects malformed hex', () => {
    const timestamp = '1700000000';
    const signature = createHmac('sha256', 'test-key').update(timestamp + '.' + JSON.stringify(payload)).digest('hex');
    expect(verifySignature('test-key', payload, timestamp, signature, 1700000000000)).toBe(true);
    expect(verifySignature('test-key', payload, timestamp, signature, 1700000301000)).toBe(false);
    expect(verifySignature('test-key', payload, timestamp, 'wrong', 1700000000000)).toBe(false);
    expect(verifySignature('wrong-key', payload, timestamp, signature, 1700000000000)).toBe(false);
  });

  it('preserves successful elements alongside route failures and rejects malformed envelopes', () => {
    const matrix = normalizeWalkingResponse({ status: 'OK', rows: [{ elements: [
      { status: 'OK', duration: { value: 120 } }, { status: 'ZERO_RESULTS' }, { status: 'OK', duration: { value: -1 } },
    ] }] }, 3);
    expect(matrix.rows[0].elements).toEqual([
      { status: 'OK', duration: { value: 120 } }, { status: 'ZERO_RESULTS' }, { status: 'UNKNOWN_ERROR' },
    ]);
    expect(() => normalizeWalkingResponse({ status: 'REQUEST_DENIED' }, 1)).toThrow();
    expect(() => normalizeWalkingResponse({ status: 'OK', rows: [{ elements: [] }] }, 1)).toThrow();
  });
});
