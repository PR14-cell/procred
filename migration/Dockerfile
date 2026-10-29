FROM node:24-alpine

RUN apk add --no-cache openssl libc6-compat
WORKDIR /migration

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && ./node_modules/.bin/prisma --version
COPY prisma ./prisma

ENV NODE_ENV=production
ENTRYPOINT ["npx", "--no-install", "prisma", "migrate", "deploy"]