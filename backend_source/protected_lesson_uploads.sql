-- Apply after protected_lesson_assets. No public role may read staged originals.
create table if not exists public.protected_lesson_uploads (
  review_id text primary key check (review_id ~ '^[A-Za-z0-9_-]{43}$'),
  asset_path text not null,
  unit_key text not null,
  lesson_id text not null,
  title text not null,
  audience text not null check (audience in ('lesson', 'teacher')),
  original_html text not null,
  content_html text not null,
  quiz_data jsonb,
  lesson_key text,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  public_stub_sha256 text not null check (public_stub_sha256 ~ '^[0-9a-f]{64}$'),
  expected_source_sha256 text check (expected_source_sha256 ~ '^[0-9a-f]{64}$'),
  git_commit_sha text unique check (git_commit_sha ~ '^[0-9a-f]{40}$'),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint protected_upload_body_size check (
    octet_length(original_html) between 1 and 6291456 and
    octet_length(content_html) between 1 and 6291456
  )
);

alter table public.protected_lesson_uploads enable row level security;
revoke all on public.protected_lesson_uploads from public, anon, authenticated;
grant select, insert on public.protected_lesson_uploads to service_role;
grant update (git_commit_sha, activated_at) on public.protected_lesson_uploads to service_role;
grant select, insert, update on public.protected_lesson_assets to service_role;

-- The Edge Function invokes this only after confirming the Git reference update.
-- An advisory lock also serializes creation when no asset row exists yet.
-- A stale upload never overwrites a more recent active version.
create or replace function public.activate_protected_lesson_upload(p_review_id text)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  staged public.protected_lesson_uploads%rowtype;
  active_hash text;
begin
  select * into staged from public.protected_lesson_uploads
    where review_id = p_review_id for update;
  if not found or staged.git_commit_sha is null then return false; end if;
  if staged.activated_at is not null then return true; end if;
  perform pg_advisory_xact_lock(hashtextextended(staged.asset_path, 8061401));
  select source_sha256 into active_hash from public.protected_lesson_assets
    where asset_path = staged.asset_path for update;
  if active_hash is distinct from staged.expected_source_sha256
     and active_hash is distinct from staged.source_sha256 then
    return false;
  end if;
  insert into public.protected_lesson_assets
    (asset_path, unit_key, lesson_id, title, audience, original_html, content_html,
     quiz_data, lesson_key, source_sha256, updated_at)
  values
    (staged.asset_path, staged.unit_key, staged.lesson_id, staged.title, staged.audience,
     staged.original_html, staged.content_html, staged.quiz_data, staged.lesson_key,
     staged.source_sha256, now())
  on conflict (asset_path) do update set
    unit_key = excluded.unit_key, lesson_id = excluded.lesson_id, title = excluded.title,
    audience = excluded.audience, original_html = excluded.original_html,
    content_html = excluded.content_html, quiz_data = excluded.quiz_data,
    lesson_key = excluded.lesson_key, source_sha256 = excluded.source_sha256,
    updated_at = excluded.updated_at;
  update public.protected_lesson_uploads set activated_at = now()
    where review_id = p_review_id;
  return true;
end;
$$;

revoke all on function public.activate_protected_lesson_upload(text) from public, anon, authenticated;
grant execute on function public.activate_protected_lesson_upload(text) to service_role;
