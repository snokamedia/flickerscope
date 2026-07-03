/**
 * FlickerScope Analysis Worker
 *
 * Receives raw luminance samples (timestamps + linear-light luminance values)
 * and performs the full analysis pipeline:
 *
 *   1. Compute effective sample rate from median inter-frame interval
 *   2. Uniform resampling via linear interpolation (FFT requires uniform grid)
 *   3. Timing metrics from raw timestamps (ON/OFF duty cycle, cycle jitter)
 *   4. Modulation depth (Michelson contrast) on raw signal
 *   5. Flicker index (standard IEC area-based definition, trapezoidal integration)
 *   6. Detrend → Hann window → FFT (fft.js)
 *   7. Spectrum peak detection (prominence-based, trimmed noise floor)
 *   8. Confidence scoring (prominence, Nyquist proximity, cycle count)
 *   9. Verdict from IEEE 1789-2015 inspired risk function
 *
 * All methods are documented inline for expert review.
 */

import FFT from 'fft.js';
import { applyWindow, detrend } from '../analysis/windows';
import { computeMpProxy } from '../lib/mp-proxy';
import { getPeakLabel } from '../lib/math';

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

type TimingMetrics = {
  dutyCycle: number;
  meanOnPeriodMs: number;
  meanOffPeriodMs: number;
  numCycles: number;
  rmsJitterMs: number;
  crossingFrequency: number;
};

type PeakInfo = {
  freq: number;
  power: number;
  normalizedMagnitude: number;
};

interface WorkerInput {
  timestamps: ArrayBuffer;
  luminance: ArrayBuffer;
}

type VerdictLabel = 'noel' | 'low-risk' | 'elevated' | 'high' | 'uncertain';

interface WorkerOutput {
  frequencyHz: number;
  modulationPercent: number;
  flickerIndex: number;
  confidence: number;
  verdict: VerdictLabel;
  notes: string[];
  riskNotes: string[];
  spectralNotes: string[];
  spectrum: { freq: number; power: number }[];
  timeSeries: { t: number; y: number }[];
  topPeaks: PeakInfo[];
  timing: TimingMetrics | null;
  effectiveSampleRate: number;
  mpProxy: {
    value: number;
    raw: number;
    sampleRateHz: number;
    freqRangeMin: number;
    freqRangeMax: number;
    confidence: number;
    dominantBandHz: number;
    numBins: number;
    notes: string[];
  } | null;
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { timestamps, luminance } = event.data;
  const t = new Float64Array(timestamps);
  const y = new Float64Array(luminance);
  const result = computeFlickerMetrics(t, y);
  self.postMessage(result);
};

/* ================================================================== */
/*  Main pipeline                                                      */
/* ================================================================== */

