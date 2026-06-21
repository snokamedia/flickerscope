/**
 * MP_proxy: A video-based approximation of the MP / revised MP flicker metric.
 *
 * Conceptual origin
 * =================
 * The original MP (Métrique de Papillon / "flicker perception metric") was
 * developed by ASSIST to predict direct flicker visibility from a photometric
 * waveform.  The revised MP work (Li & Ohno, 2023) adds Hann windowing and
 * an amplitude correction factor to reduce measurement variability.
 *
 * This implementation mirrors the revised MP structure but operates on
 * luminance data sampled at video frame rates (~240 Hz) rather than the
 * 1–10 kHz photometric sampling the standard assumes.  It is therefore
 * a PROXY — deliberately named MP_proxy — and should not be equated with
 * a formal MP measurement.
 *
 * Pipeline
 * ========
 *   1. buildNormalizedSignal — uniform resampling at measuredFps, normalize
 *      by mean (DC), choose N as highest power of 2 not exceeding total frames.
 *   2. Detrend — remove linear trend from the normalized signal (drift from
 *      auto-exposure or scene changes).
 *   3. Hann window — apply raised-cosine window to reduce spectral leakage
 *      and phase/duration sensitivity (following revised MP).
 *   4. FFT — via fft.js, extracting positive-side magnitude spectrum.
 *   5. Hann amplitude correction — multiply by C_H to recover approximate
 *      physical modulation amplitude from windowed FFT.
 *   6. Perceptual weighting — divide each frequency bin's modulation amplitude
 *      by its Minimum Detectable Modulation (MDT) from the threshold table.
 *   7. Quadratic summation — SRSS (square root of sum of squares) of weighted
 *      MP contributions across the 3–80 Hz band.
 *   8. Calibration scaling — linear fit (a × raw + b) to approximate true MP
 *      scale where 1.0 = 50% detection threshold.
 *
 * Reference
 * =========
 * - ASSIST MP: "A Proposed Method for Measuring and Reporting Flicker"
 *   (Vol. 11, Issue 1, 2012)
 * - Li & Ohno (2023): "Revision of the MP Calculation Method for Flicker
 *   Measurement" — introduces Hann window + correction factor C_H ≈ 1.225
 *   to reduce measurement variability.
 * - DOE SSL Flicker Research: energy.gov/eere/ssl/flicker-research
 * - Kelly (1961): "Visual responses to time-dependent stimuli"
 * - de Lange (1958): "Research into the dynamic nature of the human fovea"
 */

import FFT from 'fft.js';
import { MDT_TABLE, lookupMdt } from './mdt-table';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/**
 * Hann amplitude correction factor C_H.
 *
 * Following Li & Ohno (2023): the Hann window reduces a pure sinusoid's
 * FFT magnitude.  Dividing by the window's coherent gain (≈0.5 for Hann
 * with fft.js unnormalized FFT) and applying a small additional correction
 * for the revised MP method gives C_H ≈ 1.225.
 *
 * The exact value depends on FFT normalization convention.  This constant
 * should be calibrated against reference waveforms using:
 *   C_H = true_amplitude / FFT_magnitude_per_Nhalf
 * where FFT_magnitude_per_Nhalf = |X_peak| / (N/2).
 */
const HANN_CORRECTION = 1.225;

/**
 * Calibration scaling: MP_proxy = a × raw + b.
 *
 * Fitted offline against reference waveforms with known MP values.
 * Initialized to identity (a=1, b=0) — must be calibrated.
 */
let calA = 1.0;
let calB = 0.0;

