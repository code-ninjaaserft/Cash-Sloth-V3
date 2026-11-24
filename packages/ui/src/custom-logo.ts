export interface CustomLogo { readonly name: string; readonly dataUrl: string }
const MAX_DATA_LENGTH = 1_500_000;
export function parseCustomLogo(value: unknown): CustomLogo | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { name, dataUrl } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /\p{Cc}/u.test(name) || typeof dataUrl !== 'string' || dataUrl.length > MAX_DATA_LENGTH || !dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo') || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(dataUrl) || dataUrl.slice(22).length % 4 !== 0) return undefined;
  return { name: name.trim(), dataUrl };
}

/** Decode only a chosen raster file, reduce its size, and store a PNG copy without metadata. */
export async function prepareCustomLogo(file: File): Promise<CustomLogo> {
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((byte, i) => header[i] === byte);
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const webp = String.fromCharCode(...header.slice(0,4)) === 'RIFF' && String.fromCharCode(...header.slice(8,12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('Choose a PNG, JPG or WebP image.');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => { if (typeof reader.result !== 'string') reject(new Error('The image could not be read.')); else resolve(reader.result.replace(/^data:[^;]*;/u, 'data:' + (png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp') + ';')); };
    reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = source;
  try { await image.decode(); } catch { throw new Error('The image could not be read.'); }
  if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('The image dimensions are too large. Choose a smaller image.');
  const scale = Math.min(1, 512 / image.naturalWidth, 512 / image.naturalHeight);
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('The image could not be read.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const logo = parseCustomLogo({ name: file.name.slice(0,200).replace(/\p{Cc}/gu, '') || 'Logo', dataUrl: canvas.toDataURL('image/png') });
  if (!logo) throw new Error('The image could not be saved. Choose a simpler image.');
  return logo;
}
