-- Private lesson source. Only the server service role may read or change it.
create table if not exists public.protected_lesson_assets (
  asset_path text primary key,
  unit_key text not null,
  lesson_id text not null,
  title text not null,
  audience text not null check (audience in ('lesson', 'teacher')),
  original_html text not null,
  content_html text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  quiz_data jsonb,
  lesson_key text,
  updated_at timestamptz not null default now(),
  check (length(asset_path) between 1 and 240),
  check (asset_path !~ '(^/|\\.\\.|[?#\\\\])'),
  check (quiz_data is null or jsonb_typeof(quiz_data) = 'object')
);
alter table public.protected_lesson_assets enable row level security;
revoke all on table public.protected_lesson_assets from public, anon, authenticated;
grant select, insert, update, delete on table public.protected_lesson_assets to service_role;
comment on table public.protected_lesson_assets is 'Server-only protected lesson originals, display content and quiz keys; never expose directly to students.';
