import { useEffect, useRef } from 'react';

/**
 * ConfettiBurst — Canvas-based confetti / falling petals celebration.
 * Renders a fullscreen overlay of colorful particles that burst upward
 * then drift down with gravity, rotation, and slight wind.
 *
 * Props:
 *   trigger  — increment to fire a new burst (number)
 *   duration — how long particles live in ms (default 3500)
 */

const COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c084fc',  // purples
  '#3b82f6', '#60a5fa',                          // blues
  '#10b981', '#34d399',                          // greens
  '#f59e0b', '#fbbf24',                          // golds
  '#f43f5e', '#fb7185',                          // pinks
  '#ffffff',                                      // white sparkle
];

const SHAPES = ['rect', 'circle', 'star'];

function createParticle(canvasW, canvasH) {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2; // mostly upward
  const speed = 6 + Math.random() * 10;
  const size = 4 + Math.random() * 6;
  return {
    x: canvasW * (0.3 + Math.random() * 0.4),   // spawn in center 40%
    y: canvasH * (0.4 + Math.random() * 0.2),    // from middle area
    vx: Math.cos(angle) * speed * (0.7 + Math.random() * 0.6),
    vy: Math.sin(angle) * speed * (0.8 + Math.random() * 0.5),
    size,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.15,
    gravity: 0.06 + Math.random() * 0.06,
    drag: 0.985 + Math.random() * 0.01,
    wind: (Math.random() - 0.5) * 0.3,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.03 + Math.random() * 0.05,
    opacity: 1,
    fadeStart: 0.65 + Math.random() * 0.2, // fraction of life when fade begins
    life: 0,
    maxLife: 1,
  };
}

function drawStar(ctx, x, y, size, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const spikes = 5;
  const outerR = size;
  const innerR = size * 0.4;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export default function ConfettiBurst({ trigger, duration = 3500 }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const particlesRef = useRef([]);
  const lastTriggerRef = useRef(0);

  useEffect(() => {
    if (!trigger || trigger === lastTriggerRef.current) return;
    lastTriggerRef.current = trigger;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Size canvas to viewport
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Generate particles
    const count = 80 + Math.floor(Math.random() * 40);
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      newParticles.push(createParticle(w, h));
    }
    particlesRef.current = newParticles;

    const startTime = performance.now();
    canvas.style.opacity = '1';
    canvas.style.pointerEvents = 'none';

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      ctx.clearRect(0, 0, w, h);

      let alive = 0;

      for (const p of particlesRef.current) {
        p.life = progress;

        // Physics
        p.vy += p.gravity;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.vx += p.wind;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.wobble += p.wobbleSpeed;

        // Wobble lateral drift
        p.x += Math.sin(p.wobble) * 0.5;

        // Fade out
        if (progress > p.fadeStart) {
          p.opacity = Math.max(0, 1 - (progress - p.fadeStart) / (1 - p.fadeStart));
        }

        if (p.opacity <= 0 || p.y > h + 50) continue;
        alive++;

        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
          ctx.restore();
        } else if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          drawStar(ctx, p.x, p.y, p.size * 0.5, p.rotation);
        }
      }

      ctx.globalAlpha = 1;

      if (alive > 0 && progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        canvas.style.opacity = '0';
      }
    }

    // Cancel any previous animation
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(animate);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [trigger, duration]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        pointerEvents: 'none',
        opacity: 0,
        transition: 'opacity 0.3s ease',
      }}
    />
  );
}
