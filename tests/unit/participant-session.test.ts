import { describe, expect, it } from 'vitest';
import { isInAppBrowser } from '@/lib/participant/in-app-browser';
import {
  clearParticipantCookie,
  participantCookieName,
  readSessionValue,
  serializeParticipantCookie,
} from '@/lib/participant/session';
import { generateSecret } from '@/lib/domain/token';

const UA = {
  gmailIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/330.0.0 Gmail/6.0.240901',
  outlookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Outlook-iOS/4.2437.0',
  outlookAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 PKeyAuth/1.0 Outlook-Android/2.0',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0 (iPhone15,2; iOS 18_0; en_CA)',
  linkedin: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1',
  facebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1;FBDV/iPhone15,2]',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

describe('in-app browser detection (PLAN F17.3)', () => {
  it('T-SESS-10: embedded browsers are detected; real browsers are not', () => {
    for (const k of ['gmailIos', 'outlookIos', 'outlookAndroid', 'instagram', 'linkedin', 'facebook', 'androidWebView'] as const) {
      expect(isInAppBrowser(UA[k]), k).not.toBeNull();
    }
    for (const k of ['safari', 'chromeAndroid', 'chromeIos', 'desktopChrome'] as const) expect(isInAppBrowser(UA[k]), k).toBeNull();
    expect(isInAppBrowser(null)).toBeNull();
    expect(isInAppBrowser(UA.gmailIos)).toBe('Gmail');
  });
});

describe('participant cookie (PLAN §5.2)', () => {
  it('T-SESS-05: http → pl_me without Secure; https → __Host-pl_me with Secure; never a Domain', () => {
    const v = generateSecret();
    expect(participantCookieName('http://localhost:3000')).toBe('pl_me');
    expect(participantCookieName('https://me.example.com')).toBe('__Host-pl_me');
    expect(serializeParticipantCookie(v, 'http://localhost:3000', 30)).toBe(`pl_me=${v}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    expect(serializeParticipantCookie(v, 'https://me.example.com', 1)).toBe(`__Host-pl_me=${v}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`);
    expect(clearParticipantCookie('https://me.example.com')).toBe('__Host-pl_me=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
  });

  it('T-SESS-05: reads only our cookie, and only a well-formed value', () => {
    const v = generateSecret();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readSessionValue(`a=1; pl_me=${v}; b=2`, 'http://localhost:3000')).toBe(v);
    expect(readSessionValue(`pl_me=${v}`, 'https://me.example.com')).toBeNull();
    expect(readSessionValue('pl_me=short', 'http://localhost:3000')).toBeNull();
    expect(readSessionValue(null, 'http://localhost:3000')).toBeNull();
  });
});
