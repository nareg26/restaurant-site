-- Storage for images attached to Tasks blocks. Run once in the SQL editor
-- (after supabase/tasks.sql). Design notes: docs/tasks-architecture.md.

-- Public-read bucket; the app serves images by their public URL.
insert into storage.buckets (id, name, public)
values ('task-images', 'task-images', true)
on conflict (id) do nothing;

-- Wide open like the tables. TODO tighten once staff auth exists.
create policy "task images read"   on storage.objects for select using (bucket_id = 'task-images');
create policy "task images write"  on storage.objects for insert with check (bucket_id = 'task-images');
create policy "task images delete" on storage.objects for delete using (bucket_id = 'task-images');