function computeFlickerMetrics(
  timestamps: Float64Array,
  luminance: Float64Array,
): WorkerOutput {
  const n = luminance.length;
  if (n < 4) {
    return {
      frequencyHz: 0,
      modulationPercent: 0,
      flickerIndex: 0,
      confidence: 0,
      verdict: 'uncertain',
      notes: ['Not enough frames for analysis (minimum 4 required)'],
      riskNotes: [],
      spectralNotes: [],
      spectrum: [],
      timeSeries: buildTimeSeries(timestamps, luminance),
      topPeaks: [],
      timing: null,
      effectiveSampleRate: 0,
      mpProxy: null,
    };
  }

  /* ---- Step 1: Effective sample rate from median inter-frame interval ---- */
  /* The reported fpsAverage from packet stats is useful for metadata but may
     be slightly off for VFR content.  Computing the rate from actual sample
     timestamps gives us the exact cadence of the data we will analyze. */
  const { rateHz: effectiveSampleRate, medianDt } = computeEffectiveSampleRate(timestamps);
  /* The median dt is more robust than mean dt because it resists outliers
     from dropped frames, edit gaps, or decode stutter. */

  /* ---- Step 2: Timing metrics (ON/OFF cycles, duty cycle, jitter) ---- */
  /* Must be computed on raw timestamps BEFORE resampling, because resampling
     interpolates luminance values and smooths the sharp transitions that the
     timing state machine relies on for accurate threshold crossings. */
  const timing = computeTimingMetrics(timestamps, luminance);

  /* ---- Step 3: Uniform resampling for FFT ---- */
  /* FFT requires uniformly spaced samples.  We resample the raw (possibly
     VFR) luminance signal onto a fixed grid at effectiveSampleRate. */
  const resampled = resampleUniform(timestamps, luminance, effectiveSampleRate);

  if (resampled.length < 4) {
    return {
      frequencyHz: 0,
      modulationPercent: 0,
      flickerIndex: 0,
      confidence: 0,
      verdict: 'uncertain',
      notes: ['Too few frames after resampling'],
      riskNotes: [],
      spectralNotes: [],
      spectrum: [],
      timeSeries: buildTimeSeries(timestamps, luminance),
      topPeaks: [],
      timing,
      effectiveSampleRate,
      mpProxy: null,
    };
  }

  /* ---- Step 4: Modulation depth (Michelson contrast) ---- */
  /* Computed on the raw (pre-resampling) signal to avoid interpolation
     smoothing that could attenuate peak-to-peak amplitude.
     Michelson contrast = (Lmax - Lmin) / (Lmax + Lmin) × 100
     This is the standard definition for periodic waveforms (ISO 21110, IEEE 1789). */
  const modulationPercent = computeModulationDepth(luminance);

  /* ---- Step 5: Flicker index (IEC standard area-based definition) ---- */
  /* Standard IEC/IES flicker index = Area(above mean) / Total area under waveform.
     Computed with trapezoidal integration over the original timestamps to
     preserve actual temporal relationships. */
  const flickerIndex = computeFlickerIndex(timestamps, luminance);

  /* ---- Step 6: Detrend → Hann window → FFT ---- */
  /* Detrending removes linear trends (e.g. slow brightness drift from auto-exposure
     or scene changes) that would create low-frequency artifacts in the spectrum.
     Detrend is performed on sample indices, which is valid because the signal
     has been resampled to a uniform time grid. */
  const detrended = detrend(resampled);

  /* The Hann window (raised cosine) is applied to reduce spectral leakage.
     It smoothly tapers the signal to zero at both ends, suppressing sidelobe
     artifacts from finite-length sampling.  Hann is preferred over Hamming
     for its superior sidelobe roll-off in flicker analysis where harmonic
     structure is important. */
  const windowed = applyWindow(detrended, 'hann');

  /* Zero-pad to next power of 2 for FFT efficiency.  Zero-padding interpolates
     the discrete spectrum (more frequency bins) but does not increase the
     intrinsic frequency resolution, which remains Δf = sampleRate / origSignalLength. */
  const fftSize = 1 << Math.ceil(Math.log2(windowed.length));
  /* Float64Array ensures consistent numeric type with fft.js expectations. */
  const padded = new Float64Array(fftSize);
  for (let i = 0; i < windowed.length && i < fftSize; i++) {
    padded[i] = windowed[i];
  }

  const fft = new FFT(fftSize);
  /* realTransform takes a real-valued time-domain array and fills the complex
     frequency-domain array with the positive-frequency half.  completeSpectrum
     then fills in the negative-frequency mirror. */
  const complex = fft.createComplexArray();
  fft.realTransform(complex, padded);
  fft.completeSpectrum(complex);

  /* ---- Step 7: Extract spectrum (magnitude-squared) ---- */
  /* We use power = re² + im² for each bin.  This is unnormalized (varies with
     FFT size and window choice), but for relative peak finding within a single
     analysis segment the absolute scale is not needed.  For cross-segment
     comparison, a PSD normalization (power / (Fs × sum(window²))) would be
     required. */
  const halfN = fftSize / 2;
  const freqs: number[] = [];
  const powers: number[] = [];

  for (let k = 1; k < halfN; k++) {
    const re = complex[2 * k];
    const im = complex[2 * k + 1];
    const power = re * re + im * im;
    /* Frequency of bin k: f_k = k × Fs / N */
    const hz = (k * effectiveSampleRate) / fftSize;

    /* Exclude DC (k=0) and sub-5 Hz bins.  Sub-5 Hz modulation is physically
       implausible for electric light flicker (mains and LED drivers operate
       at ≥ 50 Hz) and likely arises from scene motion or exposure drift.
       The 5 Hz cutoff is a domain-specific choice, not a mathematical limit. */
    if (hz >= 5) {
      freqs.push(hz);
      powers.push(power);
    }
  }

  /* ---- Step 8: Dominant frequency (parabolic interpolation) ---- */
  /* The raw FFT bin gives frequency resolution Δf = Fs / N.  For therapy
     validation (±0.1 Hz tolerance) we need sub-bin precision.  Parabolic
     interpolation fits a parabola to bins (k-1, k, k+1) and locates the
     vertex, giving a statistically unbiased frequency estimate approaching
     the Cramér-Rao bound for a pure sinusoid under moderate SNR.

     Formula:  Δ = 0.5 × (a - c) / (a - 2b + c)
     where a = power at peak-1, b = power at peak, c = power at peak+1.
     The interpolated bin position = peakIdx + Δ.
     This is valid when the main lobe spans ≥ 3 bins, which holds for the
     Hann window (main lobe ≈ 4 bins at -3 dB). */
  const binWidth = effectiveSampleRate / fftSize;
  const peakIndex = powers.indexOf(Math.max(...powers));
  const peakPowerValue = powers[peakIndex] || 0;

  let dominantHz = interpolatePeak(freqs, powers, peakIndex, binWidth);

  /* ---- Step 9: Harmonic peak detection ---- */
  /* Prominence-based detection with noise floor from trimmed median.
     See findSpectrumPeaks for detailed rationale. */
  const topPeaks = findSpectrumPeaks(freqs, powers);

  /* ---- Step 10: Confidence scoring ---- */
  /* Combines peak prominence ratio, Nyquist proximity, and cycle count
     into a single [0, 1] confidence value. */
  const confidence = computeConfidence(
    dominantHz, peakPowerValue, peakIndex,
    freqs, powers, timestamps, effectiveSampleRate,
  );

  /* ---- Step 11: Verdict via IEEE 1789-2015 inspired risk function ---- */
  const { verdict: riskLevel, riskNotes } = computeVerdictWithNotes(
    dominantHz, modulationPercent, confidence, topPeaks, timing,
  );

  /* Map IEEE 1789 risk level to verdict.
     Above 100 Hz, 'elevated' maps to 'high' using an app-defined
     0.20 × f high-concern threshold — not part of IEEE 1789. */
  const verdict: VerdictLabel = riskLevel;

  /* ---- Step 12: Assemble notes (split by category) ---- */
  const riskNotesArr: string[] = [...riskNotes];

  const spectralNotes: string[] = [];
  if (topPeaks.length > 1) {
    for (let i = 1; i < topPeaks.length; i++) {
      const p = topPeaks[i];
      const relPct = ((p.power / topPeaks[0].power) * 100).toFixed(1);
      const label = getPeakLabel(dominantHz, p.freq, i);
      if (label === 'harmonic') {
        const n = Math.round(p.freq / dominantHz);
        const ord = ['2nd','3rd','4th','5th','6th','7th','8th','9th'][n - 2] || `${n}th`;
        spectralNotes.push(
          `${ord} harmonic at ${p.freq.toFixed(1)} Hz (${relPct}% of fundamental) — ` +
          'indicates non-sinusoidal waveform',
        );
      } else if (label === 'subharmonic') {
        const n = Math.round(dominantHz / p.freq);
        spectralNotes.push(
          `Subharmonic at ${p.freq.toFixed(1)} Hz (${relPct}% of fundamental) — ` +
          `possible low-frequency fluctuation or half-wave asymmetry`,
        );
      } else {
        spectralNotes.push(
          `Secondary peak at ${p.freq.toFixed(1)} Hz (${relPct}% of fundamental)`,
        );
      }
    }
  }

  const notes: string[] = [];
  if (effectiveSampleRate < 120) {
    notes.push(
      `Low effective sample rate (${effectiveSampleRate.toFixed(1)} Hz) — ` +
      'Nyquist limit restricts reliable detection to < ' +
      `${(effectiveSampleRate / 2).toFixed(0)} Hz`,
    );
  }
  if (dominantHz > effectiveSampleRate * 0.4) {
    notes.push(
      `Peak at ${dominantHz.toFixed(1)} Hz approaches Nyquist ` +
      `(${(effectiveSampleRate / 2).toFixed(1)} Hz) — possible aliasing`,
    );
  }
  if (timing && timing.rmsJitterMs > 2) {
    notes.push(`Timing jitter: ${timing.rmsJitterMs.toFixed(1)} ms RMS — waveform cadence is irregular`);
  }

  const spectrum = freqs.map((freq, i) => ({ freq, power: powers[i] }));

  /* ---- Step 13: MP_proxy (perceptual flicker metric approximation) ---- */
  /* Video-based approximation of the revised MP metric for direct flicker
     visibility in the 3–80 Hz band.  Uses its own Hann-windowed FFT pipeline
     with MDT-weighted perceptual summation.  See lib/mp-proxy.ts for details. */
  const mpProxyResult = computeMpProxy(
    timestamps, luminance, effectiveSampleRate, 3, 80,
  );

  return {
    frequencyHz: dominantHz,
    modulationPercent: Math.round(modulationPercent * 100) / 100,
    flickerIndex,
    confidence: Math.round(confidence * 100) / 100,
    verdict,
    notes,
    riskNotes: riskNotesArr,
    spectralNotes,
    spectrum,
    timeSeries: buildTimeSeries(timestamps, luminance),
    topPeaks,
    timing,
    effectiveSampleRate,
    mpProxy: mpProxyResult,
  };
}

