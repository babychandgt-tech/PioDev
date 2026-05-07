-- ── PioCode Hosting Schema ─────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS hosting_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  git_url text NOT NULL,
  git_branch text NOT NULL DEFAULT 'main',
  build_command text DEFAULT '',
  start_command text DEFAULT '',
  port integer NOT NULL DEFAULT 3000,
  env_vars jsonb DEFAULT '{}',
  coolify_app_uuid text,
  subdomain text,
  public_url text,
  status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hosting_deployments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES hosting_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coolify_deployment_uuid text,
  status text NOT NULL DEFAULT 'queued',
  logs text DEFAULT '',
  triggered_by text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE hosting_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosting_deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own hosting projects" ON hosting_projects;
CREATE POLICY "Users manage own hosting projects" ON hosting_projects
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own deployments" ON hosting_deployments;
CREATE POLICY "Users manage own deployments" ON hosting_deployments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_hosting_projects_user_id ON hosting_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_hosting_deployments_project_id ON hosting_deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_hosting_deployments_created ON hosting_deployments(created_at DESC);
