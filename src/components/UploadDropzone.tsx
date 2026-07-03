import { type DragEvent, type ChangeEvent, useState } from 'react';
import { Upload, ExternalLink } from 'lucide-react';

type Props = {
  onFile: (file: File) => void;
  disabled?: boolean;
};

export function UploadDropzone({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) onFile(file);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`
        rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${dragging
          ? 'border-accent bg-accent-dim'
          : 'border-border hover:border-accent/50 hover:bg-accent-dim/30'
        }
      `}
    >
      <Upload className="mx-auto mb-3 size-10 text-text-dim" />
      <p className="mb-1 text-base font-medium text-text-main">
        Drop a slow motion video here
      </p>
      <p className="mb-1 text-xs text-text-muted">
        Ideally 240 fps, 1–3 seconds &middot; H.264 / H.265 / VP9
      </p>
      <a
        href="https://github.com/snokamedia/flickerscope/wiki/Capturing-Video-for-FlickerScope"
        target="_blank"
        rel="noopener noreferrer"
        className="my-4 flex items-center justify-center gap-1 text-xs text-accent transition-colors hover:text-cyan-300"
      >
        <ExternalLink className="size-3" />
        Capture guide &mdash; how to record the right video
      </a>
      <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300 w-full sm:w-auto">
        <Upload className="size-4" />
        Choose file
        <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" hidden onChange={handleChange} />
      </label>
    </div>
  );
}
