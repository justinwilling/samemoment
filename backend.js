import { uploadMoment } from "./photo-service.js";
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured =
  url && key && !url.includes("PROJECT") && !key.includes("YOUR_");
export const db = configured ? createClient(url, key) : null;

export const PAGE_SIZE = 60;

export async function findPhotos({ focus, radius, date, page, signal }) {
  const { data, error } = await db
    .rpc("search_moments_day", {
      center_lat: focus?.[0] ?? null,
      center_lng: focus?.[1] ?? null,
      radius_m: radius,
      selected_day: date,
      day_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      page_size: PAGE_SIZE,
      page_offset: page * PAGE_SIZE,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data || [];
}

export async function publishPhoto(photo) {
  if (!db) throw new Error("Supabase ist nicht konfiguriert.");
  return uploadMoment(db, photo);
}

export async function getProfile(userId) {
  const { data, error } = await db
    .from("profiles")
    .select("id,username,display_name,avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveProfile(userId, username, displayName) {
  const normalized = username.trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(normalized))
    throw new Error("Username: 3–24 Zeichen, nur Buchstaben, Zahlen und _.");
  const { data, error } = await db
    .from("profiles")
    .upsert(
      {
        id: userId,
        username: normalized,
        display_name: displayName.trim().slice(0, 80),
      },
      { onConflict: "id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getMyPhotos(userId) {
  const { data, error } = await db
    .from("photos")
    .select("id,title,image_url,lat,lng,taken_at,created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function getRecommendations() {
  const { data, error } = await db.rpc('recommend_moments_for_user');
  if (error) throw error;
  return data || [];
}

export async function uploadAvatar(userId, blob) {
  const path = `avatars/${userId}.webp`;
  const { error } = await db.storage.from('samemoment-photos').upload(path, blob, { contentType: 'image/webp', upsert: true });
  if (error) throw error;
  const { data } = db.storage.from('samemoment-photos').getPublicUrl(path);
  const { error: profileError } = await db.from('profiles').update({ avatar_url: `${data.publicUrl}?v=${Date.now()}` }).eq('id', userId);
  if (profileError) throw profileError;
  return `${data.publicUrl}?v=${Date.now()}`;
}
export async function followUser(followingId) {
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('Anmeldung erforderlich');
  const { error } = await db.from('follows').upsert({ follower_id: user.id, following_id: followingId });
  if (error) throw error;
}
export async function unfollowUser(followingId) {
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('Anmeldung erforderlich');
  const { error } = await db.from('follows').delete().eq('follower_id', user.id).eq('following_id', followingId);
  if (error) throw error;
}

export async function getAllPhotos() {
  const { data, error } = await db.from('photos').select('id,title,image_url,lat,lng,taken_at,created_at').order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data || [];
}
