FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Kolkata
RUN apk add --no-cache tzdata && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
# Apply migrations, seed (idempotent), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && npm run start"]