/* ================================================================== */
/*  Step 1: Effective sample rate from timestamps                      */
/* ================================================================== */

function computeEffectiveSampleRate(timestamps: Float64Array): { rateHz: number; medianDt: number } {
  const n = timestamps.length;
  if (n < 2) return { rateHz: 0, medianDt: 0 };

  /* Compute all inter-frame intervals (timestamps in seconds).
     Only positive intervals are valid (zero or negative would indicate
     duplicate or out-of-order frames, which shouldn't happen but we guard). */
  const dts: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = timestamps[i] - timestamps[i - 1];
    if (dt > 0) dts.push(dt);
  }
  if (dts.length === 0) return { rateHz: 0, medianDt: 0 };

  /* Sort for median computation.  The median is used instead of the mean
     because it is robust to outlier intervals from dropped frames, edit
     gaps, or VFR cadence changes. */
  dts.sort((a, b) => a - b);
  const mid = Math.floor(dts.length / 2);
  const medianDt = dts.length % 2 !== 0
    ? dts[mid]
    : (dts[mid - 1] + dts[mid]) / 2;

  return { rateHz: 1 / medianDt, medianDt };
}

/* ================================================================== */
/*  Step 3: Uniform resampling                                         */
/* ================================================================== */

/**
 * Resample unevenly-timed luminance samples onto a uniform time grid
 * via binary search + linear interpolation.
 *
 * Parameters:
 *   timestamps  – sample times (seconds), monotonic increasing
 *   luminance   – linear-light luminance values at each timestamp
 *   targetRate  – desired output sample rate (Hz)
 *
 * Returns Float64Array of resampled luminance values.
 *
 * The number of output samples is floor(span × rate) + 1, which guarantees
 * the last sample falls at or before the input end time (endpoint-inclusive).
 * This avoids truncating the final sample compared to Math.round.
 *
 * Linear interpolation is used rather than higher-order methods because
 * it is fast, numerically stable, and introduces no overshoot artifacts.
 * The trade-off is slight low-pass filtering of sharp PWM transitions —
 * acceptable because the analysis targets fundamental and low-order harmonic
 * frequencies, not edge positions.
 */
function resampleUniform(
  timestamps: Float64Array,
  luminance: Float64Array,
  targetRate: number,
): Float64Array {
  const n = timestamps.length;
  if (n < 2 || targetRate <= 0) return luminance;

  const t0 = timestamps[0];
  const t1 = timestamps[n - 1];
  const span = t1 - t0;
  const dt = 1 / targetRate;

  /* floor(span × rate) + 1 ensures we include the endpoint.
     Example: if span = 1.0 s and rate = 100 Hz, we get floor(100) + 1 = 101 samples,
     which is correct: samples at t = 0, 0.01, 0.02, ..., 1.00. */
  const numOut = Math.max(1, Math.floor(span * targetRate) + 1);
  const out = new Float64Array(numOut);

  for (let i = 0; i < numOut; i++) {
    const targetT = t0 + i * dt;

    if (targetT <= timestamps[0]) {
      out[i] = luminance[0];
    } else if (targetT >= timestamps[n - 1]) {
      out[i] = luminance[n - 1];
    } else {
      /* Binary search for the bracketing interval */
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (timestamps[mid] <= targetT) lo = mid;
        else hi = mid;
      }

      const tLo = timestamps[lo];
      const tHi = timestamps[hi];
      const yLo = luminance[lo];
      const yHi = luminance[hi];
      const frac = tHi > tLo ? (targetT - tLo) / (tHi - tLo) : 0;
      out[i] = yLo + (yHi - yLo) * frac;
    }
  }

  return out;
}

