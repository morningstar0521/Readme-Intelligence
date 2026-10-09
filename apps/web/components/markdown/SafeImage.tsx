'use client';

import { useState, type ImgHTMLAttributes } from 'react';
import { ImageOff, ShieldOff } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { useSettings } from '@/lib/settings';

type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  'data-unavailable'?: string;
  'data-line'?: number | string;
  /** True when the image is wrapped in a link (then a click follows the link instead of zooming). */
  inLink?: boolean;
};

function Placeholder({ text, path }: { text: string; path?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-btn border border-dashed border-border px-2 py-1 align-middle text-xs text-fg-2">
      <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
      {path && <code className="truncate font-mono">{path}</code>}
    </span>
  );
}

/**
 * Image renderer (UI spec 7.4): lazy loading, "Image unavailable" with the path on error or
 * for relative images in local / pasted READMEs, optional remote image blocking, and a zoom modal.
 */
export function SafeImage({ inLink = false, ...props }: SafeImageProps) {
  const { blockRemoteImages } = useSettings();
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [allowOnce, setAllowOnce] = useState(false);
  const unavailable = props['data-unavailable'];
  const src = typeof props.src === 'string' ? props.src : undefined;
  const alt = props.alt ?? '';

  if (unavailable !== undefined || !src) {
    return <Placeholder text="Image unavailable" path={unavailable && unavailable !== 'blocked' ? unavailable : undefined} />;
  }
  if (failed) return <Placeholder text="Image unavailable" path={src} />;

  const isRemote = /^https?:/i.test(src);
  if (blockRemoteImages && isRemote && !allowOnce) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAllowOnce(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-btn border border-dashed border-border px-2 py-1 align-middle text-xs text-fg-2 hover:bg-hover"
        title={src}
      >
        <ShieldOff className="h-3.5 w-3.5" aria-hidden /> Remote image blocked{alt ? `: ${alt}` : ''} (click to load)
      </button>
    );
  }

  const { 'data-unavailable': _unavailable, ...imgProps } = props;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote README images of unknown size; next/image needs known hosts */}
      <img
        {...imgProps}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        onClick={
          inLink
            ? undefined
            : () => {
                setZoom(true);
              }
        }
        className={inLink ? undefined : 'cursor-zoom-in'}
      />
      {!inLink && (
        <Modal open={zoom} onClose={() => setZoom(false)} title={alt || 'Image'} className="max-w-5xl">
          <div className="flex max-h-[80vh] items-center justify-center overflow-auto bg-surface p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} referrerPolicy="no-referrer" className="max-h-[75vh] max-w-full object-contain" />
          </div>
        </Modal>
      )}
    </>
  );
}
