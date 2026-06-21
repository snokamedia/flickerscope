/**
 * 40 Hz Gamma Flicker Therapy Validation
 *
 * Evaluates whether a measured flicker waveform matches the canonical 40 Hz
 * therapeutic protocol used in Alzheimer's / gamma entrainment research
 * (I期 Tsai et al., Cognito Therapeutics, MIT).
 *
 * Protocol reference:
 *   • Frequency: 40 Hz square wave, 50% duty cycle
 *   • Modulation depth: high (near 100% on/off)
 *   • Expected harmonics: odd (120 Hz, 200 Hz) from square-wave shape
 *   • Red flags: dominant 20 Hz (subharmonic suggests 40 Hz is harmonic of
 *     a 20 Hz fundamental — device malfunction), excessive jitter, duty
 *     cycle far from 50%
 *
 * Scoring rubric (0–100):
 *   • Frequency accuracy  (30 pts): 39.5–40.5 Hz → full, 39–41 → partial
 *   • Duty cycle         (20 pts): 45–55% → full, 30–70% → partial
 *   • Modulation depth   (15 pts): > 80% → full, > 30% → partial
 *   • 20 Hz suppression  (15 pts): 20 Hz < 10% of 40 Hz power
 *   • Timing jitter      (10 pts): < 1 ms RMS → full, < 3 ms → partial
 *   • Signal confidence  (10 pts): > 0.7 → full, > 0.4 → partial
 *
 * This module performs no signal processing — it consumes the already-
 * computed FlickerMetrics and returns a TherapyReport for UI display.
 */

import type { FlickerMetrics, TherapyReport, TherapyCriterion, TherapyVerdict } from '../app/types';