/* ================================================================== */
/*  Step 4: Modulation depth (Michelson contrast)                      */
/* ================================================================== */

/**
 * Michelson contrast (also called modulation depth or percent flicker):
 *   C = (Lmax - Lmin) / (Lmax + Lmin) × 100
 *
 * This is the standard metric for periodic flicker (ISO 21110, IEEE 1789,
 * CIE 191:2010).  It reports the peak-to-peak amplitude relative to the
 * DC baseline.
 *
 * The computation is on the raw signal to avoid any smoothing effects from
 * resampling interpolation.
 */
function computeModulationDepth(luminance: Float64Array): number {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < luminance.length; i++) {
    if (luminance[i] < yMin) yMin = luminance[i];
    if (luminance[i] > yMax) yMax = luminance[i];
  }
  const sum = yMax + yMin;
  return sum > 0 ? ((yMax - yMin) / sum) * 100 : 0;
}

/* ================================================================== */
/*  Step 5: Flicker index (IEC/IES area-based definition)              */
/* ================================================================== */

/**
 * Standard IEC/IES flicker index:
 *   flickerIndex = Area(above mean) / Total area under waveform
 *
 * where:
 *   Area(above mean) = ∫ max(0, y(t) - ȳ) dt
 *   Total area        = ∫ y(t) dt
 *
 * Both integrals are computed via trapezoidal summation over the original
 * (non-resampled) timestamps.  Trapezoidal integration is exact for
 * piecewise-linear signals, which is the signal model implied by linear
 * interpolation between video frames.
 *
 * For each interval between consecutive samples:
 *   • If both endpoints are above the mean → full trapezoid counted.
 *   • If both endpoints are below → zero contribution.
 *   • If the interval crosses the mean → the crossing point is linearly
 *     interpolated and the triangular area above the mean is computed.
 *
 * The result is a dimensionless number in [0, 1].
 */
function computeFlickerIndex(timestamps: Float64Array, luminance: Float64Array): number {
  const n = luminance.length;
  if (n < 2) return 0;

  /* Sample mean (arithmetic mean over time would be more correct for
     irregularly sampled data, but the sample mean is a close approximation
     when inter-frame intervals are roughly uniform). */
  let sum = 0;
  for (let i = 0; i < n; i++) sum += luminance[i];
  const mean = sum / n;

  if (mean === 0) return 0;

  let aboveArea = 0;
  let totalArea = 0;

  for (let i = 0; i < n - 1; i++) {
    const dt = timestamps[i + 1] - timestamps[i];
    if (dt <= 0) continue;

    const y0 = luminance[i];
    const y1 = luminance[i + 1];
    const y0c = y0 - mean;
    const y1c = y1 - mean;

    /* Total area under waveform: trapezoidal integration of y(t) */
    totalArea += ((y0 + y1) / 2) * dt;

    if (y0c >= 0 && y1c >= 0) {
      /* Entire interval above mean: full trapezoid above baseline */
      aboveArea += ((y0c + y1c) / 2) * dt;
    } else if (y0c >= 0) {
      /* Crosses mean downward: y0 above, y1 below.
         Interpolate fraction where y = mean. */
      const frac = y0c / (y0c - y1c);
      /* Triangular area above mean */
      aboveArea += 0.5 * y0c * frac * dt;
    } else if (y1c >= 0) {
      /* Crosses mean upward: y0 below, y1 above.
         Fraction is where y reaches mean from below. */
      const frac = -y0c / (y1c - y0c);
      /* Triangular area above mean */
      aboveArea += 0.5 * y1c * (1 - frac) * dt;
    }
    /* else: both below mean, no contribution */
  }

  return totalArea > 0 ? aboveArea / totalArea : 0;
}

/* ================================================================== */
/*  Step 2: Timing metrics (ON/OFF cycles, duty cycle, jitter)         */
/* ================================================================== */

/**
 * Timing analysis using hysteresis thresholding with interpolated
 * crossing times.
 *
 * Approach:
 *   1. Smooth the luminance signal with a 3-point moving average to
 *      reduce sample-level noise that could cause threshold chatter.
 *   2. Define upper (60%) and lower (40%) thresholds of the signal range.
 *      The 20% hysteresis band prevents rapid ON/OFF toggling from
 *      noise at the crossing boundary.
 *   3. A state machine tracks ON (above upper) and OFF (below lower)
 *      states.  When a transition is detected, the exact crossing time
 *      is linearly interpolated between the adjacent samples for
 *      sub-frame timing precision.
 *
 * Metrics reported:
 *   • dutyCycle      = mean(ON durations) / |mean(ON) + mean(OFF)|
 *   • meanOnPeriodMs / meanOffPeriodMs — average durations in ms
 *   • numCycles      = number of complete ON/OFF cycles
 *   • crossingFrequency = 1 / (meanOn + meanOff)
 *
 *   • rmsJitterMs    — standard deviation of full-cycle periods
 *                      (consecutive ON→ON up-crossings).
 *                      IMPORTANT: jitter is computed on same-direction
 *                      crossings only.  Mixing ON and OFF durations
 *                      would conflate duty-cycle asymmetry with true
 *                      timing variation, yielding an inflated jitter
 *                      estimate whenever duty cycle ≠ 50%.
 */
