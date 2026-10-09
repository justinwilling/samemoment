begin;
-- SameMoment: Supabase Auth + PostGIS + Storage.
create extension if not exists postgis with schema extensions;
create table if not exists public.photos (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 120),
 image_url text not null,
 image_key text not null unique,
 lat double precision not null check(lat between -90 and 90),
 lng double precision not null check(lng between -180 and 180),
 location extensions.geography(point,4326) generated always as (extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography) stored,
 taken_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists photos_location_idx on public.photos using gist(location);
create index if not exists photos_taken_idx on public.photos(taken_at);
alter table public.photos enable row level security;
drop policy if exists "Photos are publicly readable" on public.photos;
create policy "Photos are publicly readable" on public.photos for select to anon,authenticated using (true);
-- Öffentlich werden nur die für die Galerie benötigten Felder freigegeben.
revoke all on public.photos from anon, authenticated;
grant select (id,title,image_url,lat,lng,taken_at,created_at) on public.photos to anon, authenticated;
grant select (owner_id) on public.photos to authenticated;
grant all on public.photos to service_role;
create index if not exists photos_created_idx on public.photos(created_at desc,id desc);

-- Ersetzt die alte RPC, die interne Eigentümer- und Storage-Felder zurückgab.
drop function if exists public.find_moments(float8,float8,float8,timestamptz,int);
create or replace function public.search_moments(
 center_lat float8 default null, center_lng float8 default null,
 radius_m float8 default 200, center_time timestamptz default null,
 window_minutes int default 30, page_size int default 60, page_offset int default 0
)
returns table(id uuid,title text,image_url text,lat float8,lng float8,taken_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if (center_lat is null) <> (center_lng is null)
 or (center_lat is not null and not (center_lat between -90 and 90))
 or (center_lng is not null and not (center_lng between -180 and 180))
 or radius_m is null or not (radius_m between 1 and 5000)
 or window_minutes is null or window_minutes not between 1 and 120
 or page_size is null or page_size not between 1 and 100
 or page_offset is null or page_offset < 0 then
  raise exception 'Ungültige Suchparameter' using errcode = '22023';
 end if;
 return query
 select p.id,p.title,p.image_url,p.lat,p.lng,p.taken_at,p.created_at
 from public.photos p
 where (center_lat is null or extensions.st_dwithin(p.location,
  extensions.st_setsrid(extensions.st_makepoint(center_lng,center_lat),4326)::extensions.geography,radius_m))
 and (center_time is null or p.taken_at between
  center_time - pg_catalog.make_interval(mins => window_minutes)
  and center_time + pg_catalog.make_interval(mins => window_minutes))
 order by p.created_at desc,p.id desc limit page_size offset page_offset;
end;
$$;
revoke all on function public.search_moments(float8,float8,float8,timestamptz,int,int,int) from public, anon, authenticated;
grant execute on function public.search_moments(float8,float8,float8,timestamptz,int,int,int) to anon,authenticated;


insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('samemoment-photos','samemoment-photos',true,5242880,array['image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "samemoment_upload_own" on storage.objects;
create policy "samemoment_upload_own" on storage.objects for insert to authenticated
with check (bucket_id='samemoment-photos'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');
drop policy if exists "samemoment_read_own" on storage.objects;
create policy "samemoment_read_own" on storage.objects for select to authenticated
using (bucket_id='samemoment-photos' and owner_id=(select auth.uid())::text);

create or replace function public.samemoment_unpublished(object_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and split_part(object_key,'/',1)=auth.uid()::text
 and not exists(select 1 from public.photos where image_key=object_key);
$$;
revoke all on function public.samemoment_unpublished(text) from public, anon, authenticated;
grant execute on function public.samemoment_unpublished(text) to authenticated;
drop policy if exists "samemoment_cleanup_own" on storage.objects;
create policy "samemoment_cleanup_own" on storage.objects for delete to authenticated
using (bucket_id='samemoment-photos' and owner_id=(select auth.uid())::text
 and public.samemoment_unpublished(name));

create or replace function public.publish_moment(
 photo_key text,photo_title text,photo_lat float8,photo_lng float8,photo_taken_at timestamptz
)
returns table(id uuid,title text,image_url text,lat float8,lng float8,taken_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare uploader uuid := auth.uid();
begin
 if uploader is null then raise exception 'Anmeldung erforderlich' using errcode='42501'; end if;
 if photo_title is null or char_length(btrim(photo_title)) not between 1 and 120
 or photo_lat is null or not (photo_lat between -90 and 90)
 or photo_lng is null or not (photo_lng between -180 and 180)
 or photo_taken_at is null or not isfinite(photo_taken_at) then
  raise exception 'Ungültige Fotodaten' using errcode='22023';
 end if;
 if photo_key is null or split_part(photo_key,'/',1)<>uploader::text
 or photo_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
 or not exists(select 1 from storage.objects o where o.bucket_id='samemoment-photos'
  and o.name=photo_key and o.owner_id=uploader::text) then
  raise exception 'Eigene Bilddatei erforderlich' using errcode='42501';
 end if;
 return query
 insert into public.photos as p(owner_id,title,image_key,image_url,lat,lng,taken_at)
 values (uploader,btrim(photo_title),photo_key,
 'https://hdgecmruggnmfozjezqh.supabase.co/storage/v1/object/public/samemoment-photos/'||photo_key,
 photo_lat,photo_lng,photo_taken_at)
 returning p.id,p.title,p.image_url,p.lat,p.lng,p.taken_at,p.created_at;
end;
$$;
revoke all on function public.publish_moment(text,text,float8,float8,timestamptz) from public, anon, authenticated;
grant execute on function public.publish_moment(text,text,float8,float8,timestamptz) to authenticated;
commit;

begin;
create or replace function public.search_moments_day(
 selected_day date, day_timezone text default 'UTC',
 center_lat float8 default null, center_lng float8 default null,
 radius_m float8 default 200, page_size int default 60, page_offset int default 0
)
returns table(id uuid,title text,image_url text,lat float8,lng float8,taken_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare day_start timestamptz; day_end timestamptz;
begin
 if selected_day is null or not isfinite(selected_day)
 or day_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=day_timezone)
 or (center_lat is null)<>(center_lng is null)
 or (center_lat is not null and not(center_lat between -90 and 90))
 or (center_lng is not null and not(center_lng between -180 and 180))
 or radius_m is null or not(radius_m between 1 and 5000)
 or page_size is null or page_size not between 1 and 100
 or page_offset is null or page_offset<0 then
 raise exception 'Ungültige Tages-Suchparameter' using errcode='22023';
 end if;
 day_start:=selected_day::timestamp at time zone day_timezone;
 day_end:=(selected_day+1)::timestamp at time zone day_timezone;
 return query select p.id,p.title,p.image_url,p.lat,p.lng,p.taken_at,p.created_at
 from public.photos p
 where p.taken_at>=day_start and p.taken_at<day_end
 and (center_lat is null or extensions.st_dwithin(p.location,
 extensions.st_setsrid(extensions.st_makepoint(center_lng,center_lat),4326)::extensions.geography,radius_m))
 order by p.created_at desc,p.id desc limit page_size offset page_offset;
end;
$$;
revoke all on function public.search_moments_day(date,text,float8,float8,float8,int,int) from public,anon,authenticated;
grant execute on function public.search_moments_day(date,text,float8,float8,float8,int,int) to anon,authenticated;
commit;

-- Benutzerprofile und eigene Galerie
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
 display_name text not null default '' check (char_length(display_name) <= 80),
 avatar_url text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable" on public.profiles for select to anon,authenticated using (true);
drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile" on public.profiles for insert to authenticated with check (id=(select auth.uid()));
create policy "Users update own profile" on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
grant select (id,username,display_name,avatar_url,created_at) on public.profiles to anon,authenticated;
grant insert (id,username,display_name,avatar_url) on public.profiles to authenticated;
grant update (username,display_name,avatar_url) on public.profiles to authenticated;

create or replace function public.recommend_moments_for_user()
returns table(id uuid,title text,image_url text,lat float8,lng float8,taken_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select distinct p.id,p.title,p.image_url,p.lat,p.lng,p.taken_at,p.created_at
 from public.photos p join public.photos mine on mine.owner_id=auth.uid()
 where p.owner_id<>auth.uid()
 and extensions.st_dwithin(p.location,mine.location,5000)
 and (p.taken_at::date at time zone 'UTC')=(mine.taken_at::date at time zone 'UTC')
 order by p.created_at desc limit 60;
$$;
revoke all on function public.recommend_moments_for_user() from public,anon,authenticated;
grant execute on function public.recommend_moments_for_user() to authenticated;