export function validateTherapy(metrics: FlickerMetrics): TherapyReport | null {
  /* Only evaluate when the dominant frequency is near the 40 Hz band.
     If the measurement is nowhere near 40 Hz, therapy validation is not
     meaningful. */
  if (metrics.frequencyHz < 39 || metrics.frequencyHz > 41) return null;
  if (metrics.confidence < 0.3) return null;

  const freq = metrics.frequencyHz;
  const duty = metrics.timing?.dutyCycle ?? null;
  const jitter = metrics.timing?.rmsJitterMs ?? null;
  const mod = metrics.modulationPercent;
  const conf = metrics.confidence;

  /* ---- 20 Hz suppression check ---- */
  /* A strong 20 Hz peak suggests the 40 Hz signal may be the 2nd harmonic
     of a 20 Hz fundamental rather than true 40 Hz.  This is the primary
     red flag for device malfunction. */
  const peak40 = metrics.topPeaks.find(p => Math.abs(p.freq - 40) < 10);
  const peak20 = metrics.topPeaks.find(p => Math.abs(p.freq - 20) < 5);
  const twentyHzRatio = peak40 && peak20 ? peak20.power / peak40.power : 0;

  /* ---- Odd harmonic check ---- */
  /* Expected for a 50% duty square wave: strong odd harmonics (120 Hz, 200 Hz).
     The 80 Hz even harmonic should ideally be suppressed.

     IMPORTANT: The 120 Hz check is only valid when Nyquist > 125 Hz.
     At 240 fps (our recommended capture rate), Nyquist = 120 Hz exactly.
     A 120 Hz signal at Nyquist aliases to DC and cannot be reliably detected.
     We skip this check for effective sample rates ≤ 250 Hz, because
     the third harmonic would be at or near the aliasing boundary. */
  const nyquist = metrics.effectiveSampleRate / 2;
  const canMeasure120Hz = nyquist > 125;
  const peak120 = canMeasure120Hz
    ? metrics.topPeaks.find(p => Math.abs(p.freq - 120) < 15)
    : undefined;
  const peak80 = metrics.topPeaks.find(p => Math.abs(p.freq - 80) < 10);
  const harmonic120Present = peak120 !== undefined && peak120.normalizedMagnitude > 0.05;
  const harmonic80Suppressed = !peak80 || peak80.normalizedMagnitude < 0.5;

  /* ---- Criteria evaluation ---- */
  const criteria: TherapyCriterion[] = [];

  /* 1. Frequency accuracy */
  const freqPass = freq >= 39.5 && freq <= 40.5;
  const freqWarn = freq >= 39 && freq <= 41;
  criteria.push({
    key: 'frequency',
    label: 'Frequency',
    pass: freqPass ? true : freqWarn ? 'warning' : false,
    value: `${freq.toFixed(2)} Hz`,
    target: '39.5–40.5 Hz',
    explanation:
      'The dominant flicker frequency must be 40 Hz ± 0.5 Hz for the canonical gamma entrainment protocol. '
      + 'This is measured from the spectral peak using parabolic interpolation for sub-bin precision.',
  });

  /* 2. Duty cycle */
  const dutyPass = duty !== null && duty >= 45 && duty <= 55;
  const dutyWarn = duty !== null && duty >= 30 && duty <= 70;
  criteria.push({
    key: 'duty-cycle',
    label: 'Duty cycle',
    pass: duty === null ? 'warning' : dutyPass ? true : dutyWarn ? 'warning' : false,
    value: duty !== null ? `${duty.toFixed(1)}%` : 'N/A',
    target: '45–55%',
    explanation:
      'The canonical 40 Hz protocol uses 50% duty cycle (square wave). '
      + 'Deviation from 50% changes the harmonic content and may affect entrainment efficacy. '
      + 'Measured via hysteresis thresholding with interpolated crossing times.',
  });

  /* 3. Modulation depth */
  const modPass = mod >= 80;
  const modWarn = mod >= 30;
  criteria.push({
    key: 'modulation',
    label: 'Modulation depth',
    pass: modPass ? true : modWarn ? 'warning' : false,
    value: `${mod.toFixed(1)}%`,
    target: '> 80%',
    explanation:
      'Therapeutic 40 Hz studies use high-contrast flicker (near 100% Michelson contrast). '
      + 'Low modulation (< 30%) may not produce sufficient cortical entrainment.',
  });

  /* 4. 20 Hz suppression */
  const twentyPass = twentyHzRatio < 0.1;
  criteria.push({
    key: 'twenty-hz',
    label: '20 Hz suppression',
    pass: twentyPass ? true : 'warning',
    value: twentyHzRatio < 0.01
      ? 'Absent'
      : `${(twentyHzRatio * 100).toFixed(1)}% of 40 Hz`,
    target: '< 10% of 40 Hz power',
    explanation:
      'A strong 20 Hz peak is the primary red flag for 40 Hz therapy validation. '
      + 'It suggests the 40 Hz signal may be the 2nd harmonic of a 20 Hz fundamental, '
      + 'indicating a device malfunction or unintended operating mode.',
  });

  /* 5. Timing jitter */
  const jitterPass = jitter !== null && jitter < 1;
  const jitterWarn = jitter !== null && jitter < 3;
  criteria.push({
    key: 'jitter',
    label: 'Cycle jitter',
    pass: jitter === null ? 'warning' : jitterPass ? true : jitterWarn ? 'warning' : false,
    value: jitter !== null ? `${jitter.toFixed(2)} ms RMS` : 'N/A',
    target: '< 1 ms RMS',
    explanation:
      'Cycle-to-cycle timing variation measured from consecutive up-crossings of the '
      + 'waveform threshold. High jitter (> 3 ms) indicates unstable device output that may '
      + 'reduce entrainment reliability.',
  });

  /* 6. Confidence */
  const confPass = conf >= 0.7;
  const confWarn = conf >= 0.4;
  criteria.push({
    key: 'confidence',
    label: 'Signal confidence',
    pass: confPass ? true : confWarn ? 'warning' : false,
    value: conf.toFixed(2),
    target: '> 0.7',
    explanation:
      'Overall measurement confidence based on peak-to-noise ratio, Nyquist proximity, '
      + 'and cycle count. Low confidence suggests the measurement should be repeated '
      + 'with a longer recording segment.',
  });

  /* ---- Red flags ---- */
  const redFlags: string[] = [];

  if (!twentyPass) {
    redFlags.push(
      `Strong 20 Hz component (${(twentyHzRatio * 100).toFixed(0)}% of 40 Hz power) — `
      + 'the 40 Hz signal may be a harmonic of a 20 Hz fundamental',
    );
  }

  if (duty !== null && (duty < 30 || duty > 70)) {
    redFlags.push(
      `Duty cycle ${duty.toFixed(0)}% is far from the canonical 50% — `
      + 'waveform shape deviates significantly from the therapeutic protocol',
    );
  }

  if (jitter !== null && jitter > 3) {
    redFlags.push(
      `High timing jitter (${jitter.toFixed(1)} ms RMS) — `
      + 'cycle-to-cycle stability is poor, may indicate device instability',
    );
  }

  if (mod < 20) {
    redFlags.push(
      `Very low modulation depth (${mod.toFixed(0)}%) — `
      + 'flicker may be too weak to produce entrainment',
    );
  }

  if (canMeasure120Hz && !harmonic120Present) {
    redFlags.push(
      'Expected 120 Hz odd harmonic is absent or very weak — '
      + 'waveform may not be a square wave, check device output type',
    );
  } else if (!canMeasure120Hz) {
    redFlags.push(
      '120 Hz harmonic check skipped — effective sample rate '
      + `${metrics.effectiveSampleRate.toFixed(0)} Hz (Nyquist = ${nyquist.toFixed(0)} Hz) `
      + 'is too low to resolve the 3rd harmonic. Capture at ≥ 480 fps to verify odd-harmonic structure.',
    );
  }

  if (!harmonic80Suppressed) {
    redFlags.push(
      'Unexpected strong 80 Hz even harmonic — '
      + 'duty cycle may deviate significantly from 50%',
    );
  }

  /* ---- Scoring ---- */
  let score = 0;

  /* Frequency (30 pts) */
  if (freqPass) score += 30;
  else if (freqWarn) score += 15;

  /* Duty cycle (20 pts) */
  if (dutyPass) score += 20;
  else if (dutyWarn) score += 10;

  /* Modulation (15 pts) */
  if (modPass) score += 15;
  else if (modWarn) score += 8;

  /* 20 Hz suppression (15 pts) */
  if (twentyPass) score += 15;
  else score += 5;

  /* Jitter (10 pts) */
  if (jitterPass) score += 10;
  else if (jitterWarn) score += 5;

  /* Confidence (10 pts) */
  if (confPass) score += 10;
  else if (confWarn) score += 5;

  /* ---- Verdict ---- */
  let verdict: TherapyVerdict;
  let summary: string;

  if (score >= 90 && freqPass && twentyPass) {
    verdict = 'strong-pass';
    summary =
      'This measurement meets the 40 Hz gamma flicker therapy protocol within tolerances. '
      + 'The dominant frequency, duty cycle, modulation depth, and waveform stability '
      + 'are consistent with published protocols (40 Hz square wave, 50% duty, ≥ 80% modulation).';
  } else if (score >= 70) {
    verdict = 'pass';
    summary =
      'This measurement is broadly consistent with the 40 Hz therapy protocol, '
      + 'though some criteria show minor deviations. '
      + 'Review the flagged criteria below to ensure the device is operating correctly.';
  } else if (score >= 50) {
    verdict = 'warning';
    summary =
      'Multiple criteria deviate from the canonical 40 Hz therapy protocol. '
      + 'The measured waveform may not produce the intended gamma entrainment effect. '
      + 'Check device settings and recording conditions before relying on this output for therapy.';
  } else if (score < 50 && conf >= 0.3) {
    verdict = 'fail';
    summary =
      'This measurement does not match the 40 Hz gamma flicker therapy protocol. '
      + 'The dominant frequency, waveform shape, or stability fall outside acceptable bounds. '
      + 'This may indicate a device malfunction, incorrect settings, or unsuitable recording conditions.';
  } else {
    verdict = 'indeterminate';
    summary =
      'Insufficient data quality to assess therapy protocol compliance. '
      + 'Consider recording a longer segment or improving recording conditions (stable lighting, '
      + 'adequate frame rate, proper exposure).';
  }

  return { verdict, score, criteria, redFlags, summary };
}

/** Returns the CSS color class for a therapy verdict badge. */
export function therapyVerdictColor(verdict: TherapyVerdict): string {
  switch (verdict) {
    case 'strong-pass': return 'text-safe';
    case 'pass':         return 'text-safe';
    case 'warning':      return 'text-warning';
    case 'fail':         return 'text-danger';
    case 'indeterminate': return 'text-text-dim';
  }
}

/** Returns a human-readable label for a therapy verdict. */
export function therapyVerdictLabel(verdict: TherapyVerdict): string {
  switch (verdict) {
    case 'strong-pass': return 'Strong Pass';
    case 'pass':         return 'Pass';
    case 'warning':      return 'Warning';
    case 'fail':         return 'Fail';
    case 'indeterminate': return 'Indeterminate';
  }
}
