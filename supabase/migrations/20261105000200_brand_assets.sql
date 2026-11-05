-- Brand assets: the logo (SVG or any image), icons, brand guide, fonts and other files that come with a SOW.
-- Run this ONCE in the Supabase SQL editor (paste the whole file). Nothing existing is changed or deleted.
--
-- Who can do what: everyone who can read the campaign can view and download the files. Managers and team members on the
-- campaign (can_contribute) can add, rename, re-label and delete them. The files are only stored: no review reads them.
-- Object names start with "<campaign_id>/", like every other bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('brand', 'brand', false, 26214400, array[
    'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-woff', 'application/vnd.ms-fontobject',
    'application/postscript', 'application/vnd.adobe.illustrator'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null default 'other' check (kind in ('logo', 'icon', 'brand_guide', 'font', 'imagery', 'other')),
  file_name text not null check (length(file_name) between 1 and 200),
  storage_path text not null check (length(storage_path) <= 400),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 26214400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  -- A file belongs to its own campaign's folder, so one campaign can never point at another's files.
  check (storage_path like campaign_id::text || '/%'),
  unique (storage_path)
);
create index on public.brand_assets (campaign_id, kind);
create trigger touch before insert or update on public.brand_assets for each row execute function public.touch_row();
create trigger log_activity after insert or delete on public.brand_assets for each row execute function public.log_activity();

alter table public.brand_assets enable row level security;
create policy brand_assets_read on public.brand_assets for select to authenticated using (public.can_read_campaign(campaign_id));
create policy brand_assets_insert on public.brand_assets for insert to authenticated with check (public.can_contribute(campaign_id));
create policy brand_assets_update on public.brand_assets for update to authenticated using (public.can_contribute(campaign_id)) with check (public.can_contribute(campaign_id));
create policy brand_assets_delete on public.brand_assets for delete to authenticated using (public.can_contribute(campaign_id));
revoke all on public.brand_assets from anon;

-- The files themselves.
create policy "brand: read" on storage.objects for select to authenticated
  using (bucket_id = 'brand' and public.can_read_campaign(public.storage_campaign(name)));
create policy "brand: contributors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand' and public.can_contribute(public.storage_campaign(name)));
create policy "brand: contributors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'brand' and public.can_contribute(public.storage_campaign(name)));
