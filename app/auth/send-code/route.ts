import { codeSignInRoute } from '@/lib/auth/code-signin-route';

// Staff sign-in: email the link and a 6-digit code (sent by the server, so phones can use it).
export const POST = codeSignInRoute('sendCode');
