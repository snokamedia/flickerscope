import { VideoSampleSink, InputVideoTrack } from 'mediabunny';
import { extractLuminanceFromSample } from './luminance';
import type { LuminanceSample, VideoMetadata } from '../app/types';

export type TrackFrameRateInfo = {
  /**
   * Best-guess intended frame rate from Mediabunny's lattice fit
   * (underlying CFR rate when confident, else snapped/median fallback).
   * Used for tier gates and UI display — never file container metadata.
   */
  fpsDecoded: number;
  /** Average frames/sec across probed packet timestamps. */
  fpsAverage: number;
  /** True when no consistent underlying CFR lattice was found (true VFR). */
  isVfrLikely: boolean;
  /** True only for clean CFR with no dropped frames. */
  frameRateIsConstant: boolean;
  /** Total packets inspected (full file when scanning with Infinity). */
  frameCount: number;
  /** Confirmed underlying CFR rate, or null for VFR. */
  underlyingFrameRate: number | null;
};

/**
 * Frame-rate metadata from Mediabunny's computeFrameRateMetrics().
 *
 * Uses encoded-packet timestamps only (metadataOnly — no decode). The
 * library models inter-frame gaps as integer multiples of one period
 * (handles dropped frames), requires a high inlier ratio, and snaps to
 * known rates including NTSC (239.76, 119.88, …). This replaces both
 * container averagePacketRate and our old 180-frame decoded CV heuristic.
 *
 * targetPacketCount: Infinity scans the whole file so frameCount and
 * frameRateIsConstant are not limited to a short prefix.
 */
export async function getTrackFrameRateInfo(
  videoTrack: InputVideoTrack,
): Promise<TrackFrameRateInfo> {
  const metrics = await videoTrack.computeFrameRateMetrics({
    targetPacketCount: Infinity,
  });

  return {
    fpsDecoded: metrics.bestGuessFrameRate,
    fpsAverage: metrics.averageFrameRate,
    isVfrLikely: metrics.underlyingFrameRate === null,
    frameRateIsConstant: metrics.frameRateIsConstant,
    frameCount: metrics.probedPacketCount,
    underlyingFrameRate: metrics.underlyingFrameRate,
  };
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
  const fps = metadata.fpsDecoded || metadata.fpsAverage;
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
