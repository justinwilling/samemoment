export const PHOTO_BUCKET = "samemoment-photos";
export async function uploadMoment(client, { blob, title, pos, taken }) {
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) throw new Error("Bitte erneut anmelden.");
  if (
    !blob ||
    blob.type !== "image/webp" ||
    blob.size === 0 ||
    blob.size > 5 * 1024 * 1024
  )
    throw new Error("WebP-Bild bis 5 MB erforderlich.");
  if (
    !title?.trim() ||
    title.trim().length > 120 ||
    !Array.isArray(pos) ||
    !Number.isFinite(pos[0]) ||
    Math.abs(pos[0]) > 90 ||
    !Number.isFinite(pos[1]) ||
    Math.abs(pos[1]) > 180 ||
    !Number.isFinite(Date.parse(taken))
  )
    throw new Error("Bitte gültigen Titel, Standort und Aufnahmezeit angeben.");
  const imageKey = `${user.id}/${crypto.randomUUID()}.webp`;
  const storage = client.storage.from(PHOTO_BUCKET);
  const { error: uploadError } = await storage.upload(imageKey, blob, {
    contentType: "image/webp",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  let result;
  try {
    result = await client
      .rpc("publish_moment", {
        photo_key: imageKey,
        photo_title: title.trim(),
        photo_lat: pos[0],
        photo_lng: pos[1],
        photo_taken_at: new Date(taken).toISOString(),
      })
      .single();
  } catch {
    // A lost response may mean the transaction committed; keep the image.
    throw new Error(
      "Veröffentlichung nicht bestätigt. Bitte lade die Galerie neu, bevor du es erneut versuchst.",
    );
  }
  if (result.error) {
    if (!/^[0-9A-Z]{5}$/.test(result.error.code || ""))
      throw new Error(
        "Veröffentlichung nicht bestätigt. Bitte lade die Galerie neu, bevor du es erneut versuchst.",
      );
    let cleanup;
    try {
      cleanup = await storage.remove([imageKey]);
    } catch {
      cleanup = { error: true };
    }
    throw new Error(
      cleanup.error
        ? "Speichern fehlgeschlagen. Die unveröffentlichte Bilddatei konnte nicht aufgeräumt werden."
        : `Speichern fehlgeschlagen: ${result.error.message}`,
    );
  }
  return result.data;
}
