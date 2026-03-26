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

# Git is needed for project commits/reverts
RUN apk add --no-cache git

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

# Projects directory — mount as volume for persistence
RUN mkdir -p /data/projects && chown eigen:eigen /data/projects
VOLUME /data/projects

# Switch to non-root user
USER eigen

# Configure git for the non-root user
RUN git config --global user.email "eigen@local" && \
    git config --global user.name "Eigen Agent"

ENV PORT=8787
ENV PROJECTS_DIR=/data/projects
ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "dist/index.js"]
