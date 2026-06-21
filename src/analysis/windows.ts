export type WindowType = 'hann' | 'hamming' | 'blackman';

export function applyWindow(data: Float64Array, type: WindowType): Float64Array {
  const n = data.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = windowValue(i, n, type);
    out[i] = data[i] * w;
  }
  return out;
}

function windowValue(i: number, n: number, type: WindowType): number {
  const a = (2 * Math.PI * i) / (n - 1);
  switch (type) {
    case 'hann':
      return 0.5 * (1 - Math.cos(a));
    case 'hamming':
      return 0.54 - 0.46 * Math.cos(a);
    case 'blackman':
      return 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
  }
}

export function detrend(data: Float64Array): Float64Array {
  const n = data.length;
  const sumX = (n - 1) * n / 2;
  const sumY = data.reduce((a, b) => a + b, 0);
  const sumXY = data.reduce((a, y, i) => a + i * y, 0);
  const sumX2 = data.reduce((a, _, i) => a + i * i, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = data[i] - (slope * i + intercept);
  }
  return out;
}
