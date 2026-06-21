import { useState, useCallback, useRef } from 'react';
import { openVideoFile } from '../media/mediabunny-input';
import { extractLuminanceSamples } from '../media/frame-extractor';
import { analyzeSamples, terminateWorker } from '../analysis/analysis-worker-client';
import type { VideoMetadata, Segment, FlickerMetrics } from '../app/types';

export type AnalysisState = {
  running: boolean;
  progress: { current: number; total: number } | null;
  results: FlickerMetrics | null;
  error: string | null;
};

export function useAnalysis() {
  const abortRef = useRef(false);
  const [state, setState] = useState<AnalysisState>({
    running: false,
    progress: null,
    results: null,
    error: null,
  });

  const runAnalysis = useCallback(async (file: File, metadata: VideoMetadata, segment: Segment) => {
    abortRef.current = false;
    setState({ running: true, progress: null, results: null, error: null });

    try {
      const { videoTrack } = await openVideoFile(file);

      if (abortRef.current) return;

      const samples = await extractLuminanceSamples(
        videoTrack,
        metadata,
        segment.start,
        segment.end,
        (current, total) => {
          if (!abortRef.current) {
            setState((s) => ({ ...s, progress: { current, total } }));
          }
        },
      );

      if (abortRef.current || samples.length === 0) {
        setState((s) => ({ ...s, running: false, error: samples.length === 0 ? 'No frames in selected segment' : 'Analysis cancelled' }));
        return;
      }

      const results = await analyzeSamples(samples);

      if (!abortRef.current) {
        setState({ running: false, progress: null, results, error: null });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      if (!abortRef.current) {
        setState({ running: false, progress: null, results: null, error: msg });
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current = true;
    terminateWorker();
    setState({ running: false, progress: null, results: null, error: 'Analysis cancelled' });
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    terminateWorker();
    setState({ running: false, progress: null, results: null, error: null });
  }, []);

  return { ...state, runAnalysis, cancel, reset };
}
