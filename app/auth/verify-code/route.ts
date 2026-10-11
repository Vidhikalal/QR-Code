import { codeSignInRoute } from '@/lib/auth/code-signin-route';

// Staff sign-in: exchange the emailed 6-digit code for a session cookie.
export const POST = codeSignInRoute('verifyCode');