function computeTimingMetrics(
  timestamps: Float64Array,
  luminance: Float64Array,
): TimingMetrics | null {
  const n = luminance.length;
  if (n < 10) return null;

  /* Estimate signal range from raw luminance */
  let yMin = luminance[0];
  let yMax = luminance[0];
  for (let i = 1; i < n; i++) {
    if (luminance[i] < yMin) yMin = luminance[i];
    if (luminance[i] > yMax) yMax = luminance[i];
  }
  const range = yMax - yMin;
  if (range < 1e-10) return null;

  /* Hysteresis thresholds: 60% / 40% of signal range.
     The 20% band prevents chatter from noise near the threshold. */
  const upper = yMin + 0.6 * range;
  const lower = yMin + 0.4 * range;

  /* 3-point moving average: [y(i-1) + y(i) + y(i+1)] / 3
     This is a minimal low-pass filter that preserves temporal resolution
     while smoothing single-sample noise spikes. */
  const smoothed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = luminance[i];
    let count = 1;
    if (i > 0) { sum += luminance[i - 1]; count++; }
    if (i < n - 1) { sum += luminance[i + 1]; count++; }
    smoothed[i] = sum / count;
  }

  /* State machine with interpolated crossing times.
     Initial state: ON if first sample ≥ upper, OFF otherwise. */
  let state = smoothed[0] >= upper;
  const transitions: { time: number; type: 'on' | 'off' }[] = [];

  for (let i = 1; i < n; i++) {
    if (state) {
      /* Currently ON.  Check for downward crossing through lower threshold. */
      if (smoothed[i] <= lower) {
        /* Linear interpolation: find t where smoothed(t) = lower.
           The zero-crossing fraction of the line from (i-1, y_{i-1}) to (i, y_i). */
        const yPrev = smoothed[i - 1] - lower;
        const yCurr = smoothed[i] - lower;
        if (yPrev > yCurr) {
          const frac = -yPrev / (yCurr - yPrev);
          const crossTime = timestamps[i - 1] + frac * (timestamps[i] - timestamps[i - 1]);
          transitions.push({ time: crossTime, type: 'off' });
          state = false;
        }
      }
    } else {
      /* Currently OFF.  Check for upward crossing through upper threshold. */
      if (smoothed[i] >= upper) {
        const yPrev = smoothed[i - 1] - upper;
        const yCurr = smoothed[i] - upper;
        if (yPrev < yCurr) {
          const frac = -yPrev / (yCurr - yPrev);
          const crossTime = timestamps[i - 1] + frac * (timestamps[i] - timestamps[i - 1]);
          transitions.push({ time: crossTime, type: 'on' });
          state = true;
        }
      }
    }
  }

  if (transitions.length < 3) return null;

  /* ---- ON / OFF durations ---- */
  /* Pair consecutive transitions: ON→OFF yields an ON period, OFF→ON yields an OFF period. */
  const onPeriods: number[] = [];
  const offPeriods: number[] = [];

  for (let i = 0; i < transitions.length - 1; i++) {
    const duration = transitions[i + 1].time - transitions[i].time;
    if (duration <= 0) continue;
    if (transitions[i].type === 'on' && transitions[i + 1].type === 'off') {
      onPeriods.push(duration);
    } else if (transitions[i].type === 'off' && transitions[i + 1].type === 'on') {
      offPeriods.push(duration);
    }
  }

  if (onPeriods.length === 0 || offPeriods.length === 0) return null;

  const meanOn = onPeriods.reduce((a, b) => a + b, 0) / onPeriods.length;
  const meanOff = offPeriods.reduce((a, b) => a + b, 0) / offPeriods.length;
  const totalPeriod = meanOn + meanOff;

  /* ---- Jitter: full-cycle periods from same-direction crossings ---- */
  /* We use consecutive ON→ON up-crossings (not mixed ON+OFF durations).
     Mixing ON and OFF periods when duty cycle ≠ 50% inflates jitter because
     the ON and OFF distributions have different means.  Full-cycle periods
     capture true cycle-to-cycle timing variation. */
  const onTransitions = transitions.filter(t => t.type === 'on');
  const cyclePeriods: number[] = [];
  for (let i = 1; i < onTransitions.length; i++) {
    cyclePeriods.push(onTransitions[i].time - onTransitions[i - 1].time);
  }

  const meanCycle = cyclePeriods.length > 0
    ? cyclePeriods.reduce((a, b) => a + b, 0) / cyclePeriods.length
    : totalPeriod;

  const cycleVariance = cyclePeriods.length > 0
    ? cyclePeriods.reduce((a, b) => a + (b - meanCycle) ** 2, 0) / cyclePeriods.length
    : 0;

  return {
    /* dutyCycle = meanOn / (meanOn + meanOff), expressed as percentage × 10 for one decimal
       e.g. 45.3 → 45.3%.  The division is by totalPeriod which is the sum of the means. */
    dutyCycle: Math.round((meanOn / totalPeriod) * 1000) / 10,
    meanOnPeriodMs: Math.round(meanOn * 1000 * 100) / 100,
    meanOffPeriodMs: Math.round(meanOff * 1000 * 100) / 100,
    numCycles: Math.min(onPeriods.length, offPeriods.length),
    rmsJitterMs: Math.round(Math.sqrt(cycleVariance) * 1000 * 100) / 100,
    crossingFrequency: Math.round((1 / totalPeriod) * 10) / 10,
  };
}

/* ================================================================== */
/*  Step 9: Harmonic spectrum peak detection                           */
/* ================================================================== */

/**
 * Parabolic interpolation for sub-bin frequency precision.
 * Returns the interpolated peak frequency given its three-bin neighborhood.
 * Falls back to the raw bin center if the fit is degenerate.
 */
