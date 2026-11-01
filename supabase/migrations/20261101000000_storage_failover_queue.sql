-- Preparación del respaldo temporal Supabase -> Debian.
-- NO modifica estudios existentes ni habilita sincronización por sí sola.
-- Aplicar únicamente tras revisar la implementación de archivo y el esquema activo.

create table if not exists public.storage_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  source_path text not null,
  state text not null default 'pending'
    check (state in ('pending', 'copying', 'verified', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_retry_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  expected_sha256 text check (expected_sha256 is null or expected_sha256 ~ '^[0-9a-f]{64}$'),
  target_file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (study_id, source_path)
);

create index if not exists storage_sync_jobs_due_idx
  on public.storage_sync_jobs (next_retry_at, created_at)
  where state in ('pending', 'failed');

alter table public.storage_sync_jobs enable row level security;

-- Ningún usuario final puede crear, consultar ni modificar trabajos de sincronización.
revoke all on public.storage_sync_jobs from public, anon, authenticated;

comment on table public.storage_sync_jobs is
  'Cola privada de sincronización de archivos temporales de Supabase a Debian; solo servicio autorizado.';
