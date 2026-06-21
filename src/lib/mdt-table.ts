/**
 * Minimum Detectable Modulation Depth (MDT) table for MP proxy.
 *
 * The MP flicker metric divides each frequency component's modulation amplitude
 * by its detection threshold at that frequency.  The result, summed quadratically,
 * gives a perceptual flicker score where 1.0 represents the 50% detection threshold
 * (calibrated: 30% sinusoidal modulation at 54 Hz → MP = 1).
 *
 * These MDT values approximate the human temporal contrast sensitivity function
 * (Kelly 1961, de Lange 1958), scaled to account for the pipeline's Hann window
 * and FFT normalization conventions.  They are directionally correct but should
 * be empirically calibrated against reference waveforms for production use.
 *
 * The shape encodes:
 *   - Peak sensitivity (lowest MDT) around 10–18 Hz
 *   - Steep rolloff above 30 Hz (visual system cannot track fast flicker)
 *   - Gradual rolloff below 8 Hz
 *
 * Values are MODULATION FRACTION (not percent), i.e. 0.30 = 30% modulation.
 */

export type MdtEntry = { fHz: number; mdt: number };

// Pipeline-calibrated MDT values using C_H = 1.225 Hann correction.
// A 30% sine at 54 Hz produces M_k ≈ 0.184 after Hann+FFT normalization,
// so MDT(54) = 0.184 to make MP = 1 for that reference case.
// Other frequencies are scaled proportionally to the Kelly/de Lange CSF shape.
export const MDT_TABLE: MdtEntry[] = [
  { fHz: 3,    mdt: 0.019 },
  { fHz: 4,    mdt: 0.014 },
  { fHz: 5,    mdt: 0.010 },
  { fHz: 6,    mdt: 0.008 },
  { fHz: 8,    mdt: 0.006 },
  { fHz: 10,   mdt: 0.004 },
  { fHz: 12,   mdt: 0.003 },
  { fHz: 15,   mdt: 0.003 },
  { fHz: 18,   mdt: 0.004 },
  { fHz: 20,   mdt: 0.004 },
  { fHz: 25,   mdt: 0.007 },
  { fHz: 30,   mdt: 0.012 },
  { fHz: 35,   mdt: 0.021 },
  { fHz: 40,   mdt: 0.031 },
  { fHz: 45,   mdt: 0.049 },
  { fHz: 50,   mdt: 0.086 },
  { fHz: 54,   mdt: 0.184 },   // reference: 30% modulation → MP = 1
  { fHz: 60,   mdt: 0.245 },
  { fHz: 65,   mdt: 0.337 },
  { fHz: 70,   mdt: 0.460 },
  { fHz: 75,   mdt: 0.552 },
  { fHz: 80,   mdt: 0.613 },
  { fHz: 85,   mdt: 0.700 },
  { fHz: 90,   mdt: 0.800 },
  { fHz: 95,   mdt: 0.900 },
  { fHz: 100,  mdt: 1.000 },
];

/**
 * Linear interpolation on the MDT table.
 * Returns null if frequency is outside the table range.
 */
export function lookupMdt(fHz: number): number | null {
  if (fHz < MDT_TABLE[0].fHz || fHz > MDT_TABLE[MDT_TABLE.length - 1].fHz) {
    return null;
  }

  for (let i = 0; i < MDT_TABLE.length - 1; i++) {
    const a = MDT_TABLE[i];
    const b = MDT_TABLE[i + 1];
    if (fHz >= a.fHz && fHz <= b.fHz) {
      const t = (fHz - a.fHz) / (b.fHz - a.fHz);
      return a.mdt + t * (b.mdt - a.mdt);
    }
  }

  return null;
}
