import { useState, useCallback } from 'react';
import { openVideoFile } from '../media/mediabunny-input';
import { getTrackFrameRateInfo, detectVariableFrameRate } from '../media/frame-extractor';
import type { VideoMetadata } from '../app/types';

export type VideoFileState = {
  file: File | null;
  metadata: VideoMetadata | null;
  loading: boolean;
  error: string | null;
  videoUrl: string | null;
};

export function useVideoFile() {
  const [state, setState] = useState<VideoFileState>({
    file: null,
    metadata: null,
    loading: false,
    error: null,
    videoUrl: null,
  });

  const loadFile = useCallback(async (file: File) => {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);

    setState((s) => ({ ...s, file, loading: true, error: null, metadata: null, videoUrl: null }));

    try {
      const { videoTrack, duration } = await openVideoFile(file);

      const codecInfo = await videoTrack.getCodec();
      const codec = codecInfo ?? 'unknown';
      const { fpsAverage } = await getTrackFrameRateInfo(videoTrack);
      const { isVfrLikely } = await detectVariableFrameRate(videoTrack);
      const displayWidth = await videoTrack.getDisplayWidth();
      const displayHeight = await videoTrack.getDisplayHeight();

      const metadata: VideoMetadata = {
        duration,
        fpsAverage,
        isVfrLikely,
        width: displayWidth,
        height: displayHeight,
        codec,
      };

      const videoUrl = URL.createObjectURL(file);

      setState((s) => ({ ...s, metadata, videoUrl, loading: false }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load video';
      setState((s) => ({ ...s, error: msg, loading: false }));
    }
  }, [state.videoUrl]);

  const reset = useCallback(() => {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    setState({ file: null, metadata: null, loading: false, error: null, videoUrl: null });
  }, [state.videoUrl]);

  return { ...state, loadFile, reset };
}
