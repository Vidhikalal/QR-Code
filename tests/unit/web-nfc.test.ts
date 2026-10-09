import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeReading, nfcErrorKind } from '@/lib/nfc/web-nfc';

const enc = new TextEncoder();
const url = (u: string) => ({ recordType: 'url', data: new DataView(enc.encode(u).buffer) });

describe('Web NFC reading (PLAN §11.2)', () => {
  it('normalizes the serial and returns the first URL record', () => {
    expect(decodeReading({ serialNumber: '04:a2:3b:4c:5d:6e:7f', message: { records: [{ recordType: 'text', data: new DataView(enc.encode('hi').buffer) }, url('https://me.test/t/AAAAAAAAAAAA'), url('https://x')] } })).toEqual({
      uid: '04A23B4C5D6E7F',
      url: 'https://me.test/t/AAAAAAAAAAAA',
    });
  });

  it('a blank tag gives a uid and no URL; an unreadable serial gives null', () => {
    expect(decodeReading({ serialNumber: '04:a2:3b:4c:5d:6e:7f', message: { records: [] } })).toEqual({ uid: '04A23B4C5D6E7F', url: null });
    expect(decodeReading({ serialNumber: '', message: { records: [url('https://me.test/t/AAAAAAAAAAAA')] } })).toEqual({ uid: null, url: 'https://me.test/t/AAAAAAAAAAAA' });
  });

  it('maps DOMException names to our error kinds', () => {
    expect(nfcErrorKind(new DOMException('x', 'NotAllowedError'))).toBe('permission-denied');
    expect(nfcErrorKind(new DOMException('x', 'NotSupportedError'))).toBe('unsupported');
    expect(nfcErrorKind(new DOMException('x', 'AbortError'))).toBe('aborted');
    expect(nfcErrorKind(new DOMException('x', 'NetworkError'))).toBe('write-failed');
    expect(nfcErrorKind(new Error('?'))).toBe('write-failed');
  });

  it('D5: never makes a tag permanently read-only', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'nfc', 'web-nfc.ts'), 'utf8');
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/makeReadOnly/);
  });
});
