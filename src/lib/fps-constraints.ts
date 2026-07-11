export type FpsTier = 'reject' | 'limited' | 'adequate';

export function getFpsTier(fps: number): FpsTier {
  if (fps < 120) return 'reject';
  if (fps < 240) return 'limited';
  return 'adequate';
}
