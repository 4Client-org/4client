FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

# Own everything as the built-in non-root `node` user (present in the official
# image) BEFORE switching to it - the build steps above still need root (apt,
# corepack), but the running container (handling untrusted webhook/PDF/upload input)
# never should. Covers apps/api/uploads too, created at runtime as a local fallback
# when R2 isn't configured - it inherits node's ownership since the whole tree does.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["sh", "/app/start.sh"]
