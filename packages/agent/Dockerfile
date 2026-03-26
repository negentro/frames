# Build stage — context is repo root
FROM node:20-alpine AS builder

WORKDIR /app

# Copy tsconfig base from repo root
COPY tsconfig.base.json ./

# Copy agent package
COPY packages/agent/package.json packages/agent/tsconfig.json ./packages/agent/
WORKDIR /app/packages/agent
RUN npm install

COPY packages/agent/src/ ./src/
RUN npm run build

# Runtime stage
FROM node:20-alpine

# Git for commits/reverts, zip/unzip for R2 project storage
RUN apk add --no-cache git zip unzip

# Create non-root user
RUN addgroup -S eigen && adduser -S eigen -G eigen

WORKDIR /app

# Production dependencies
COPY --from=builder /app/packages/agent/package.json ./
RUN npm install --omit=dev

# Built application
COPY --from=builder /app/packages/agent/dist ./dist

# Runtime config and templates
COPY packages/agent/bash-permissions.json ./
COPY packages/agent/src/templates ./dist/templates

# Ephemeral projects directory — state is persisted to R2
RUN mkdir -p /tmp/eigen-projects && chown eigen:eigen /tmp/eigen-projects

# Switch to non-root user
USER eigen

# Configure git for the non-root user
RUN git config --global user.email "eigen@local" && \
    git config --global user.name "Eigen Agent"

ENV PORT=8787
ENV PROJECTS_DIR=/tmp/eigen-projects
ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "dist/index.js"]
