import { VideoSampleSink, InputVideoTrack } from 'mediabunny';
import { extractLuminanceFromSample } from './luminance';
import type { LuminanceSample, VideoMetadata } from '../app/types';

/**
 * Average frame rate from demuxer packet statistics.
 *
 * Uses Mediabunny's computePacketStats().averagePacketRate which examines the
 * container-level packet timestamps rather than decoded sample timestamps.
 * This avoids timing jitter introduced by the decode pipeline and provides
 * a stable average frame rate even for VFR content.
 */
export async function getTrackFrameRateInfo(
  videoTrack: InputVideoTrack,
): Promise<{ fpsAverage: number; packetCount: number }> {
  const stats = await videoTrack.computePacketStats();
  return {
    fpsAverage: stats.averagePacketRate,
    packetCount: stats.packetCount,
  };
}

/**
 * Variable frame rate (VFR) detection via inter-frame interval variability.
 *
 * Decodes the first `sampleCount` frames and measures the coefficient of
 * variation (CV = σ / μ) of consecutive timestamp deltas.
 *
 * The 0.02 CV threshold is a heuristic:
 *   - CFR content (e.g. 59.94 Hz) typically has CV < 0.001
 *   - Mild VFR (pulldown, edit gaps) typically has CV 0.005–0.02
 *   - True VFR (phone slow-motion with dropped frames) has CV > 0.02
 *
 * NumPy-style MAD or robust CV could be more outlier-resistant, but sample
 * timestamps from Mediabunny reflect media timeline position, not decode
 * jitter, so raw CV is reliable for this use case.
 */
export async function detectVariableFrameRate(
  videoTrack: InputVideoTrack,
  sampleCount = 180,
): Promise<{ isVfrLikely: boolean; variability: number }> {
  const sink = new VideoSampleSink(videoTrack);
  const ts: number[] = [];

  for await (const sample of sink.samples()) {
    ts.push(sample.timestamp);
    sample.close();
    if (ts.length >= sampleCount) break;
  }

  if (ts.length < 3) return { isVfrLikely: false, variability: 0 };

  const dts: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i] - ts[i - 1];
    if (dt > 0) dts.push(dt);
  }

  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  const variance = dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length;
  const cv = Math.sqrt(variance) / mean;

  // Heuristic CV threshold described above
  return { isVfrLikely: cv > 0.02, variability: cv };
}

/**
 * Extract per-frame luminance samples for a time segment.
 *
 * The luminance values are linear-light Rec. 709 (see luminance.ts).
 * Timestamps are from Mediabunny in seconds (media timeline, not wall clock).
 *
 * The totalFrames estimate is approximate (used only for progress UI);
 * the FFT analysis in the worker computes effective sample rate from the
 * actual timestamps it receives.
 */
export async function extractLuminanceSamples(
  videoTrack: InputVideoTrack,
  metadata: VideoMetadata,
  startTime: number,
  endTime: number,
  onProgress?: (current: number, total: number) => void,
): Promise<LuminanceSample[]> {
  const samples: LuminanceSample[] = [];
  const fps = metadata.fpsAverage;
  const totalFrames = Math.round((endTime - startTime) * fps);

  const sink = new VideoSampleSink(videoTrack);
  const canvas = new OffscreenCanvas(64, 36);
  const ctx = canvas.getContext('2d')!;
  let frameIndex = 0;

  for await (const sample of sink.samples(startTime, endTime)) {
    const y = extractLuminanceFromSample(canvas, ctx, (c) => {
      sample.draw(c, 0, 0, 64, 36);
    });
    samples.push({ t: sample.timestamp, y });
    sample.close();
    frameIndex++;
    onProgress?.(frameIndex, totalFrames);
  }

  return samples;
}
