// Central, typed access to environment variables. Throws early with a clear
// message instead of failing deep inside a pipeline stage.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-2.5-flash",
  cronSecret: () => process.env.CRON_SECRET || "",
  dashboardPassword: () => process.env.DASHBOARD_PASSWORD || "",
};
