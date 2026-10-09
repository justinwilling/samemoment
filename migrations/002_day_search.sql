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
