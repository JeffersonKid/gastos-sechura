// Utilidades de imagen y binarios para guardar fotos/Excel dentro de la base de datos de la cuenta.

/** Foto comprimida como data URL JPEG (<600 KB) para guardarla junto al registro. */
export async function compressDataUrl(blob, maxSide = 1200) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  for (const q of [0.72, 0.6, 0.5, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < 600_000) return url;
  }
  return c.toDataURL('image/jpeg', 0.35);
}

export function bufToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBuf(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
