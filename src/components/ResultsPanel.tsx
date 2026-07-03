import { Popover } from '@base-ui/react/popover';
import {
  AlertTriangle, CheckCircle2, HelpCircle, AlertOctagon, Activity, ShieldCheck, Info,
} from 'lucide-react';
import type { FlickerMetrics, MpProxyResult } from '../app/types';

type Props = {
  results: FlickerMetrics;
};

const VERDICT_CONFIG = {
  noel: {
    icon: <ShieldCheck className="size-5 text-safe" />,
    label: 'No observable effect',
    color: 'bg-safe/10 text-safe border-safe/20',
  },
  'low-risk': {
    icon: <CheckCircle2 className="size-5 text-safe" />,
    label: 'Low risk',
    color: 'bg-safe/10 text-safe border-safe/20',
  },
  elevated: {
    icon: <AlertTriangle className="size-5 text-warning" />,
    label: 'Elevated concern',
    color: 'bg-warning/10 text-warning border-warning/20',
  },
  high: {
    icon: <AlertOctagon className="size-5 text-danger" />,
    label: 'High concern',
    color: 'bg-danger/10 text-danger border-danger/20',
  },
  uncertain: {
    icon: <HelpCircle className="size-5 text-text-dim" />,
    label: 'Uncertain',
    color: 'bg-text-dim/10 text-text-dim border-text-dim/20',
  },
} as const;

