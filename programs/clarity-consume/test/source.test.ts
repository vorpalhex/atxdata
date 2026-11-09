import { test, expect } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { token, decode, catalog } from '../src/source';

test('source tokens are literal digits; gzip retains distinct encoded and decoded identities', () => {
  expect(token('00367565')).toBe('00367565');
  for (const bad of ['367565\n', '../367565', '1e3', '', '１２']) expect(() => token(bad)).toThrow();
  const raw = gzipSync(Buffer.from('[]'));
  const value = decode(raw, 'gzip');
  expect(value.bytes.toString()).toBe('[]');
  expect(value.encodedHash).not.toBe(value.decodedHash);
  expect(() => decode(gzipSync(Buffer.alloc(100001)), 'gzip', 100000)).toThrow();
  const entry = { State:'TX', StateId:'9', County:'Travis', CountyId:'1239', EID:'125662', ElectionName:'test', Date:'12/13/2025' };
  expect(catalog([entry])[0].EID).toBe('125662');
  expect(() => catalog([entry,entry])).toThrow();
  expect(() => catalog([{...entry,EID:125662}])).toThrow();
});
