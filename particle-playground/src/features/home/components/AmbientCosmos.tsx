"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  drift: number;
};

/**
 * Lightweight cosmic backdrop for the home screen. Canvas 2D only — no Three.js
 * so the entry page stays fast. Honors prefers-reduced-motion.
 */
export function AmbientCosmos() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const surface = canvas;
    const paint = context;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let frameId = 0;
    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let time = 0;

    function resize() {
      const parent = surface.parentElement;
      if (!parent) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = parent.clientWidth;
      height = parent.clientHeight;
      surface.width = Math.max(1, Math.floor(width * dpr));
      surface.height = Math.max(1, Math.floor(height * dpr));
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      paint.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(140, Math.floor((width * height) / 12000));
      stars = [];
      for (let index = 0; index < count; index += 1) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.4 + Math.random() * 1.6,
          a: 0.15 + Math.random() * 0.55,
          speed: 0.15 + Math.random() * 0.45,
          drift: (Math.random() - 0.5) * 0.2,
        });
      }
    }

    function draw(staticOnly: boolean) {
      paint.clearRect(0, 0, width, height);

      const glow = paint.createRadialGradient(
        width * 0.55,
        height * 0.35,
        0,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.75,
      );
      glow.addColorStop(0, "rgba(34, 211, 238, 0.12)");
      glow.addColorStop(0.35, "rgba(14, 116, 144, 0.08)");
      glow.addColorStop(0.7, "rgba(15, 23, 42, 0.2)");
      glow.addColorStop(1, "rgba(2, 6, 23, 0.95)");
      paint.fillStyle = glow;
      paint.fillRect(0, 0, width, height);

      const ribbon = paint.createLinearGradient(0, height * 0.6, width, height * 0.9);
      ribbon.addColorStop(0, "rgba(251, 191, 36, 0)");
      ribbon.addColorStop(0.45, "rgba(45, 212, 191, 0.08)");
      ribbon.addColorStop(1, "rgba(56, 189, 248, 0)");
      paint.fillStyle = ribbon;
      paint.beginPath();
      paint.moveTo(0, height * 0.72);
      paint.quadraticCurveTo(width * 0.4, height * 0.55, width, height * 0.8);
      paint.lineTo(width, height);
      paint.lineTo(0, height);
      paint.closePath();
      paint.fill();

      for (const star of stars) {
        if (!staticOnly) {
          star.y -= star.speed * 0.35;
          star.x += star.drift;
          if (star.y < -4) {
            star.y = height + 4;
            star.x = Math.random() * width;
          }
          if (star.x < -4) {
            star.x = width + 4;
          }
          if (star.x > width + 4) {
            star.x = -4;
          }
        }

        const twinkle = staticOnly
          ? star.a
          : star.a * (0.65 + 0.35 * Math.sin(time * star.speed + star.x));
        paint.beginPath();
        paint.fillStyle = `rgba(226, 232, 240, ${twinkle})`;
        paint.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        paint.fill();
      }
    }

    function tick() {
      time += 0.016;
      draw(false);
      frameId = requestAnimationFrame(tick);
    }

    resize();
    draw(reduced);
    if (!reduced) {
      frameId = requestAnimationFrame(tick);
    }

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
