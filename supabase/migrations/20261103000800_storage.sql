-- Private buckets. Object names always start with "<campaign_id>/".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sow', 'sow', false, 26214400, array['application/pdf']),
  ('designs', 'designs', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('captures', 'captures', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('documents', 'documents', false, 26214400, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_campaign(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;

-- Users
create policy "campaign files: read" on storage.objects for select to authenticated
  using (bucket_id in ('sow', 'designs', 'captures', 'documents')
         and public.can_read_campaign(public.storage_campaign(name)));

create policy "sow: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sow' and public.can_manage_campaign(public.storage_campaign(name)));
create policy "documents: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_manage_campaign(public.storage_campaign(name)));
create policy "designs: contributors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'designs' and public.can_contribute(public.storage_campaign(name)));

create policy "campaign files: managers delete" on storage.objects for delete to authenticated
  using (bucket_id in ('designs', 'documents') and public.can_manage_campaign(public.storage_campaign(name)));

-- Worker: only objects referenced by a job it holds, and captures under that job's folder.
create policy "worker: read job objects" on storage.objects for select to authenticated
  using (public.worker_can_read_object(bucket_id, name)
         or (bucket_id = 'captures' and public.worker_can_read_capture(name)));
create policy "worker: write captures" on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and public.worker_can_write_capture(name));
