# Build frontend
FROM node:20-alpine AS frontend-builder

# Mirror repo structure so tsconfig extends path resolves correctly
# web tsconfig extends ../../tsconfig.base.json
WORKDIR /repo
COPY tsconfig.base.json ./

WORKDIR /repo/apps/web
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts ./
RUN npm install
COPY apps/web/src/ ./src/
COPY apps/web/index.html ./

# When served from same origin, API_BASE is empty
ENV VITE_API_URL=""
RUN npm run build

# Run API + serve frontend static assets
# Must use full node image (not Alpine) — workerd needs glibc
FROM node:20-slim

WORKDIR /app

# Install API dependencies
COPY apps/api/package.json ./
RUN npm install

# Copy API source
COPY apps/api/src/ ./src/
COPY apps/api/wrangler.toml ./
COPY apps/api/schema.sql ./

# Copy frontend build output for static serving
COPY --from=frontend-builder /repo/apps/web/dist ./public/

RUN mkdir -p .wrangler

EXPOSE 8788

CMD sh -c "npx wrangler d1 execute eigen-db --local --file=schema.sql && npx wrangler dev --port 8788 --ip 0.0.0.0 --assets ./public"