function interpolatePeak(freqs: number[], powers: number[], index: number, binWidth: number): number {
  if (index > 0 && index < powers.length - 1 && powers[index] > 0) {
    const a = powers[index - 1];
    const b = powers[index];
    const c = powers[index + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-12) {
      let delta = 0.5 * (a - c) / denom;
      delta = Math.max(-0.5, Math.min(0.5, delta));
      return freqs[index] + delta * binWidth;
    }
  }
  return freqs[index] || 0;
}

/**
 * Prominence-based peak detection in the power spectrum.
 *
 * Algorithm:
 *   1. Noise floor: trimmed median of power values (lower 50th percentile).
 *      Using the median of all bins (including peaks) inflates the floor
 *      estimate.  By taking the lower half of sorted powers we exclude
 *      the spectral peaks themselves, giving a cleaner noise baseline.
 *   2. Candidate local maxima above threshold (noiseFloor × 3).
 *   3. For each candidate, scan left and right within a fixed bin radius
 *      (~5 Hz) to find the local valley minimum on each side.
 *      A fixed bin radius derived from bin width is used instead of a
 *      percentage of the spectrum length, because a percentage window
 *      is too narrow at low frequencies (few bins per Hz) and too wide
 *      at high frequencies.
 *   4. Prominence = peak_power - max(left_valley, right_valley).
 *      This is analogous to SciPy's peak_prominence but simplified.
 *   5. Keep only peaks with prominence > 1.5 × noise floor.
 *   6. Merge peaks within 2 Hz (likely adjacent-bin lobe from same source).
 *   7. Return top 5 by power.
 */
function findSpectrumPeaks(freqs: number[], powers: number[]): PeakInfo[] {
  if (powers.length < 3) return [];

  /* Trimmed median: use the lower 50% of sorted powers to exclude peaks. */
  const sorted = [...powers].sort((a, b) => a - b);
  const lowerHalf = sorted.slice(0, Math.floor(sorted.length / 2));
  const noiseFloor = lowerHalf.length > 0
    ? lowerHalf[lowerHalf.length >> 1]
    : sorted[0];

  const threshold = noiseFloor * 3;
  const maxPower = Math.max(...powers);
  if (maxPower === 0) return [];

  /* Bin width in Hz.  For uniform FFT bins this is constant. */
  const binWidth = freqs.length > 1 ? freqs[1] - freqs[0] : 1;

  /* Prominence scan radius: ~5 Hz on each side, minimum 3 bins.
     A fixed-Hz radius is better than a percentage of total length because
     it adapts to the bin density rather than the spectrum extent. */
  const prominenceRadius = Math.max(3, Math.round(5 / binWidth));

  /* ---- Step 1: Local maxima above threshold ---- */
  const candidates: { index: number; power: number }[] = [];
  for (let i = 1; i < powers.length - 1; i++) {
    if (powers[i] > powers[i - 1] && powers[i] >= powers[i + 1] && powers[i] >= threshold) {
      candidates.push({ index: i, power: powers[i] });
    }
  }

  /* ---- Step 2: Compute prominence for each candidate ---- */
  /* Internal raw-peak type that preserves bin index for post-merge
     interpolation.  Interpolating AFTER merge ensures the merge/dedup
     step uses stable bin-center frequencies, preventing minor sub-bin
     shifts from affecting which peaks are merged. */
  interface RawPeak { index: number; power: number; }
  const rawPeaks: RawPeak[] = [];

  for (const c of candidates) {
    /* Left valley: minimum power within radius bins to the left */
    let leftMin = c.power;
    const leftStart = Math.max(0, c.index - prominenceRadius);
    for (let j = c.index - 1; j >= leftStart; j--) {
      if (powers[j] < leftMin) leftMin = powers[j];
    }

    /* Right valley: minimum power within radius bins to the right */
    let rightMin = c.power;
    const rightEnd = Math.min(powers.length, c.index + prominenceRadius);
    for (let j = c.index + 1; j < rightEnd; j++) {
      if (powers[j] < rightMin) rightMin = powers[j];
    }

    /* Prominence = peak height above the higher of the two valley floors.
       Using max(leftMin, rightMin) means the peak must rise above BOTH
       sides, which prevents overcounting peaks on a sloping spectrum floor. */
    const base = Math.max(leftMin, rightMin);
    const prominence = c.power - base;

    if (prominence > noiseFloor * 1.5) {
      rawPeaks.push({ index: c.index, power: c.power });
    }
  }

  /* ---- Step 3: Sort by descending power ---- */
  rawPeaks.sort((a, b) => b.power - a.power);

  /* ---- Step 4: Merge peaks within ~2.5 Hz ---- */
  /* The merge radius is derived from a fixed Hz target and converted to bins
     using ceil(), which adapts to varying bin widths while maintaining a
     consistent physical frequency window.  2.5 Hz covers the typical main
     lobe spread of a Hann window at real-world flicker signals without being
     aggressive enough to collapse genuinely distinct nearby components. */
  const targetMergeHz = 2.5;
  const mergeBinRadius = Math.max(1, Math.ceil(targetMergeHz / binWidth));
  const merged: RawPeak[] = [];
  for (const p of rawPeaks) {
    if (!merged.some(u => Math.abs(u.index - p.index) <= mergeBinRadius)) {
      merged.push(p);
    }
  }

  /* ---- Step 5: Interpolate each merged peak from its bin index ---- */
  const peaks: PeakInfo[] = [];
  for (const p of merged) {
    peaks.push({
      freq: interpolatePeak(freqs, powers, p.index, binWidth),
      power: p.power,
      normalizedMagnitude: 0,
    });
  }

  /* Normalize magnitudes relative to the strongest prominent peak.
     Using the dominant PEAK (not the global max bin) as denominator ensures
     the ambiguity check (topPeaks[1].power / topPeaks[0].power > 0.7)
     matches the UI display.  The global max bin may include non-prominent
     DC leakage or sidelobe energy that would shrink all displayed ratios. */
  const maxPeakPower = peaks.length > 0 ? peaks[0].power : 1;
  for (const p of peaks) {
    p.normalizedMagnitude = p.power / maxPeakPower;
  }

  return peaks.slice(0, 5);
}

