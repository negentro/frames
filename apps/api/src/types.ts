export type Bindings = {
  ASSETS: R2Bucket;
  DB: D1Database;
  AGENT_URL: string;
  INTERNAL_API_KEY: string;
};

export type App = { Bindings: Bindings };

export interface Project {
  id: string;
  name: string;
  status: "pending" | "generating" | "ready" | "error";
  created_at: string;
  updated_at: string;
}

export interface Build {
  id: string;
  project_id: string;
  status: "pending" | "building" | "ready" | "error";
  r2_prefix: string | null;
  created_at: string;
}

export interface UsageRecord {
  id: string;
  project_id: string;
  build_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}
