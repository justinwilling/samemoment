const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = origin === env.ALLOWED_ORIGIN;
    const cors = allowed
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        }
      : {};
    if (request.method === "OPTIONS")
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    const u = new URL(request.url);
    if (u.pathname.startsWith("/images/") && request.method === "GET") {
      const key = u.pathname.slice(8);
      if (!/^[0-9a-f-]{36}\.webp$/.test(key))
        return new Response("Not found", { status: 404 });
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (u.pathname !== "/upload" || request.method !== "POST")
      return json({ error: "Not found" }, 404, cors);
    if (!allowed) return json({ error: "Origin not allowed" }, 403, cors);
    try {
      const token = (request.headers.get("Authorization") || "").match(
        /^Bearer (.+)$/,
      )?.[1];
      if (!token) return json({ error: "Anmeldung erforderlich" }, 401, cors);
      const auth = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
        headers: {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
          Authorization: "Bearer " + token,
        },
      });
      if (!auth.ok) return json({ error: "Ungültige Anmeldung" }, 401, cors);
      const user = await auth.json();
      if (!user.id) return json({ error: "Ungültiger Nutzer" }, 401, cors);
      const form = await request.formData(),
        file = form.get("file");
      if (
        !(file instanceof File) ||
        file.type !== "image/webp" ||
        file.size > 5 * 1024 * 1024 ||
        file.size < 100
      )
        return json({ error: "WebP bis 5 MB erforderlich" }, 400, cors);
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (
        String.fromCharCode(...head.slice(0, 4)) !== "RIFF" ||
        String.fromCharCode(...head.slice(8, 12)) !== "WEBP"
      )
        return json({ error: "Ungültige WebP-Datei" }, 400, cors);
      const rawLat = form.get("lat"),
        rawLng = form.get("lng");
      if (
        typeof rawLat !== "string" ||
        !rawLat.trim() ||
        typeof rawLng !== "string" ||
        !rawLng.trim()
      )
        return json({ error: "Standort erforderlich" }, 400, cors);
      const title = String(form.get("title") || "").trim(),
        lat = Number(rawLat),
        lng = Number(rawLng),
        date = String(form.get("taken_at") || "");
      if (
        !title ||
        title.length > 120 ||
        !Number.isFinite(lat) ||
        Math.abs(lat) > 90 ||
        !Number.isFinite(lng) ||
        Math.abs(lng) > 180 ||
        !date ||
        !Number.isFinite(Date.parse(date))
      )
        return json({ error: "Ungültige Metadaten" }, 400, cors);
      const key = crypto.randomUUID() + ".webp";
      await env.PHOTOS.put(key, file.stream(), {
        httpMetadata: { contentType: "image/webp" },
      });
      const photo = {
        owner_id: user.id,
        title,
        lat,
        lng,
        taken_at: new Date(date).toISOString(),
        image_key: key,
        image_url: new URL("/images/" + key, request.url).toString(),
      };
      let inserted;
      try {
        inserted = await fetch(env.SUPABASE_URL + "/rest/v1/photos", {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(photo),
        });
      } catch (error) {
        await env.PHOTOS.delete(key);
        throw error;
      }
      if (!inserted.ok) {
        await env.PHOTOS.delete(key);
        return json({ error: "Datenbankfehler beim Speichern" }, 500, cors);
      }
      const rows = await inserted.json();
      const {
        id,
        title: photoTitle,
        lat: photoLat,
        lng: photoLng,
        taken_at,
        image_url,
        created_at,
      } = rows[0];
      return json(
        {
          photo: {
            id,
            title: photoTitle,
            lat: photoLat,
            lng: photoLng,
            taken_at,
            image_url,
            created_at,
          },
        },
        201,
        cors,
      );
    } catch (e) {
      return json({ error: "Upload fehlgeschlagen" }, 500, cors);
    }
  },
};
