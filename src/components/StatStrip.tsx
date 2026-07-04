import { Popover } from '@base-ui/react/popover';
import type { VideoMetadata, FlickerMetrics } from '../app/types';

type Props = {
  metadata: VideoMetadata;
  results: FlickerMetrics;
};

type StatEntry = {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
  explanation: string;
};

export function StatStrip({ metadata, results }: Props) {
  const stats: StatEntry[] = [
    {
      label: 'Modulation',
      value: `${results.modulationPercent.toFixed(1)}%`,
      highlight: results.modulationPercent > 25,
      explanation: `Michelson contrast (percent flicker): (Lmax − Lmin) / (Lmax + Lmin) × 100. IEEE 1789-2015 risk thresholds are frequency-dependent (see verdict). At 120 Hz: NOEL ≤ 4%, low-risk ≤ 9.6%, above = elevated. Computed on the original (non-resampled) luminance signal to preserve peak-to-peak accuracy.`,
    },
    {
      label: 'Flicker',
      value: results.verdict === 'none' ? '—' : `${results.frequencyHz.toFixed(1)} Hz`,
      highlight: results.verdict !== 'none',
      explanation: results.verdict === 'none'
        ? 'No discernible dominant frequency — the light source appears to be steady (modulation or peak-to-noise ratio below detection threshold).'
        : `Dominant flicker frequency detected via FFT with parabolic interpolation for sub-bin precision. The highest peak in the power spectrum after prominence-based filtering (trimmed-median noise floor, 5 Hz prominence radius). Direct flicker is perceptible mainly below ~80 Hz; higher frequencies cause stroboscopic effects. Nyquist limit: ${(results.effectiveSampleRate / 2).toFixed(0)} Hz.`,
    },
    {
      label: 'Duty cycle',
      value: results.timing ? `${results.timing.dutyCycle.toFixed(1)}%` : '—',
      explanation: results.timing
        ? `Percentage of each cycle the light is ON (above the 60th-percentile threshold). mean(ON) / [mean(ON) + mean(OFF)] × 100. Based on ${results.timing.numCycles} cycles. 50% = symmetric square wave. Low values (< 20%) indicate short bright pulses (common in PWM dimming). Threshold crossing times are linearly interpolated for sub-frame precision.`
        : 'Not measurable — insufficient waveform data for hysteresis threshold detection.',
    },
    {
      label: 'Jitter',
      value: results.timing ? `${results.timing.rmsJitterMs.toFixed(2)}ms` : '—',
      explanation: results.timing
        ? `RMS variation of ${results.timing.numCycles} full-cycle periods from same-direction (ON→ON) threshold crossings (not mixed ON+OFF durations, which conflate jitter with duty-cycle asymmetry). Higher jitter indicates timing instability in the driver or mains frequency variation. Values > 2 ms suggest irregular cadence.`
        : 'Not measurable.',
    },
    {
      label: 'MP proxy',
      value: results.mpProxy ? results.mpProxy.value.toFixed(2) : '—',
      highlight: results.mpProxy !== null && results.mpProxy.value > 1,
      warn: results.mpProxy !== null && results.mpProxy.confidence < 0.4,
      explanation: results.mpProxy
        ? `A video-based approximation of the MP flicker perception metric (revised MP structure: Hann window + C_H = 1.225 correction + MDT perceptual weighting from Kelly/de Lange CSF). Scores: < 0.3 = very low (unlikely perceptible), 0.3–1 = below 50% detection threshold, 1–3 = likely visible, ≥ 3 = strong. ${results.mpProxy.notes.length ? results.mpProxy.notes.join('; ').replace(/\.$/, '') : ''}`
        : 'Not computed — requires ≥ 8 frames with minimum 0.5 s duration.',
    },
    {
      label: 'Confidence',
      value: `${Math.round(results.confidence * 100)}%`,
      warn: results.confidence < 0.4,
      explanation: `Three-factor composite: (1) peak-to-noise ratio (50%) — log-compressed prominence of dominant peak above noise floor (excludes ±15 bins around peak); (2) Nyquist proximity (30%) — quadratic penalty as frequency approaches Nyquist; (3) cycle count (20%) — min(numCycles / 10, 1). ≥ 70% = high, 40–70% = moderate, < 40% = low (results may be unreliable).`,
    },
    {
      label: 'Segment',
      value: `${(results.timeSeries.at(-1)!.t - results.timeSeries[0].t).toFixed(2)}s`,
      explanation: `Duration of the analyzed segment (${results.timeSeries.length} frames at ~${results.effectiveSampleRate.toFixed(0)} Hz). Longer segments improve frequency resolution (Δf = 1 / duration) and statistical reliability of timing and spectral measurements.`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {stats.map((s) => (
        <Popover.Root key={s.label}>
          <Popover.Trigger
            aria-label={`${s.label}: ${s.value}`}
            className={`
              flex cursor-pointer flex-col items-center rounded-lg border p-2.5 text-center transition
              hover:border-accent/30 hover:bg-accent-dim/20
              ${s.highlight ? 'border-accent/30 bg-accent-dim/40' : 'border-border bg-panel'}
              ${s.warn ? 'border-warning/30 bg-warning/[0.06]' : ''}
            `}
          >
            <span className="text-[10px] uppercase tracking-wider text-text-dim">{s.label}</span>
            <span className={`font-mono text-base font-bold tabular-nums leading-tight ${s.highlight ? 'text-accent' : s.warn ? 'text-warning' : 'text-text-main'}`}>
              {s.value}
            </span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" sideOffset={6} align="center">
              <Popover.Popup className="max-w-72 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-muted shadow-lg">
                <Popover.Arrow className="fill-surface" />
                <strong className="mb-1 block text-text-main">{s.label}: {s.value}</strong>
                {s.explanation}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ))}
    </div>
  );
}
