import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ednvxxzrdplrsghiqyzx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbnZ4eHpyZHBscnNnaGlxeXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MjU1MjQsImV4cCI6MjA5MjEwMTUyNH0.VntoslGjLKvGBT5BAdVxYeGZ51A4u5ewOmYGLeMaZ2M';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const statements = [
  `CREATE TABLE IF NOT EXISTS competitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT '',
    mode text NOT NULL DEFAULT 'FULL_GAME',
    include_collars boolean NOT NULL DEFAULT true,
    started boolean NOT NULL DEFAULT false,
    active_group_name text DEFAULT NULL,
    current_lifter_id uuid DEFAULT NULL,
    current_lift text NOT NULL DEFAULT 'squat',
    current_attempt_index integer NOT NULL DEFAULT 0,
    timer_phase text NOT NULL DEFAULT 'IDLE',
    timer_ends_at bigint DEFAULT NULL,
    display_layout text NOT NULL DEFAULT 'signal_results_plate',
    display_theme text NOT NULL DEFAULT 'black',
    next_attempt_queue jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT '',
    current_lift text NOT NULL DEFAULT 'squat',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS lifters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT '',
    sex text NOT NULL DEFAULT 'Male',
    dob text NOT NULL DEFAULT '',
    bodyweight numeric DEFAULT NULL,
    weight_class text NOT NULL DEFAULT '',
    manual_weight_class text NOT NULL DEFAULT '',
    is_equipped boolean NOT NULL DEFAULT false,
    disqualified boolean NOT NULL DEFAULT false,
    category text NOT NULL DEFAULT 'Senior',
    group_name text NOT NULL DEFAULT '',
    team text NOT NULL DEFAULT '',
    rack_height_squat numeric DEFAULT NULL,
    rack_height_bench numeric DEFAULT NULL,
    lot integer DEFAULT NULL,
    squat_attempts jsonb NOT NULL DEFAULT '[{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"}]',
    bench_attempts jsonb NOT NULL DEFAULT '[{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"}]',
    deadlift_attempts jsonb NOT NULL DEFAULT '[{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"}]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS referee_signals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    position integer NOT NULL,
    signal text DEFAULT NULL,
    device_id text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(competition_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS referee_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    device_id text NOT NULL DEFAULT '',
    position integer NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(competition_id, position)
  )`,
];

for (const sql of statements) {
  const result = await runSQL(sql);
  const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] ?? 'unknown';
  console.log(`${tableName}: ${result.status} - ${result.text.slice(0, 80)}`);
}