/* ================================================================== */
/*  Step 10: Confidence scoring                                        */
/* ================================================================== */

/**
 * Confidence scoring from three independent factors:
 *
 *   A) Peak prominence ratio (PNR)
 *      The dominant peak's power relative to the noise floor, where the
 *      noise floor is estimated from all bins EXCEPT a ±15 bin window
 *      around the dominant peak (preventing the peak from inflating the
 *      noise baseline).
 *      pnr = peakPower / noiseFloor (linear)
 *      pnrNorm = log10(1 + pnr) / log10(1 + 100), clamped to [0, 1]
 *      The logarithmic compression provides a dB-like perceptual scale,
 *      saturating at a 100× peak-to-noise ratio.
 *
 *   B) Nyquist proximity
 *      A quadratic penalty as the dominant frequency approaches Nyquist:
 *      nyquistConfidence = max(0, 1 - (f_peak / f_nyquist)²)
 *      At 50% Nyquist → 0.75, at 80% → 0.36, at 100% → 0.
 *
 *   C) Cycle count sufficiency
 *      For reliable spectral estimation, the segment should contain
 *      multiple full cycles of the fundamental frequency:
 *      cycleConfidence = min(1, numCycles / 10)
 *      At least 10 cycles yields full confidence; fewer cycles reduces it.
 *
 * The three factors are combined via a weighted sum:
 *   confidence = 0.5 × A + 0.3 × B + 0.2 × C
 */
function computeConfidence(
  dominantHz: number,
  peakPowerVal: number,
  peakIdx: number,
  freqs: number[],
  powers: number[],
  timestamps: Float64Array,
  sampleRateHz: number,
): number {
  if (dominantHz <= 0 || peakPowerVal <= 0) return 0;

  /* ---- Factor A: Peak-to-noise ratio ---- */
  /* Exclude ±15 bins around the dominant peak.  This prevents the peak
     itself from biasing the noise floor estimate.  15 bins at typical
     FFT resolution (~0.5 Hz/bin) gives a ±7.5 Hz exclusion zone, which
     is wide enough to cover the main lobe and first few sidelobes. */
  const excludeRange = 15;
  const noiseBins: number[] = [];
  for (let i = 0; i < powers.length; i++) {
    if (Math.abs(i - peakIdx) > excludeRange) {
      noiseBins.push(powers[i]);
    }
  }

  const sortedNoise = noiseBins.length > 0
    ? [...noiseBins].sort((a, b) => a - b)
    : [peakPowerVal * 0.01];

  const noiseFloor = sortedNoise[Math.floor(sortedNoise.length / 2)];
  const pnr = noiseFloor > 0 ? peakPowerVal / noiseFloor : 1;

  /* Logarithmic compression: normalize so that a 100× PNR maps to 1.0 */
  const pnrNorm = Math.min(1, Math.log10(1 + pnr) / Math.log10(1 + 100));

  /* ---- Factor B: Nyquist proximity ---- */
  const nyquist = sampleRateHz / 2;
  const nyquistRatio = dominantHz / nyquist;
  const nyquistConfidence = nyquistRatio > 0
    ? Math.max(0, 1 - nyquistRatio * nyquistRatio)
    : 1;

  /* ---- Factor C: Cycle count ---- */
  const duration = timestamps.length > 1
    ? timestamps[timestamps.length - 1] - timestamps[0]
    : 0;
  const numCycles = duration > 0 ? duration * dominantHz : 0;
  const cycleConfidence = Math.min(1, numCycles / 10);

  /* ---- Weighted combination ---- */
  /* Weights reflect the relative importance of each factor.
     PNR is the strongest indicator, Nyquist proximity guards against
     aliasing risk, and cycle count ensures statistical reliability. */
  const w1 = 0.5;
  const w2 = 0.3;
  const w3 = 0.2;

  return Math.max(0, Math.min(1, w1 * pnrNorm + w2 * nyquistConfidence + w3 * cycleConfidence));
}

/* ================================================================== */
/*  Step 11: Verdict via IEEE 1789-2015 inspired risk function         */
/* ================================================================== */

/**
 * Risk verdict combining frequency, modulation depth, and qualitative
 * flags into a single label and supporting notes.
 *
 * IEEE 1789-2015 "Recommended Practices for Modulating Current in
 * High-Brightness LEDs for Mitigating Health Risks to Viewers" defines
 * risk regions based on both frequency and percent flicker.
 *
 * Simplified piecewise model used here:
 *   • f < 100 Hz:
 *       low risk:  modulation < f × 0.01
 *       high risk: modulation > f × 0.05
 *       medium:     between these bounds
 *   • f ≥ 100 Hz:
 *       low risk:  modulation < f × 0.08
 *       high risk: modulation > f × 0.20
 *       medium:     between these bounds
 *
 * These thresholds capture the key insight of the standard: at low
 * frequencies the eye-brain system tracks flicker more acutely, so
 * allowed modulation decreases with frequency.  Above ~100 Hz the
 * eye's temporal response rolls off, allowing progressively higher
 * modulation.
 *
 * The raw verdict may be downgraded to 'uncertain' if:
 *   • confidence < 0.3
 *   • peak too close to Nyquist (ratio > 0.8)
 *   • multiple peaks with similar strength suggest ambiguous fundamental
 */
