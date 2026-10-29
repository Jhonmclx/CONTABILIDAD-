import { useEffect, useRef } from 'react';

/**
 * Fondo vivo: ondas fluidas, reflejos que recorren la escena y partículas con profundidad.
 * - "vivid": portada, login y bienvenida.  - "subtle": panel de trabajo (menos movimiento, 24 fps).
 * Respeta prefers-reduced-motion (dibuja un cuadro estático), se pausa en pestañas ocultas
 * y reduce densidad en móviles o equipos con pocos núcleos.
 */
export function LiveBackground({ variant = 'vivid' }: { variant?: 'vivid' | 'subtle' }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current!; const g = canvas.getContext('2d', { alpha: true })!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const lowPower = (navigator.hardwareConcurrency || 4) <= 2 || (navigator as any).connection?.saveData;
    const subtle = variant === 'subtle';
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
    let particles: { x: number; y: number; z: number; vx: number; vy: number; r: number; a: number }[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, subtle ? 1 : 1.5);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const density = subtle ? 0.000035 : lowPower ? 0.00005 : 0.00011;
      const n = Math.min(subtle ? 40 : 140, Math.round(w * h * density));
      particles = Array.from({ length: n }, () => {
        const z = Math.random();
        return { x: Math.random() * w, y: Math.random() * h, z, vx: (Math.random() - 0.5) * 0.08 * (1 + z), vy: -(0.05 + Math.random() * 0.18) * (0.4 + z), r: 0.4 + z * 1.8, a: 0.15 + z * 0.55 };
      });
    };

    const wave = (t: number, yBase: number, amp: number, len: number, speed: number, phase: number) => {
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w + 20; x += 20) {
        const y = yBase + Math.sin(x / len + t * speed + phase) * amp + Math.sin(x / (len * 0.47) - t * speed * 1.3 + phase * 2) * amp * 0.35;
        g.lineTo(x, y);
      }
      g.lineTo(w, h); g.closePath();
    };

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, w, h);
      const k = subtle ? 0.45 : 1;

      // Ondas esmeralda / azul con gradiente
      const layers = [
        { y: 0.62, amp: 38, len: 260, sp: 0.18, ph: 0, c1: 'rgba(16,185,129,', a: 0.16 },
        { y: 0.70, amp: 46, len: 340, sp: 0.12, ph: 1.7, c1: 'rgba(14,116,144,', a: 0.18 },
        { y: 0.80, amp: 30, len: 200, sp: 0.22, ph: 3.1, c1: 'rgba(52,211,153,', a: 0.10 },
      ];
      for (const L of layers) {
        wave(t, h * L.y, L.amp * (h / 900 + 0.4), L.len, L.sp, L.ph);
        const gr = g.createLinearGradient(0, h * (L.y - 0.1), 0, h);
        gr.addColorStop(0, L.c1 + (L.a * k) + ')'); gr.addColorStop(1, 'rgba(6,11,26,0)');
        g.fillStyle = gr; g.fill();
        // Borde iluminado de la ola
        wave(t, h * L.y, L.amp * (h / 900 + 0.4), L.len, L.sp, L.ph);
        g.strokeStyle = L.c1 + (0.22 * k) + ')'; g.lineWidth = 1; g.stroke();
      }

      // Reflejo luminoso que recorre la escena
      const sx = ((t * 0.06) % 1.6 - 0.3) * w;
      const sweep = g.createLinearGradient(sx - w * 0.25, 0, sx + w * 0.25, h);
      sweep.addColorStop(0, 'rgba(255,255,255,0)'); sweep.addColorStop(0.5, `rgba(167,243,208,${0.05 * k})`); sweep.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sweep; g.fillRect(0, 0, w, h);

      // Partículas con profundidad
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        const tw = 0.6 + 0.4 * Math.sin(t * (0.8 + p.z) + p.x);
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fillStyle = p.z > 0.85 ? `rgba(234,205,120,${p.a * tw * k})` : `rgba(190,255,230,${p.a * tw * k})`;
        g.fill();
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const minDt = subtle || lowPower ? 1000 / 24 : 1000 / 60;
      if (now - last < minDt) return;
      last = now; draw(now);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches) { draw(t0 + 4000); return; }   // cuadro estático
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());

    resize(); start();
    const ro = new ResizeObserver(() => { resize(); if (reduce.matches) draw(t0 + 4000); });
    ro.observe(canvas);
    document.addEventListener('visibilitychange', onVis);
    reduce.addEventListener('change', start);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); reduce.removeEventListener('change', start); };
  }, [variant]);

  return (
    <div className={`live-bg live-${variant}`} aria-hidden="true">
      <div className="aurora a1" /><div className="aurora a2" /><div className="aurora a3" />
      <canvas ref={ref} />
      <div className="grain" />
    </div>
  );
}
