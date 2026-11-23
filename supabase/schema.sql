-- CF-mr-notifier データベース定義
-- (既存の public.settings テーブルとは名前が被らないよう notifier_ を付けています)

create table if not exists public.notifier_projects (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  name text not null,
  channel_id text not null,
  color integer not null default 5793266,
  enabled boolean not null default true,
  merge_platforms boolean not null default true,
  merge_wait_minutes integer not null default 15,
  mention_role_ids text[] not null default '{}',
  mention_user_ids text[] not null default '{}',
  filters jsonb not null default '{}'::jsonb,
  display jsonb not null default '{}'::jsonb,
  created_by text,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notifier_projects_guild_idx on public.notifier_projects (guild_id);

create table if not exists public.notifier_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.notifier_projects(id) on delete cascade,
  platform text not null check (platform in ('modrinth', 'curseforge', 'github')),
  external_id text not null,
  display_name text,
  icon_url text,
  project_type text,
  primed boolean not null default false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (project_id, platform, external_id)
);
create index if not exists notifier_sources_project_idx on public.notifier_sources (project_id);

create table if not exists public.notifier_seen (
  source_id uuid not null references public.notifier_sources(id) on delete cascade,
  version_id text not null,
  seen_at timestamptz not null default now(),
  primary key (source_id, version_id)
);

-- ボット(service_role)だけが読み書きできるようにする。
-- ポリシーを作らない = 外部(anon / authenticated)からは一切アクセス不可。
alter table public.notifier_projects enable row level security;
alter table public.notifier_sources enable row level security;
alter table public.notifier_seen enable row level security;
