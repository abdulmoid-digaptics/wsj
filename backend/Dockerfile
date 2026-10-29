# Build/release tooling stage. Migration execution is an explicitly approved release step.
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN ./node_modules/.bin/prisma generate && npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/app/uploads
WORKDIR /app
RUN apk add --no-cache openssl     && mkdir -p /app/uploads     && chown node:node /app/uploads
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3     CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# No schema changes, seeds or network installs on application startup.
CMD ["node", "dist/main.js"]
