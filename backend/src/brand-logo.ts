/**
 * The Workspace Junction logo for emails and PDFs.
 * - Emails embed it as an inline attachment (cid:), so it shows in every inbox even when the
 *   site URL is localhost or images from the web are blocked by default.
 * - PDFs draw it as an image XObject; the PNG's alpha channel becomes a soft mask.
 * Source: backend/assets/logo-white.png (white logo for the dark green header band).
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {deflateSync, inflateSync} from 'node:zlib';

export const LOGO_CID = 'wsj-logo@workspacejunction';
const candidates = [join(__dirname, '..', 'assets', 'logo-white.png'), join(process.cwd(), 'assets', 'logo-white.png'), join(process.cwd(), 'backend', 'assets', 'logo-white.png')];
let cached: Buffer | null | undefined;

export function logoPng(): Buffer | null {
  if (cached !== undefined) return cached;
  const file = candidates.find(f => existsSync(f));
  cached = file ? readFileSync(file) : null;
  return cached;
}

/** Nodemailer inline attachment, only when the HTML references the logo. */
export function logoAttachment(html?: string) {
  const png = logoPng();
  if (!png || !html || !html.includes('cid:' + LOGO_CID)) return [];
  return [{filename: 'workspace-junction.png', content: png, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' as const}];
}

/** Email header logo markup (white logo on the green band), with a text fallback via alt. */
export function logoImgTag(width = 190) {
  if (!logoPng()) return '';
  const h = Math.round(width * 170 / 578);
  return `<img src="cid:${LOGO_CID}" width="${width}" height="${h}" alt="WORKSPACE JUNCTION" style="display:block;border:0;outline:none;width:${width}px;height:${h}px;font:800 20px Arial,sans-serif;letter-spacing:1.5px;color:#FFFFFF">`;
}

export type PdfImage = {width: number; height: number; rgb: Buffer; alpha: Buffer};
let pdfCached: PdfImage | null | undefined;

/** Decodes the 8-bit RGBA, non-interlaced logo into deflated RGB and alpha planes for a PDF. */
export function pdfLogo(): PdfImage | null {
  if (pdfCached !== undefined) return pdfCached;
  pdfCached = null;
  const png = logoPng();
  if (!png) return null;
  try {
    let pos = 8, width = 0, height = 0;
    const idat: Buffer[] = [];
    while (pos < png.length) {
      const len = png.readUInt32BE(pos), type = png.toString('latin1', pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0); height = data.readUInt32BE(4);
        if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) return null; // only 8-bit RGBA, non-interlaced
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const bpp = 4, stride = width * bpp;
    const out = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[row + x - bpp] : 0, b = y ? out[row - stride + x] : 0, c = y && x >= bpp ? out[row - stride + x - bpp] : 0;
        let v = raw[src + x];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        out[row + x] = v & 255;
      }
    }
    const rgb = Buffer.alloc(width * height * 3), alpha = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) { rgb[i * 3] = out[i * 4]; rgb[i * 3 + 1] = out[i * 4 + 1]; rgb[i * 3 + 2] = out[i * 4 + 2]; alpha[i] = out[i * 4 + 3]; }
    pdfCached = {width, height, rgb: deflateSync(rgb), alpha: deflateSync(alpha)};
  } catch { pdfCached = null; }
  return pdfCached;
}

/** Browsers cannot resolve cid: links: previews and captured mail get the logo inline instead. */
export function inlineLogoForBrowser(html: string) {
  const png = logoPng();
  return png ? html.split('cid:' + LOGO_CID).join('data:image/png;base64,' + png.toString('base64')) : html;
}
