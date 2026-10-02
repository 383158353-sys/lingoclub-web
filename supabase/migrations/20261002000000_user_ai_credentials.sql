-- AI provider credentials are only read by server-side service-role handlers.
-- The browser never receives encrypted or plaintext secret material.
create table if not exists public.user_ai_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider_type text not null check (provider_type in ('relay', 'official')),
  provider text not null check (provider in ('openai-compatible', 'openai', 'gemini')),
  base_url text not null,
  encrypted_api_key text not null,
  key_hint text not null default '',
  model text not null,
  fast_model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists user_ai_credentials_user_created_idx
  on public.user_ai_credentials (user_id, created_at);

alter table public.user_ai_credentials enable row level security;
-- Intentionally no authenticated policies: all access is mediated by the
-- server after verifying the caller's Supabase access token.

create table if not exists public.user_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_credential_id uuid,
  updated_at timestamptz not null default now(),
  constraint user_ai_preferences_owned_credential_fk
    foreign key (active_credential_id, user_id)
    references public.user_ai_credentials (id, user_id)
    on delete no action
);

alter table public.user_ai_preferences enable row level security;
-- No browser access; the service role is used after verifying the Supabase user.
