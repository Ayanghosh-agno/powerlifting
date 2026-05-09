# Supabase Auth + Admin Setup Guide

This app now includes:

- `#/login` page (email + password)
- Auth-protected dashboard routes
- Public referee station route: `#/signals/:station`
- Admin users page: `#/admin/users` (admin role only)

To make this fully work, complete the Supabase setup below.

---

## 1) Create/Configure Supabase Project

1. Open Supabase dashboard.
2. Create a project (or use existing one).
3. In project settings, copy:
   - Project URL
   - `anon` public key
4. Put them in local `.env`:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

Restart dev server after `.env` changes.

---

## 2) Enable Email/Password Auth

1. Go to **Authentication -> Providers -> Email**.
2. Enable Email provider.
3. For testing, set **Confirm email** OFF (optional, but easier).

---

## 3) Configure Auth URLs

Go to **Authentication -> URL Configuration**:

- Site URL: `http://localhost:5180`
- Redirect URLs: add `http://localhost:5180/*`

---

## 4) Create Initial Admin User

Create a user from **Authentication -> Users** (or sign up via login page after enabling sign-up flow separately).

Then mark this user as admin with SQL:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'admin@yourdomain.com';
```

Verify:

```sql
select id, email, raw_app_meta_data
from auth.users
where email = 'admin@yourdomain.com';
```

You should see `"role": "admin"` in `raw_app_meta_data`.

---

## 5) RLS Policy Tightening (Important)

The existing app setup SQL allows both `anon` and `authenticated` on core tables.
For login-protected data, switch core tables to `authenticated` only.

Keep public access only for referee signal workflow tables if you want `#/signals/:station` open.

### Recommended table access

- `authenticated` only:
  - `competitions`
  - `groups`
  - `lifters`
  - `referee_sessions`
  - `signal_history`
- `anon + authenticated` (public station support):
  - `referee_signals`
  - `referee_devices`

### Example policy pattern

```sql
drop policy if exists competitions_select on competitions;
create policy competitions_select on competitions
for select to authenticated
using (true);
```

Repeat similarly for insert/update/delete policies on each protected table.

---

## 6) Deploy Edge Functions for Admin User Management

Frontend `#/admin/users` calls these function names:

- `admin-list-users`
- `admin-create-user`
- `admin-set-user-active`

Create and deploy all 3.

### 6.1 Function behavior requirements

Each function must:

1. Validate caller JWT.
2. Ensure caller is admin (`app_metadata.role === "admin"`).
3. Use service role client for `auth.admin` APIs.

Never expose service role key in frontend code.

### 6.2 Example function skeleton (Deno)

Use this pattern for each function:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(supabaseUrl, serviceRoleKey);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function assertAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("Missing Authorization header");
  const token = authHeader.replace("Bearer ", "");

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("Unauthorized");
  if (data.user.app_metadata?.role !== "admin") throw new Error("Forbidden");
}
```

### 6.3 `admin-list-users` response shape

Return:

```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "disabled": false,
      "role": "admin",
      "created_at": "2026-01-01T00:00:00.000Z",
      "last_sign_in_at": "2026-01-02T00:00:00.000Z"
    }
  ]
}
```

### 6.4 `admin-create-user` request body

```json
{
  "email": "newuser@example.com",
  "password": "TempPassword123!",
  "role": "user"
}
```

Inside function:
- validate role:
  - allow only `"user"` or `"admin"`
  - fallback to `"user"` when missing/invalid
- then call:

```ts
const allowedRole = role === "admin" ? "admin" : "user";
const { data, error } = await adminClient.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { role: allowedRole },
});
```

### 6.5 `admin-set-user-active` request body

```json
{
  "userId": "uuid",
  "active": false
}
```

Inside function:
- call `adminClient.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" })`
  - Alternative: use `user_metadata` flag + your own access checks.
  - If you use another disable strategy, keep frontend function name/body contract the same.

---

## 7) Function Deployment Steps (CLI)

1. Install Supabase CLI and login.
2. Link project:

```bash
supabase link --project-ref <project-ref>
```

3. Create functions:

```bash
supabase functions new admin-list-users
supabase functions new admin-create-user
supabase functions new admin-set-user-active
```

4. Add code into each `index.ts`.
5. Deploy:

```bash
supabase functions deploy admin-list-users
supabase functions deploy admin-create-user
supabase functions deploy admin-set-user-active
```

6. Set required function secrets:

```bash
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_ANON_KEY=<anon-key>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

---

## 8) Frontend Route Behavior (After Setup)

- Public:
  - `#/signals/:station`
- Auth required:
  - `#/display/full`
  - Dashboard routes (`#/`, `#/control`, `#/groups`, `#/lifters`, `#/results`, `#/settings`, etc.)
- Admin only:
  - `#/admin/users`

---

## 9) Validation Checklist

1. Unauthenticated:
   - opening `#/control` redirects to `#/login`
   - opening `#/signals/:station` works
2. Authenticated normal user:
   - can access dashboard
   - cannot access `#/admin/users`
3. Admin user:
   - can access `#/admin/users`
   - can list/create/activate/deactivate users
4. RLS:
   - protected tables reject anon requests
5. Existing referee flow:
   - still receives/sends signals in public station route

---

## 10) Notes

- This repository currently uses one large `src/App.tsx`. You can later split auth/admin logic into:
  - `src/auth/AuthProvider.tsx`
  - `src/pages/LoginPage.tsx`
  - `src/pages/AdminUsersPage.tsx`
- If you decide display screen should be public, move `#/display/full` outside auth guard.

---

## 11) Referee Session (24h, one-per-competition)

The Referee Signals page now requires an active session before QR generation:

- "Create Session (24h)" creates or refreshes session
- QR cards stay disabled until a session exists
- Referee station rejects missing/expired/invalid session links

### Required SQL (run once)

```sql
create table if not exists public.referee_sessions (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null references public.competitions(id) on delete cascade,
  is_active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists idx_referee_sessions_competition_id
  on public.referee_sessions(competition_id);

create index if not exists idx_referee_sessions_expires_at
  on public.referee_sessions(expires_at);

alter table public.referee_sessions enable row level security;

drop policy if exists referee_sessions_select on public.referee_sessions;
drop policy if exists referee_sessions_insert on public.referee_sessions;
drop policy if exists referee_sessions_update on public.referee_sessions;
drop policy if exists referee_sessions_delete on public.referee_sessions;

create policy referee_sessions_select
  on public.referee_sessions
  for select
  to authenticated
  using (true);

create policy referee_sessions_insert
  on public.referee_sessions
  for insert
  to authenticated
  with check (true);

create policy referee_sessions_update
  on public.referee_sessions
  for update
  to authenticated
  using (true)
  with check (true);

create policy referee_sessions_delete
  on public.referee_sessions
  for delete
  to authenticated
  using (true);
```

### Session behavior in app

- App deletes existing row for same competition and creates a fresh row.
- New row always has:
  - new UUID
  - `expires_at = now + 24h`
- This guarantees one active session per competition at a time.
