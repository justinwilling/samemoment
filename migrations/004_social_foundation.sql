-- Social-Grundlage und Profilbilder. Sicher erneut ausführbar.
alter table public.photos add column if not exists description text not null default '';
alter table public.photos drop constraint if exists photos_description_check;
alter table public.photos add constraint photos_description_check check (char_length(description) <= 500);

create table if not exists public.follows (
  follower_id uuid references auth.users(id) on delete cascade,
  following_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
alter table public.follows enable row level security;
drop policy if exists "Follows readable" on public.follows;
create policy "Follows readable" on public.follows for select to authenticated using (true);
drop policy if exists "Users manage own follows" on public.follows;
create policy "Users manage own follows" on public.follows for all to authenticated using (follower_id = auth.uid()) with check (follower_id = auth.uid());

drop policy if exists "Avatar upload" on storage.objects;
create policy "Avatar upload" on storage.objects for insert to authenticated with check (bucket_id='samemoment-photos' and name = 'avatars/' || auth.uid()::text || '.webp');
drop policy if exists "Avatar update" on storage.objects;
create policy "Avatar update" on storage.objects for update to authenticated using (bucket_id='samemoment-photos' and name = 'avatars/' || auth.uid()::text || '.webp') with check (bucket_id='samemoment-photos' and name = 'avatars/' || auth.uid()::text || '.webp');
