export const IMAGE_ACCEPT =
  ".jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.tif,.tiff,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/tiff";
const MAX_SOURCE = 50 * 1024 * 1024;
const TARGET_BYTES = 1500 * 1024;
export function validateSource(file) {
  if (!file.size) throw new Error("Die Datei ist leer.");
  if (file.size > MAX_SOURCE)
    throw new Error("Bitte ein Originalbild bis 50 MB auswählen.");
  if (
    !/\.(jpe?g|jfif|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i.test(file.name) &&
    !/^image\/(jpeg|png|webp|gif|bmp|avif|hei[cf]|tiff)$/.test(file.type)
  )
    throw new Error(
      "Bitte JPG, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF oder TIFF auswählen. RAW-Dateien bitte zuerst als Foto exportieren.",
    );
}
export function scaledDimensions(width, height, max = 2000) {
  if (!width || !height || width * height > 100000000)
    throw new Error(
      "Das Bild ist zu groß zum Verarbeiten (maximal 100 Megapixel).",
    );
  const scale = Math.min(1, max / Math.max(width, height));
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}
async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {}
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const signature = String.fromCharCode(...head);
  if (
    /\.(heic|heif)$/i.test(file.name) ||
    /image\/hei[cf]/.test(file.type) ||
    (/ftyp/.test(signature) && /heic|heix|hevc|mif1|msf1/.test(signature))
  ) {
    const { heicTo } = await import("heic-to");
    return await heicTo({ blob: file, type: "bitmap" });
  }
  if (
    /\.tiff?$/i.test(file.name) ||
    file.type === "image/tiff" ||
    (head[0] === 73 && head[1] === 73 && head[2] === 42) ||
    (head[0] === 77 && head[1] === 77 && head[3] === 42)
  ) {
    const { default: UTIF } = await import("utif");
    const buffer = await file.arrayBuffer();
    const page = UTIF.decode(buffer)[0];
    if (!page) throw new Error("TIFF enthält kein lesbares Bild.");
    scaledDimensions(page.t256?.[0], page.t257?.[0]);
    UTIF.decodeImage(buffer, page);
    return await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(UTIF.toRGBA8(page)),
        page.width,
        page.height,
      ),
    );
  }
  throw new Error(
    "Dieses Bild konnte nicht gelesen werden. Bitte eine andere Datei oder einen JPG-/PNG-Export versuchen.",
  );
}
export async function prepareImage(file) {
  validateSource(file);
  let bitmap;
  try {
    bitmap = await decode(file);
  } catch (error) {
    throw new Error(
      error.message?.startsWith("Dieses Bild")
        ? error.message
        : "Die Bilddatei konnte nicht umgewandelt werden. Bitte einen anderen Export versuchen.",
    );
  }
  try {
    const [width, height] = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    for (let scale = 1; scale >= 0.24; scale *= 0.75) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error(
          "Bildverarbeitung wird von diesem Browser nicht unterstützt.",
        );
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.76, 0.64, 0.5]) {
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/webp", quality),
        );
        if (!blob)
          throw new Error(
            "Das Bild konnte nicht verarbeitet werden. Bitte einen aktuellen Browser verwenden.",
          );
        // Some browsers return an empty MIME field from canvas.toBlob even though
        // the bytes are valid WebP. Normalize the type before upload.
        const normalized =
          blob.type === "image/webp"
            ? blob
            : new Blob([await blob.arrayBuffer()], { type: "image/webp" });
        if (normalized.size <= TARGET_BYTES)
          return {
            blob: normalized,
            width: canvas.width,
            height: canvas.height,
          };
      }
    }
    throw new Error(
      "Das Bild konnte nicht ausreichend verkleinert werden. Bitte einen kleineren Export versuchen.",
    );
  } finally {
    bitmap.close();
  }
}
