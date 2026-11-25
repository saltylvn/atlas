"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The resume PDF in a frame that always shows the whole page width. A phone draws a framed
 * PDF at its own full size and ignores the frame's size, which cut the edges off. So the
 * frame is made exactly as large as the page, then the whole frame is shrunk to fit the
 * screen. On a wide screen it is shown at full size.
 */
export function ResumeFrame({ src, width, height }: { src: string; width: number; height: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [width]);
  return (
    <div ref={box} className="w-full overflow-hidden rounded-lg border border-line bg-surface" style={{ height: Math.ceil(height * scale) }}>
      <iframe src={`${src}#view=FitH&navpanes=0&toolbar=0`} title="Your resume PDF" width={width} height={height} style={{ width, height, border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }} />
    </div>
  );
}