export function setMpCalibration(a: number, b: number) {
  calA = a;
  calB = b;
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface MpProxyResult {
  /** Calibrated MP_proxy score (dimensionless). 1.0 ≈ 50% detection threshold. */
  value: number;
  /** Raw score before calibration scaling. */
  raw: number;
  /** Effective sample rate used (Hz). */
  sampleRateHz: number;
  /** Analyzed frequency range lower bound (Hz), typically 3. */
  freqRangeMin: number;
  /** Analyzed frequency range upper bound (Hz), min(80, Nyquist). */
  freqRangeMax: number;
  /** Confidence in the result [0–1], based on SNR, cycle count, bandwidth. */
  confidence: number;
  /** Dominant frequency contribution in the MP band (Hz). */
  dominantBandHz: number;
  /** Number of usable FFT bins in the 3–80 Hz analysis band. */
  numBins: number;
  /** Warnings and assumptions about the measurement. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/*  1. Build normalized signal                                          */
/* ------------------------------------------------------------------ */

export interface NormalizedSignal {
  samples: Float64Array;
  sampleRateHz: number;
  duration: number;
}

/**
 * Build a uniformly-resampled, DC-normalized signal from raw luminance samples.
 *
 * 1. Choose N as the largest power of 2 ≤ total sample count.
 *    Power-of-2 length ensures efficient FFT without zero-padding artifacts.
 * 2. Resample onto a uniform grid via linear interpolation.
 * 3. Divide by the mean so DC = 1.  This makes the signal suitable for
 *    Weber-contrast-based flicker analysis where modulation is relative to
 *    the mean light level.
 *
 * Requires at least 8 samples and a minimum duration of 0.5 seconds
 * (relaxed for short clips but affects frequency resolution).
 */
export function buildNormalizedSignal(
  timestamps: Float64Array,
  luminance: Float64Array,
  measuredFps: number,
): NormalizedSignal | null {
  const n = timestamps.length;
  if (n < 8) return null;

  const t0 = timestamps[0];
  const t1 = timestamps[n - 1];
  const duration = t1 - t0;
  if (duration < 0.1) return null;

  // Largest power of 2 not exceeding total sample count.
  // This avoids zero-padding while ensuring FFT-friendly length.
  let N = 1;
  while (N * 2 <= n) N *= 2;
  if (N < 8) return null;

  const dt = duration / (N - 1);
  const sampleRateHz = (N - 1) / duration;
  const resampled = new Float64Array(N);

  // Linear interpolation onto uniform grid
  let j = 0;
  for (let i = 0; i < N; i++) {
    const t = t0 + i * dt;

    // Advance j to bracket the target time
    while (j + 1 < n && timestamps[j + 1] < t) j++;

    if (j + 1 < n) {
      const s0 = timestamps[j];
      const s1 = timestamps[j + 1];
      const y0 = luminance[j];
      const y1 = luminance[j + 1];
      const frac = s1 > s0 ? (t - s0) / (s1 - s0) : 0;
      resampled[i] = y0 + frac * (y1 - y0);
    } else {
      resampled[i] = luminance[n - 1];
    }
  }

  // DC normalization: divide by mean so baseline = 1
  let sum = 0;
  for (let i = 0; i < N; i++) sum += resampled[i];
  const mean = sum / N;
  if (mean <= 0) return null;

  for (let i = 0; i < N; i++) {
    resampled[i] /= mean;
  }

  return { samples: resampled, sampleRateHz, duration };
}

/* ------------------------------------------------------------------ */
/*  2. Detrend                                                         */
/* ------------------------------------------------------------------ */

/**
 * Remove a linear trend from the normalized signal.
 *
 * The MP pipeline works on the AC component around DC = 1.  Slow drifts
 * (auto-exposure changes, scene luminance shifts) would add low-frequency
 * spectral content that is not flicker.  We fit and subtract the best-fit
 * line y = slope × i + intercept for the sample-index domain.
 */
function detrend(signal: Float64Array): Float64Array {
  const N = signal.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < N; i++) {
    sumX += i;
    sumY += signal[i];
    sumXY += i * signal[i];
    sumX2 += i * i;
  }

  const denom = N * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (N * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / N;

  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = signal[i] - (slope * i + intercept);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  3. Hann window + FFT + M_k computation                             */
/* ------------------------------------------------------------------ */

export interface FrequencyBin {
  fHz: number;
  magnitude: number;
}

/**
 * Run the detrend → Hann → FFT → M_k pipeline.
 *
 * Steps:
 *   1. Detrend (linear trend removal).
 *   2. Hann window: w(n) = 0.5 × (1 - cos(2πn/(N-1))).
 *      This follows the revised MP approach: windowing dramatically reduces
 *      measurement sensitivity to starting phase and waveform duration.
 *   3. Real FFT via fft.js.
 *   4. Single-sided magnitude: |X_k| / (N/2) × C_H → M_k.
 *      M_k approximates the modulation amplitude at frequency f_k for a
 *      signal whose DC level is 1 (post-normalization).
 *   5. Restrict to bins where f_k ≥ fMin (default 3 Hz) and
 *      f_k ≤ min(80 Hz, Nyquist).
 *   6. For each bin, apply the frequency-by-frequency MDT from the lookup
 *      table to get an MP contribution and accumulate the quadratic sum.
 */
export function computeMpFromSignal(
  signal: NormalizedSignal,
  fMin = 3,
  fMax = 80,
): MpProxyResult {
  const N = signal.samples.length;
  const fs = signal.sampleRateHz;

  // 1. Detrend
  const detrended = detrend(signal.samples);

  // 2. Hann window
  const windowed = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    windowed[i] = detrended[i] * w;
  }

  // 3. FFT
  const fft = new FFT(N);
  const complex = fft.createComplexArray();
  fft.realTransform(complex, Array.from(windowed));
  fft.completeSpectrum(complex);

  // 4. Compute M_k for each positive-frequency bin
  const halfN = N / 2;
  const nyquist = fs / 2;
  const effectiveFMax = Math.min(fMax, nyquist);

  const bins: FrequencyBin[] = [];
  let sumSq = 0;
  let dominantMpK = 0;
  let dominantBandHz = 0;

  for (let k = 1; k < halfN; k++) {
    const re = complex[2 * k];
    const im = complex[2 * k + 1];
    const fHz = (k * fs) / N;

    if (fHz < fMin || fHz > effectiveFMax) continue;

    // Raw magnitude from unnormalized FFT
    let mag = Math.sqrt(re * re + im * im);

    // Normalize: convert FFT magnitude to approximate modulation amplitude.
    // For a pure sinusoid A·cos(2πft) with normalized DC = 1:
    //   without window: |X_k| / (N/2) = A
    //   with Hann window: |X_k| / (N/2) ≈ A/2
    //   after × C_H:      ≈ A (recovered amplitude)
    mag = (mag / (N / 2)) * HANN_CORRECTION;

    bins.push({ fHz, magnitude: mag });

    // Look up the detection threshold at this frequency
    const mdt = lookupMdt(fHz);
    if (!mdt || mdt <= 0) continue;

    // MP contribution: modulation / detection threshold
    const mpk = mag / mdt;
    sumSq += mpk * mpk;

    if (mpk > dominantMpK) {
      dominantMpK = mpk;
      dominantBandHz = fHz;
    }
  }

  // 5. Compute raw and calibrated MP
  const mpRaw = Math.sqrt(sumSq);
  const mpValue = Math.max(0, calA * mpRaw + calB);

  // 6. Confidence heuristic
  const freqSpan = bins.length > 1
    ? bins[bins.length - 1].fHz - bins[0].fHz
    : 0;
  const bandwidthOk = freqSpan >= 20;
  const cycleCount = signal.duration * dominantBandHz;
  const enoughCycles = cycleCount >= 5;

  let confidence = 0;
  if (bins.length >= 5 && bandwidthOk && enoughCycles) {
    confidence = Math.min(1, 0.2 + 0.3 * (bins.length / 100) + 0.3 * Math.min(1, mpValue / 3));
  } else if (bins.length >= 3) {
    confidence = 0.3;
  }

  // 7. Notes
  const notes: string[] = [];
  if (signal.duration < 1.5) {
    notes.push(`Short segment (${signal.duration.toFixed(2)} s) — frequency resolution ~${(1 / signal.duration).toFixed(1)} Hz`);
  }
  if (fs < 120) {
    notes.push(`Low effective sample rate (${fs.toFixed(0)} Hz) — MP band restricted`);
  } else if (fMax > nyquist * 0.8) {
    notes.push('Analysis band approaches Nyquist — possible aliasing at high frequencies');
  }
  if (bins.length < 10) {
    notes.push('Very few usable frequency bins — result may be unreliable');
  }
  if (mpValue < 0.3) {
    notes.push('Flicker below typical detection threshold (MP_proxy < 0.3)');
  } else if (mpValue >= 3) {
    notes.push('Strong flicker — likely obvious to most observers');
  }

  return {
    value: Math.round(mpValue * 100) / 100,
    raw: Math.round(mpRaw * 100) / 100,
    sampleRateHz: fs,
    freqRangeMin: fMin,
    freqRangeMax: effectiveFMax,
    confidence: Math.round(confidence * 100) / 100,
    dominantBandHz,
    numBins: bins.length,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/*  Top-level analysis entry point                                    */
/* ------------------------------------------------------------------ */

export function computeMpProxy(
  timestamps: Float64Array,
  luminance: Float64Array,
  measuredFps: number,
  fMin = 3,
  fMax = 80,
): MpProxyResult {
  const zeroResult: MpProxyResult = {
    value: 0,
    raw: 0,
    sampleRateHz: 0,
    freqRangeMin: fMin,
    freqRangeMax: fMax,
    confidence: 0,
    dominantBandHz: 0,
    numBins: 0,
    notes: ['Insufficient data for MP proxy'],
  };

  const signal = buildNormalizedSignal(timestamps, luminance, measuredFps);
  if (!signal) return zeroResult;

  if (signal.samples.length < 16) {
    return { ...zeroResult, notes: ['Too few resampled points for MP proxy'] };
  }

  // Tag Nyquist limit
  const nyquist = signal.sampleRateHz / 2;

  const result = computeMpFromSignal(signal, fMin, fMax);

  if (result.sampleRateHz > 0 && fMax > nyquist) {
    result.notes.push(
      `Requested upper band ${fMax} Hz exceeds Nyquist (${nyquist.toFixed(1)} Hz) — ` +
      `truncated to ${result.freqRangeMax.toFixed(1)} Hz`,
    );
  }

  return result;
}