export function ResultsPanel({ results }: Props) {
  const vc = VERDICT_CONFIG[results.verdict];
  const nyquistHz = results.effectiveSampleRate / 2;
  const nyquistMargin = results.frequencyHz > 0
    ? (1 - results.frequencyHz / nyquistHz) * 100
    : 0;

  return (
    <div className="space-y-4">
      {/* ---- Verdict banner ---- */}
      <div className={`flex items-start gap-3 rounded-lg border p-4 ${vc.color}`}>
        <div className="mt-0.5 shrink-0">{vc.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-2xl font-bold tabular-nums">
              {results.modulationPercent.toFixed(1)}%
            </span>
            <span className="text-sm text-text-muted">
              Modulation at {results.frequencyHz.toFixed(1)} Hz
            </span>
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase">
              {vc.label}
            </span>
          </div>
          {results.riskNotes.length > 0 && (
            <div className="mt-2 space-y-1">
              {results.riskNotes.map((n, i) => (
                <p key={i} className="flex items-start gap-1.5 text-xs text-text-muted">
                  <span className="mt-0.5 shrink-0">
                    {results.verdict === 'high' || results.verdict === 'elevated'
                      ? <AlertOctagon className="size-3 text-danger" />
                      : <AlertTriangle className="size-3 text-warning" />
                    }
                  </span>
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- IEEE 1789 position indicator ---- */}
      <StatPanel icon={<Info className="size-3.5" />} title="IEEE 1789-2015 risk assessment">
        <div className="space-y-1 text-xs text-text-muted">
          <p>
            Modulation {results.modulationPercent.toFixed(1)}% at{' '}
            {results.frequencyHz.toFixed(1)} Hz →
            {' '}<strong className="text-text-main">{vc.label}</strong>
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-[11px]">
            <li>
              Low frequency (&lt;90 Hz): NOEL = 0.01 × f, Low-risk = 0.08 × f
            </li>
            <li>
              High frequency (≥90 Hz): NOEL = 0.0333 × f, Low-risk = 0.08 × f
            </li>
            <li>
              Measurements from camera video — for screening only, not formal certification
            </li>
          </ul>
        </div>
      </StatPanel>

      {/* ---- Spectrum peaks ---- */}
      {results.topPeaks.length > 0 && (
        <StatPanel icon={<Activity className="size-3.5" />} title="Notable spectrum peaks">
          <div className="space-y-0.5">
            {results.topPeaks.slice(0, 5).map((p, i) => {
              const pct = Math.min(100, p.normalizedMagnitude * 100);
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 text-right font-mono tabular-nums text-text-main">
                    {p.freq.toFixed(1)}
                  </span>
                  <span className="w-5 text-text-dim">Hz</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(0.5, pct)}%`,
                        background: i === 0
                          ? 'linear-gradient(90deg, #9b8cff, #69e2ff)'
                          : '#64748b',
                      }}
                    />
                  </div>
                  <span className="w-[4.5rem] shrink-0 text-right font-mono tabular-nums text-text-dim">
                    {pct >= 0.001 ? pct.toFixed(3) : '< 0.001'}%
                  </span>
                </div>
              );
            })}
          </div>
          {results.spectralNotes.length > 0 && (
            <div className="mt-2 space-y-0.5 border-t border-border pt-2">
              {results.spectralNotes.map((n, i) => (
                <p key={i} className="flex items-start gap-1 text-[11px] text-text-dim">
                  <Activity className="mt-0.5 size-3 shrink-0" />
                  {n}
                </p>
              ))}
            </div>
          )}
        </StatPanel>
      )}

      {/* ---- Timing ---- */}
      {results.timing && (
        <StatPanel icon={<Activity className="size-3.5" />} title="Timing">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <StatWithPopover
              label="Duty cycle"
              value={`${results.timing.dutyCycle.toFixed(1)}%`}
              explanation="Percentage of each cycle that the light is ON (above the 60% threshold).
                Computed as mean(ON duration) / [mean(ON) + mean(OFF)] × 100.
                A 50% duty cycle is a square wave; lower values mean short bright pulses."
            />
            <StatWithPopover
              label="ON period"
              value={`${results.timing.meanOnPeriodMs.toFixed(1)} ms`}
              explanation="Average duration the light remains above the ON threshold (60th percentile)
                in each cycle. Shorter ON periods at the same frequency mean lower duty cycle."
            />
            <StatWithPopover
              label="OFF period"
              value={`${results.timing.meanOffPeriodMs.toFixed(1)} ms`}
              explanation="Average duration the light remains below the OFF threshold (40th percentile)
                in each cycle. The sum of ON and OFF periods gives the full cycle period."
            />
            <StatWithPopover
              label="Jitter"
              value={`${results.timing.rmsJitterMs.toFixed(2)} ms`}
              explanation="RMS (root-mean-square) variation of consecutive cycle periods.
                Computed from same-direction (ON→ON) crossings only — not mixing ON and OFF durations.
                Higher jitter indicates timing instability in the light source or driver."
            />
            <StatWithPopover
              label="Crossings frequency"
              value={`${results.timing.crossingFrequency.toFixed(1)} Hz`}
              explanation="Frequency derived from threshold crossings: 1 / (mean ON + mean OFF).
                This should closely match the FFT dominant frequency for stable waveforms.
                Divergence suggests asymmetry or timing irregularities."
            />
            <StatWithPopover
              label="Cycles"
              value={`${results.timing.numCycles}`}
              explanation="Number of complete ON/OFF cycles detected in the analyzed segment.
                More cycles = more reliable timing statistics."
            />
          </div>
        </StatPanel>
      )}

      {/* ---- MP proxy ---- */}
      {results.mpProxy && (
        <StatPanel icon={<Activity className="size-3.5" />} title="MP proxy (perceptual flicker estimate)">
          <MpProxySection mp={results.mpProxy} />
        </StatPanel>
      )}

      {/* ---- Diagnostics notes ---- */}
      {results.notes.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border bg-panel p-3">
          {results.notes.map((n, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-text-muted">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
              {n}
            </p>
          ))}
        </div>
      )}

      {/* ---- Diagnostics ---- */}
      <StatPanel icon={<Info className="size-3.5" />} title="Diagnostics">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <StatWithPopover
            label="Effective sample rate"
            value={`${results.effectiveSampleRate.toFixed(1)} Hz`}
            explanation="Actual frame rate computed from the median inter-frame interval of your video.
              This is used as the FFT sample rate. Lower rates reduce the Nyquist limit."
          />
          <StatWithPopover
            label="Nyquist limit"
            value={`${nyquistHz.toFixed(1)} Hz`}
            warn={nyquistMargin < 30}
            explanation="Half the effective sample rate. Frequencies above this cannot be reliably
              detected (aliasing). For credible measurement, the dominant frequency should be
              well below this limit."
          />
          <StatWithPopover
            label="Nyquist margin"
            value={results.frequencyHz > 0 ? `${nyquistMargin.toFixed(0)}%` : '—'}
            warn={nyquistMargin < 30}
            explanation="How far the dominant frequency is from Nyquist, as a percentage.
              Above 50% is comfortable. Below 30% (amber) raises aliasing concerns.
              Below 10% (red) is unreliable."
          />
          <StatWithPopover
            label="Segment frames"
            value={`${results.timeSeries.length}`}
            explanation="Number of video frames in the analyzed segment. More frames improve
              frequency resolution (Δf = sampleRate / N) and statistical reliability."
          />
        </div>
      </StatPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatPanel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}

function MpProxySection({ mp }: { mp: MpProxyResult }) {
  const mpColor =
    mp.value < 0.3 ? 'border-safe/30 bg-safe/[0.04]' :
    mp.value < 1 ? 'border-warning/30 bg-warning/[0.04]' :
    mp.value < 3 ? 'border-warning/50 bg-warning/[0.08]' :
    'border-danger/30 bg-danger/[0.04]';

  const mpLabel =
    mp.value < 0.3 ? 'Very low' :
    mp.value < 1 ? 'Low (below threshold)' :
    mp.value < 3 ? 'Moderate (likely visible)' :
    'Strong';

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-3 rounded-lg border p-3 ${mpColor}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold tabular-nums text-text-main">
              {mp.value.toFixed(2)}
            </span>
            <span className="text-xs text-text-dim">MP_proxy</span>
            <span className="ml-1 rounded-full bg-text-dim/10 px-2 py-0.5 text-[10px] text-text-muted">
              {mpLabel}
            </span>
          </div>
          {mp.notes.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {mp.notes.map((n, i) => (
                <p key={i} className="flex items-start gap-1 text-[10px] text-text-dim">
                  <AlertTriangle className="mt-0.5 size-2.5 shrink-0 text-warning" />
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-[11px] leading-relaxed text-text-muted">
        <p className="mb-1">
          An MP-inspired screening score for direct flicker visibility,
          computed from luminance sampled at {mp.sampleRateHz.toFixed(0)} Hz
          across {mp.numBins} frequency bins ({mp.freqRangeMin}–{mp.freqRangeMax} Hz).
        </p>
        <p className="mb-1">
          <strong className="text-text-main">Interpretation:</strong>{' '}
          MP_proxy &lt; 0.3 → very low, 0.3–1 → below typical threshold,
          1–3 → likely visible, ≥3 → strong. Values are a{' '}
          <em>video-based approximation</em>, not a formal photometric
          measurement (see About this measurement).
        </p>
        <p>
          Method: revised MP structure (Hann window + C_H = 1.225 correction) +
          MDT perceptual weighting (Kelly/de Lange CSF). Calibration against
          reference waveforms is pending — scores are directionally correct
          but not standards-certified.
        </p>
      </div>
    </div>
  );
}

function StatWithPopover({ label, value, warn, explanation }: {
  label: string;
  value: string;
  warn?: boolean;
  explanation: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${label}: ${value}`}
        className={`
          flex cursor-pointer flex-col rounded border px-2.5 py-1.5 text-left
          transition hover:border-accent/30 hover:bg-accent-dim/20
          ${warn ? 'border-warning/30 bg-warning/[0.04]' : 'border-border/50 bg-surface/50'}
        `}
      >
        <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
        <div className={`font-mono text-sm font-semibold tabular-nums ${warn ? 'text-warning' : 'text-text-main'}`}>
          {value}
        </div>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} align="center">
          <Popover.Popup className="max-w-64 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-muted shadow-lg">
            <Popover.Arrow className="fill-surface" />
            <strong className="mb-0.5 block text-text-main">{label}</strong>
            {explanation}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
