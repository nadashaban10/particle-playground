"use client";

import { useEffect, useRef } from "react";
import { handDetectionSource } from "@/shared/lib/hand-detection-source";
import { handInteractionSource } from "@/shared/lib/hand-interaction-source";

/**
 * Development-only readout of the latest interaction samples. Updates a DOM
 * node from requestAnimationFrame so it never drives React state.
 */
export function HandInteractionDiagnostic() {
  const readoutRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      const readout = readoutRef.current;
      if (readout) {
        readout.textContent = describeFrame(
          handInteractionSource.current,
          handDetectionSource.detectedAt,
          performance.now(),
        );
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <p
      ref={readoutRef}
      className="max-h-28 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-cyan-100/90"
      aria-live="off"
    >
      samples: 0
    </p>
  );
}

function describeFrame(
  samples: readonly {
    key: string;
    valid: boolean;
    pinchRatio: number;
    pinchPoint: { x: number; y: number; z: number };
  }[],
  detectedAt: number,
  now: number,
): string {
  const age =
    Number.isFinite(detectedAt) && detectedAt > Number.NEGATIVE_INFINITY
      ? `${Math.max(0, Math.round(now - detectedAt))}ms`
      : "n/a";

  const header = `samples: ${samples.length}  age: ${age}`;
  if (samples.length === 0) {
    return header;
  }

  const lines = samples.map((sample) => {
    const { x, y, z } = sample.pinchPoint;
    const ratio = Number.isFinite(sample.pinchRatio)
      ? sample.pinchRatio.toFixed(2)
      : "n/a";
    return `${sample.key}${sample.valid ? "" : "?"} r=${ratio} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
  });

  return `${header}\n${lines.join("\n")}`;
}
