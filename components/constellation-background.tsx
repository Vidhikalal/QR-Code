"use client";

import { useEffect, useRef } from "react";
// Ported from datafest-website/src/components/ConstellationBackground.tsx.

/**
 * Quiet graph-network background. Sparse nodes drift very slowly across the
 * viewport; lines are drawn between any pair within CONNECT_DIST, with line
 * opacity falling off as the pair separates. Reads as a "data field" without
 * the constant motion of the binary rain.
 *
 * The field also reacts to the cursor: nodes within POINTER_DIST link to the
 * pointer and drift gently toward it, so the graph "notices" the visitor.
 * Pointer coupling is skipped entirely under prefers-reduced-motion.
 */
const DRIFT_SPEED = 0.06;     // max px per 60 Hz frame per axis — barely perceptible
const CONNECT_DIST = 130;     // px below which two nodes get linked
const BASE_BG = "rgb(6, 21, 72)";
const NODE_COLOR = "rgba(184, 220, 255, 0.55)";
const LINE_PEAK_ALPHA = 0.18; // line alpha when two nodes are touching
const POINTER_DIST = 190;         // px below which a node links to the cursor
const POINTER_LINE_PEAK_ALPHA = 0.32;
const POINTER_PULL = 0.006;       // fraction of node→cursor distance applied per 60 Hz frame
const POINTER_DEAD_ZONE = 48;     // px — stop pulling so nodes don't pile on the cursor
const FRAME_60 = 1000 / 60;
const MIN_FRAME_MS = FRAME_60 - 2; // ~60 fps cap: 120 Hz screens draw every other frame

export default function ConstellationBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Cap at 1.5 — full DPR doubles pixel write cost on retina with negligible visual gain for sparse dots.
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5);
    let width = 0;
    let height = 0;

    type Node = { x: number; y: number; vx: number; vy: number; r: number };
    let nodes: Node[] = [];

    const resize = () => {
      // Phones fire height-only resizes as the address bar collapses; keep the field then.
      const reseed = window.innerWidth !== width;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!reseed) return;

      // Scale node count by area. Lower density keeps the O(n²) pair-check cheap.
      const area = width * height;
      const count = Math.round(Math.max(40, Math.min(110, area / 22000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * DRIFT_SPEED * 2,
        vy: (Math.random() - 0.5) * DRIFT_SPEED * 2,
        r: 0.8 + Math.random() * 1.4,
      }));
    };

    resize();

    // Pointer coupling. Input-driven, but skipped under reduced motion since
    // it also perturbs node positions.
    const pointer = { x: 0, y: 0, active: false };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = !reduced;
    };
    const onPointerGone = () => {
      pointer.active = false;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerGone);
    window.addEventListener("blur", onPointerGone);

    const CONNECT_DIST_SQ = CONNECT_DIST * CONNECT_DIST;

    // `step` is elapsed time in 60 Hz frames, so speed is the same at any refresh rate; 0 draws a still frame.
    const draw = (step: number) => {
      ctx.fillStyle = BASE_BG;
      ctx.fillRect(0, 0, width, height);

      // Drift + wrap
      for (const n of nodes) {
        n.x += n.vx * step;
        n.y += n.vy * step;
        if (n.x < -12) n.x = width + 12;
        else if (n.x > width + 12) n.x = -12;
        if (n.y < -12) n.y = height + 12;
        else if (n.y > height + 12) n.y = -12;
      }

      // Lines between nearby pairs. Early-exit on axis distance before the
      // sqrt — skips the vast majority of pairs at O(1) cost each.
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (!a) continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          if (!b) continue;
          const dx = a.x - b.x;
          if (dx > CONNECT_DIST || dx < -CONNECT_DIST) continue;
          const dy = a.y - b.y;
          if (dy > CONNECT_DIST || dy < -CONNECT_DIST) continue;
          const distSq = dx * dx + dy * dy;
          if (distSq < CONNECT_DIST_SQ) {
            const t = 1 - Math.sqrt(distSq) / CONNECT_DIST;
            ctx.strokeStyle = `rgba(184, 220, 255, ${(t * LINE_PEAK_ALPHA).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Cursor links + gentle attraction
      if (pointer.active && !reduced) {
        for (const n of nodes) {
          const dx = pointer.x - n.x;
          if (dx > POINTER_DIST || dx < -POINTER_DIST) continue;
          const dy = pointer.y - n.y;
          if (dy > POINTER_DIST || dy < -POINTER_DIST) continue;
          const distSq = dx * dx + dy * dy;
          if (distSq >= POINTER_DIST * POINTER_DIST) continue;
          const dist = Math.sqrt(distSq);
          const t = 1 - dist / POINTER_DIST;
          ctx.strokeStyle = `rgba(184, 220, 255, ${(t * POINTER_LINE_PEAK_ALPHA).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
          if (dist > POINTER_DEAD_ZONE) {
            const pull = Math.min(1, POINTER_PULL * t * step);
            n.x += dx * pull;
            n.y += dy * pull;
          }
        }
      }

      // Nodes on top
      ctx.fillStyle = NODE_COLOR;
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let rafId = 0;
    let last = 0;
    const loop = (now: number) => {
      rafId = 0;
      if (reduced || document.hidden) return;
      rafId = requestAnimationFrame(loop);
      if (last && now - last < MIN_FRAME_MS) return;
      // Clamp so a stall (or a long frame) never teleports the nodes.
      const step = last ? Math.min(now - last, 100) / FRAME_60 : 1;
      last = now;
      draw(step);
    };
    // Every (re)start cancels the pending frame first, so hide/show never stacks loops.
    const start = () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
      last = 0;
      // Reduced motion: one still frame, drawn now even in a background tab.
      if (reduced) draw(0);
      else if (!document.hidden) rafId = requestAnimationFrame(loop);
    };

    const onVis = () => { if (!document.hidden) start(); };
    const onMotionChange = () => {
      reduced = motionQuery.matches;
      pointer.active = false;
      start();
    };
    const onResize = () => {
      resize();
      if (reduced) draw(0); // resizing clears the canvas; the loop repaints on its own
    };
    document.addEventListener("visibilitychange", onVis);
    motionQuery.addEventListener("change", onMotionChange);
    window.addEventListener("resize", onResize);
    start();

    return () => {
      cancelAnimationFrame(rafId);
      motionQuery.removeEventListener("change", onMotionChange);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerGone);
      window.removeEventListener("blur", onPointerGone);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        background: BASE_BG,
      }}
    />
  );
}
