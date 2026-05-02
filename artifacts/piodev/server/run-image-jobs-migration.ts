import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureTable() {
  const sql = readFileSync(join(__dirname, "image-jobs-migration.sql"), "utf8");
  const { error } = await supabaseAdmin.rpc("exec_sql" as any, { sql });
  if (error) {
    console.warn(
      `[sql] RPC exec_sql gagal: ${error.message}\n` +
      `Buka Supabase Dashboard → SQL Editor → New Query, paste isi:\n` +
      `  artifacts/piodev/server/image-jobs-migration.sql\n` +
      `Lalu klik Run. Aman dijalankan berkali-kali.`
    );
    return false;
  }
  console.log("[sql] image_jobs table + RLS OK");
  return true;
}

async function main() {
  console.log("== Image Jobs Migration ==");
  const ok = await ensureTable();
  if (!ok) process.exit(2);
  console.log("== Done ==");
}

main().catch((e) => { console.error(e); process.exit(1); });
