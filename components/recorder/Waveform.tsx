"use client";

import { useEffect, useRef } from "react";

/**
 * Driven by real AnalyserNode data. A fake animation is a lie about whether
 * the mic is working, and "was it recording?" is the user's biggest anxiety —
 * so this stays live even under prefers-reduced-motion. It is an instrument
 * reading, not decoration.
 */
export function Waveform({
  analyser,
  className,
}: {
  analyser: AnalyserNode | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const samples = new Uint8Array(analyser.fftSize);
    const history: number[] = [];
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      analyser.getByteTimeDomainData(samples);

      // RMS of this frame, kept as a scrolling history of bars.
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);

      const barWidth = 3;
      const gap = 2;
      const barCount = Math.max(1, Math.floor(width / (barWidth + gap)));
      history.push(rms);
      while (history.length > barCount) history.shift();

      const styles = getComputedStyle(canvas);
      const ink = styles.getPropertyValue("--ink-2").trim() || "#5b6178";
      const live = styles.getPropertyValue("--live").trim() || "#d93b3b";

      history.forEach((value, index) => {
        // sqrt curve so quiet speech is still visibly moving
        const amplitude = Math.min(1, Math.sqrt(value) * 2.2);
        const barHeight = Math.max(2, amplitude * height);
        const x = index * (barWidth + gap);
        const y = (height - barHeight) / 2;

        context.fillStyle = index === history.length - 1 ? live : ink;
        context.globalAlpha = index === history.length - 1 ? 1 : 0.55;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      });
      context.globalAlpha = 1;
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
