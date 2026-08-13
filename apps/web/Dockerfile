FROM node:20-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global corepack@0.34.0 \
    && corepack enable \
    && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
# Browser PDF rendering does not require pdfjs-dist's optional native canvas.
# Disabling lifecycle scripts prevents its legacy node-pre-gyp/tar chain from
# executing during the release build while the supported PDF.js migration is pending.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS builder

COPY . .
ARG API_INTERNAL_URL=http://chat-reader-api:8000
ARG COMPLEX_ATTACHMENT_PREVIEW_ENABLED=false
ARG ATTACHMENT_PREVIEW_ORIGIN=
ARG WEB_BUILD_HEAP_MB=1536
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_PUBLIC_COMPLEX_ATTACHMENT_PREVIEW_ENABLED=$COMPLEX_ATTACHMENT_PREVIEW_ENABLED
ENV NEXT_PUBLIC_ATTACHMENT_PREVIEW_ORIGIN=$ATTACHMENT_PREVIEW_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_STANDALONE=1
ENV NODE_OPTIONS="--max-old-space-size=${WEB_BUILD_HEAP_MB}"
ENV NEXT_BUILD_CPUS=1
RUN pnpm --filter web build

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
