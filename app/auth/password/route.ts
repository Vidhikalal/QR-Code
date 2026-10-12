import { codeSignInRoute } from '@/lib/auth/code-signin-route';

// Dev only (FEATURE_PASSWORD_LOGIN): staff sign-in with a password, e.g. the local admin account.
export const POST = codeSignInRoute('passwordSignIn');
