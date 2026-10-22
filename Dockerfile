# Production image for Coolify (Dockerfile build pack). Single stage: the simplest build that works.
FROM node:24-bookworm-slim
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

# Public values only: inlined into the client bundle, and the Supabase URL into the CSP header
# (next.config.ts). Server secrets (service-role key, Resend key) are runtime env, never build args.
ARG NEXT_PUBLIC_APP_ORIGIN
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN pnpm build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["pnpm", "start"]
