/**
 * Luminance extraction from video frames.
 *
 * Method: sRGB gamma expansion → Rec.709 linear luminance → normalize to [0, 1].
 *
 * sRGB 8-bit values are gamma-encoded (nonlinear).  Applying Rec.709 coefficients
 * directly to gamma-encoded data yields "luma" (Y'), not physically linear luminance (Y).
 * For accurate modulation depth, flicker index, and threshold-crossing timing we need
 * linear-light luminance proportional to physical light output.
 *
 * Gamma expansion follows the sRGB standard (IEC 61966-2-1):
 *   C_linear = C_srgb / 12.92                        if C_srgb ≤ 0.04045
 *   C_linear = ((C_srgb + 0.055) / 1.055) ^ 2.4      otherwise
 *
 * A 256-entry lookup table is precomputed for the 8-bit → linear mapping.
 *
 * Rec. 709 / sRGB luminance coefficients:
 *   Y = 0.2126 × R_linear + 0.7152 × G_linear + 0.0722 × B_linear
 *
 * These coefficients model the human photopic luminosity function for the sRGB
 * (aka Rec. 709) primaries.
 */

const srgbToLinear = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  if (c <= 0.04045) {
    srgbToLinear[i] = c / 12.92;
  } else {
    srgbToLinear[i] = ((c + 0.055) / 1.055) ** 2.4;
  }
}

export function computeMeanLuminance(imageData: ImageData): number {
  const { data } = imageData;
  let sum = 0;
  const n = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = srgbToLinear[data[i]];
    const g = srgbToLinear[data[i + 1]];
    const b = srgbToLinear[data[i + 2]];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  return sum / n;
}

export function extractLuminanceFromSample(
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  drawFn: (ctx: OffscreenCanvasRenderingContext2D) => void,
  targetWidth = 64,
  targetHeight = 36,
): number {
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  drawFn(ctx);
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  return computeMeanLuminance(imageData);
}
