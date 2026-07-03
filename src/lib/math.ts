export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type PeakLabelType = 'fundamental' | 'harmonic' | 'subharmonic' | 'secondary';

export function getPeakLabel(fundamentalHz: number, peakFreq: number, peakIndex: number): PeakLabelType {
  if (peakIndex === 0) return 'fundamental';

  const n = Math.round(peakFreq / fundamentalHz);
  if (n >= 2) {
    const err = Math.abs(peakFreq - n * fundamentalHz);
    if (err <= Math.max(1, n * fundamentalHz * 0.01)) return 'harmonic';
  }

  const subN = Math.round(fundamentalHz / peakFreq);
  /* Cap subharmonic label to orders 2-6 to avoid absurd labels like /23
     when a noise peak aligns with a distant submultiple by coincidence. */
  if (subN >= 2 && subN <= 6) {
    const err = Math.abs(peakFreq * subN - fundamentalHz);
    if (err <= Math.max(1, fundamentalHz * 0.01)) return 'subharmonic';
  }

  return 'secondary';
}

const ORDINALS = ['2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

export function formatPeakLabel(fundamentalHz: number, peakFreq: number, peakIndex: number): string {
  const type = getPeakLabel(fundamentalHz, peakFreq, peakIndex);
  switch (type) {
    case 'fundamental':
      return 'Fundamental';
    case 'harmonic': {
      const n = Math.round(peakFreq / fundamentalHz);
      const ord = ORDINALS[n - 2] || `${n}th`;
      return `${ord} harmonic`;
    }
    case 'subharmonic': {
      const n = Math.round(fundamentalHz / peakFreq);
      return `Subharmonic (/${n})`;
    }
    case 'secondary':
      return 'Secondary';
  }
}