function computeVerdictWithNotes(
  freqHz: number,
  modPct: number,
  confidence: number,
  topPeaks: PeakInfo[],
  timing: TimingMetrics | null,
): { verdict: VerdictLabel; riskNotes: string[] } {
  const riskNotes: string[] = [];

  if (confidence < 0.3) {
    return { verdict: 'uncertain', riskNotes: ['Low confidence — insufficient signal quality for reliable verdict'] };
  }

  const f = Math.max(1, freqHz);
  const mod = Math.max(0, Math.min(100, modPct));

  /*
   * IEEE 1789-2015 Risk Regions (with app-defined screening tier)
   *
   * IEEE 1789 defines three regions based on percent flicker and frequency:
   *
   *   No Observable Effect Level (NOEL) — flicker is imperceptible
   *     f < 90 Hz:  percent flicker < 0.01 × f
   *     f ≥ 90 Hz:  percent flicker < 0.0333 × f
   *
   *   Low risk — visible flicker may occur but is unlikely to cause
   *   adverse health effects under typical viewing conditions
   *     f < 90 Hz:  percent flicker < 0.08 × f  (interpolated between NOEL and 5x)
   *     f ≥ 90 Hz:  percent flicker < 0.08 × f  (same line extended)
   *
   *   Above low-risk — exceeds the IEEE low-risk ceiling
   *     f < 100 Hz: percent flicker > 0.08 × f  → 'elevated'
   *     f ≥ 100 Hz: percent flicker > 0.08 × f  → 'elevated' or 'high'
   *
   * FlickerScope adds an app-defined high-concern tier at 0.20 × f
   * for f ≥ 100 Hz that maps to 'high'.  Values between 0.08 × f
   * and 0.20 × f at f ≥ 100 Hz remain 'elevated'.  This added tier
   * is not part of IEEE 1789.
   *
   * Notes:
   *   - The NOEL line below 90 Hz is the strictest criterion (the "ASSIST"
   *     recommendation of 0.01 × f). Above 90 Hz the NOEL threshold relaxes
   *     because flicker perception drops sharply.
   */
  let verdict: VerdictLabel;

  if (f < 90) {
    const noelThreshold = Math.max(0.2, f * 0.01);
    const lowRiskThreshold = Math.max(0.5, f * 0.08);
    if (mod <= noelThreshold) {
      verdict = 'noel';
    } else if (mod <= lowRiskThreshold) {
      verdict = 'low-risk';
      riskNotes.push(
        `Modulation ${mod.toFixed(1)}% between NOEL and low-risk threshold ` +
        `at ${f.toFixed(0)} Hz (IEEE 1789 guidance)`,
      );
    } else {
      verdict = 'elevated';
      riskNotes.push(
        `Modulation ${mod.toFixed(1)}% exceeds low-risk threshold of ` +
        `${lowRiskThreshold.toFixed(1)}% at ${f.toFixed(0)} Hz`,
      );
    }
  } else if (f < 100) {
    /* Transition band: 90–100 Hz */
    const noelThreshold = Math.max(0.5, f * 0.0333);
    const lowRiskThreshold = Math.max(2, f * 0.08);
    if (mod <= noelThreshold) {
      verdict = 'noel';
    } else if (mod <= lowRiskThreshold) {
      verdict = 'low-risk';
    } else {
      verdict = 'elevated';
    }
  } else {
    /* f ≥ 100 Hz — high frequencies where flicker perception diminishes */
    const noelThreshold = Math.min(100, f * 0.0333);
    const lowRiskThreshold = Math.min(100, f * 0.08);

    if (mod <= noelThreshold) {
      verdict = 'noel';
    } else if (mod <= lowRiskThreshold) {
      verdict = 'low-risk';
      riskNotes.push(
        `Modulation ${mod.toFixed(1)}% between NOEL threshold ` +
        `(${noelThreshold.toFixed(1)}%) and low-risk threshold ` +
        `(${lowRiskThreshold.toFixed(1)}%) at ${f.toFixed(0)} Hz (IEEE 1789 guidance)`,
      );
    } else if (mod >= Math.min(100, f * 0.20)) {
      verdict = 'high';
      riskNotes.push(
        `Modulation ${mod.toFixed(1)}% exceeds low-risk threshold ` +
        `(${lowRiskThreshold.toFixed(1)}%) and app-defined high-concern ` +
        `threshold at ${f.toFixed(0)} Hz`,
      );
    } else {
      verdict = 'elevated';
      riskNotes.push(
        `Modulation ${mod.toFixed(1)}% exceeds low-risk threshold ` +
        `(${lowRiskThreshold.toFixed(1)}%) at ${f.toFixed(0)} Hz`,
      );
    }
  }

  /* Additional nuance from confidence */
  if (confidence < 0.5 && verdict !== 'noel') {
    riskNotes.push('Moderate confidence — consider corroborating measurements');
  }

  /* Flag if multiple strong peaks suggest ambiguous fundamental */
  if (topPeaks.length > 1 && topPeaks[0].power > 0) {
    const ratio = topPeaks[1].power / topPeaks[0].power;
    if (ratio > 0.7) {
      riskNotes.push('Multiple comparable peaks — dominant frequency assignment may be ambiguous');
    }
  }

  return { verdict, riskNotes };
}

/* ================================================================== */
/*  Utility: build time series array                                   */
/* ================================================================== */

function buildTimeSeries(
  timestamps: Float64Array,
  luminance: Float64Array,
): { t: number; y: number }[] {
  const result: { t: number; y: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    result.push({ t: timestamps[i], y: luminance[i] });
  }
  return result;
}
