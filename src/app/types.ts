export type VideoMetadata = {
  duration: number;
  fpsNominal?: number;
  fpsAverage: number;
  isVfrLikely: boolean;
  width: number;
  height: number;
  codec: string;
};

export type Segment = {
  start: number;
  end: number;
};

export type LuminanceSample = {
  t: number;
  y: number;
};

export type PeakInfo = {
  freq: number;
  power: number;
  normalizedMagnitude: number;
};

export type TimingMetrics = {
  dutyCycle: number;
  meanOnPeriodMs: number;
  meanOffPeriodMs: number;
  numCycles: number;
  rmsJitterMs: number;
  crossingFrequency: number;
};

export type VerdictLabel = 'noel' | 'low-risk' | 'elevated' | 'high' | 'uncertain';

export type FlickerMetrics = {
  frequencyHz: number;
  modulationPercent: number;
  flickerIndex?: number;
  confidence: number;
  verdict: VerdictLabel;
  notes: string[];
  riskNotes: string[];
  spectralNotes: string[];
  spectrum: { freq: number; power: number }[];
  timeSeries: LuminanceSample[];
  topPeaks: PeakInfo[];
  timing: TimingMetrics | null;
  /** Effective sample rate used for the FFT (Hz). Computed from median inter-frame interval. */
  effectiveSampleRate: number;
  /** MP_proxy: video-based approximation of the MP flicker perception metric (3–80 Hz direct flicker). */
  mpProxy: MpProxyResult | null;
};

export type MpProxyResult = {
  /** Calibrated MP_proxy score (dimensionless). 1.0 ≈ 50% detection threshold for direct flicker. */
  value: number;
  /** Raw score before calibration scaling. */
  raw: number;
  /** Effective sample rate used (Hz). */
  sampleRateHz: number;
  /** Analyzed frequency range lower bound (Hz). */
  freqRangeMin: number;
  /** Analyzed frequency range upper bound (Hz). */
  freqRangeMax: number;
  /** Confidence in the result [0–1]. */
  confidence: number;
  /** Dominant frequency contributing to the MP score (Hz). */
  dominantBandHz: number;
  /** Number of usable FFT bins in the analysis band. */
  numBins: number;
  /** Warnings and assumptions. */
  notes: string[];
};

export type TherapyVerdict = 'strong-pass' | 'pass' | 'warning' | 'fail' | 'indeterminate';

export type TherapyCriterion = {
  key: string;
  label: string;
  pass: boolean | 'warning';
  value: string;
  target: string;
  explanation: string;
};

export type TherapyReport = {
  verdict: TherapyVerdict;
  score: number;
  criteria: TherapyCriterion[];
  redFlags: string[];
  summary: string;
};

export type AppView = 'upload' | 'metadata' | 'timeline' | 'analyzing' | 'results';

export type AppState = {
  view: AppView;
  file: File | null;
  metadata: VideoMetadata | null;
  segment: Segment | null;
  results: FlickerMetrics | null;
  error: string | null;
  progress: { current: number; total: number } | null;
};
