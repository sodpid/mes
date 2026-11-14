FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps apps
COPY scripts/migrate.ts scripts/migrate.ts
RUN npm run build && npx tsc scripts/migrate.ts --outDir build-tools --rootDir . --module NodeNext --target ES2022 --esModuleInterop --skipLibCheck

FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@mes/api --include-workspace-root --no-audit --no-fund

FROM public.ecr.aws/docker/library/node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 API_PORT=3001 NODE_OPTIONS=--max-old-space-size=160
WORKDIR /app
COPY --from=dependencies /app/node_modules node_modules
COPY --from=dependencies /app/apps/api/package.json apps/api/package.json
COPY package.json package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/build-tools/scripts/migrate.js scripts/migrate.js
COPY --from=build /app/build-tools/apps/api/src/db.js apps/api/src/db.js
COPY db/mysql db/mysql
COPY deploy/data.mjs deploy/data.mjs
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","apps/api/dist/server.js"]
