# frames ⧉

wireframes to webframes

An agent-based frontend design tool that transforms wireframe images into working React + Tailwind CSS applications, with an iterative chat interface for refining the output.

## Run Instructions

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- ~25GB disk space for model downloads (first run only)

### Quick Start

```bash
docker compose up
```

This starts four services:

| Service | Port | Description |
|---------|------|-------------|
| **ollama** | 11434 | Local LLM server |
| **model-loader** | — | Pulls required models, then exits |
| **api** | 8788 | Frontend + API + R2/D1 storage |
| **agent** | 8787 | Agent server (code generation) |

Open **http://localhost:8788** once all services are healthy.

First run downloads `qwen2.5-coder:32b` (~20GB) and `qwen2.5vl` (~5GB). Subsequent starts use cached models.

### Local Development (without Docker)

```bash
# Terminal 1 — Ollama
ollama serve
ollama pull qwen2.5-coder:32b
ollama pull qwen2.5vl

# Terminal 2 — API server
cd apps/api
npm install
npx wrangler dev

# Terminal 3 — Agent server
cd packages/agent
cp .env.example .env  # edit as needed
npm install
npm run dev

# Terminal 4 — Frontend
cd apps/web
npm install
npm run dev
```

### Environment Variables (Agent)

| Variable | Default | Description |
|----------|---------|-------------|
| `EIGEN_MODEL` | `qwen2.5-coder:32b` | Coding model |
| `EIGEN_MAX_TURNS` | `15` | Max agent turns per request |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_VISION_MODEL` | `qwen2.5vl` | Vision model for wireframe analysis |
| `EIGEN_REQUEST_TIMEOUT_MS` | `600000` | Max wall-clock time per request (10 min) |
| `EIGEN_INTERNAL_API_KEY` | `eigen-local-dev-key` | Shared secret for agent→API auth |

## Service Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │     │  API Server  │     │    Ollama     │
│   (React)    │────▶│  (Hono/CF)   │     │  (LLM host)  │
│  port 8788   │     │  port 8788   │     │  port 11434  │
└──────────────┘     └──────┬───────┘     └──────▲───────┘
   served from              │                     │
   API container            │ D1/R2               │ LLM calls
                            │                     │
                     ┌──────▼───────┐             │
                     │ Agent Server │─────────────┘
                     │  port 8787   │
                     └──────────────┘
```

**Frontend** — React SPA served as static assets from the API server. Communicates with the API server for project CRUD/chat persistence and streams SSE directly from the agent server during generation.

**API Server** — Cloudflare Worker (via wrangler) with D1 (SQLite) for project/build/message storage and R2 (object storage) for build artifacts and project source backups. Serves the preview iframe content from R2.

**Agent Server** — Node.js server that runs the AI agent pipeline. Receives generation/iteration requests, executes the orchestrator + subagent architecture, writes files, builds projects, and uploads results to R2 via the API server. Stateless — project state is restored from R2 on demand.

**Ollama** — Local LLM server hosting the coding model (qwen2.5-coder:32b) and vision model (qwen2.5vl).

### Data Flow

**Initial Generation:**
1. User uploads wireframe image
2. Frontend creates project via API server (D1 record)
3. Frontend streams from agent server with the image
4. Agent: vision model describes wireframe → orchestrator plans files → subagents generate code → verifier builds → git commit
5. Agent uploads `dist/` to R2, saves project source zip to R2
6. Frontend loads preview from API server (R2)

**Iteration:**
1. User types change request in chat
2. Frontend creates build record via API, streams from agent
3. Agent: orchestrator reads existing files + plans edits → subagents apply changes (JSON edit operations) → verifier builds → git commit
4. Agent uploads new build + source to R2
5. Preview reloads

**Undo:**
1. Frontend calls API to delete last build/messages
2. Agent reverts git, rebuilds, re-uploads to R2
3. Undone message returned to input box

## Agent Architecture

The agent uses an orchestrator + subagent pattern inspired by the Claude Agent SDK:

```
┌─────────────────────────────────────────────────┐
│                  Orchestrator                    │
│  Plans what files to create/modify              │
│  Tools: Read, Bash, DescribeImage               │
│  Output: JSON plan with skill assignments       │
└──────────────────────┬──────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ Subagent 1 │ │ Subagent 2 │ │ Subagent N │
   │ [styling]  │ │ [component]│ │[integration]│
   │ Edit ops   │ │ Full file  │ │ Edit ops   │
   └────────────┘ └────────────┘ └────────────┘
                       │
                       ▼
               ┌──────────────┐
               │   Verifier   │
               │  npm run     │
               │  build + fix │
               └──────────────┘
```

### Skills

Each subagent adopts a specialized persona at runtime based on the task. Skills are defined in `packages/agent/src/skills/`:

| Skill | Purpose | Output |
|-------|---------|--------|
| **styling** | Colors, typography, shadows, borders | JSON edit operations |
| **layout** | Flexbox, grid, positioning, sizing | JSON edit operations |
| **component** | New components or major rewrites | Complete file content |
| **integration** | Wiring components in App.tsx | JSON edit operations |

Skills use chain-of-thought reasoning: analyze current code → diagnose the problem → determine the fix → output edits.

### Edit Operations

For modifications, subagents output JSON edit operations instead of rewriting entire files:

```json
[
  {"old": "bg-gray-800", "new": "bg-red-500"},
  {"old": "text-sm", "new": "text-lg font-bold"}
]
```

Edit matching has three fallback levels:
1. Exact string match
2. Quote-swapped match (single ↔ double quotes)
3. Whitespace-normalized match (regex)

### LLM Backend

Uses Ollama for local model inference. The orchestrator + subagent architecture runs on `qwen2.5-coder:32b` for code generation and `qwen2.5vl` for wireframe vision analysis.

## Security

### Filesystem Isolation

- **Path validation** — `safePath()` resolves all paths through `realpathSync()` to prevent symlink-based directory traversal. Symlinks are rejected outright.
- **Project scoping** — All file operations (Read, Write, Edit) are restricted to the project directory.

### Command Execution

- **Allowlist** — `bash-permissions.json` defines permitted commands and subcommands. Anything not listed is rejected.
- **No command chaining** — `&&`, `||`, `;`, `|` are blocked. Each tool call is a single command.
- **No subshells** — Backticks and `$(...)` are blocked.
- **No redirections** — `>`, `<`, `>>` are blocked.
- **No network** — `curl`, `wget`, `ssh`, `python` etc. are not on the allowlist.
- **Git restrictions** — Only `add`, `commit`, `status`, `log`, `diff`, `init`, `rev-parse`, `show`. No `push`, `remote`, `clone`, `fetch`, `pull`.
- **Env stripping** — Sensitive environment variables are removed from child processes.
- **Quote-aware parsing** — Command validation correctly handles quoted strings with special characters.

### API Security

- **CORS** — Agent server restricted to frontend origins only.
- **Internal auth** — Agent→API communication uses a shared `INTERNAL_API_KEY` (Bearer token). In production, this would be replaced with presigned R2 URLs or scoped credentials.
- **Input validation** — All API endpoints validate field types, lengths, and required fields. Project names max 200 chars, messages max 500 chars, build uploads max 100 files / 2MB each.
- **Request body limits** — 8MB for generation (wireframe image), 64KB for iterations.
- **Request timeout** — 10 minute wall-clock limit per request.
- **Image validation** — Frontend restricts to PNG/JPEG/WebP, max 5MB.

### Prompt Injection Mitigation

- **File content wrapping** — All source code passed to LLMs is wrapped in `<file_content>` tags with explicit instructions to treat the content as data, not instructions.
- **Blast radius reduction** — Even if prompt injection succeeds, the agent can only modify files within the project directory, run allowlisted commands, and cannot access the network.

### Production Considerations

For deployment beyond local dev:
- Replace shared API key with presigned R2 URLs for agent→storage uploads
- Container-per-request isolation (Docker/Firecracker) for agent execution
- Request queuing with worker pool for concurrent users
- User authentication (JWT/API keys) with per-user budget tracking
- Rate limiting per project/user
