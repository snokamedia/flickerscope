import {
  BlobSource,
  Input,
  ALL_FORMATS,
  InputVideoTrack,
} from 'mediabunny';

export type TrackInfo = {
  videoTrack: InputVideoTrack;
  duration: number;
};

export async function openVideoFile(file: File): Promise<TrackInfo> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  const videoTrack = await input.getPrimaryVideoTrack();
  const duration = await input.computeDuration();

  if (!videoTrack) {
    throw new Error('No video track found in this file');
  }

  return { videoTrack, duration };
}
