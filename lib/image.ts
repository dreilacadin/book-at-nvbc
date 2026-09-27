// Browser-only: shrink an uploaded image so it stays small in the database.

const MAX_CHARS = 650_000; // under the server limits for QR images (700k) and payment screenshots (1M)

/**
 * Reads an image file, scales it so its longest side is at most `maxSide` px, and returns a
 * data: URL — PNG if it fits (sharp for QR codes), otherwise JPEG.
 */
export async function imageToDataUrl(file: File, maxSide: number, tooLarge = "That image is too large."): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't an image."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL("image/png");
    if (out.length > MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.85);
    if (out.length > MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.6);
    if (out.length > MAX_CHARS) throw new Error(tooLarge);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
