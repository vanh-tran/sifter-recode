'use client';

import React, { useEffect, useRef, useMemo, useState } from 'react';
import { heroOverlayContent } from './heroOverlayContent'; 

const CHARS = '#@$%+=*:·. ';
// Wide-range grayscale for high contrast on white background.
const CHAR_TONES = ['#020617', '#1e293b', '#334155', '#64748b', '#94a3b8'] as const;

// Spin tuning:
// - Negative auto speed = left spin
// - Positive auto speed = right spin
const AUTO_SPIN_SPEED = -0.10; // radians / second (default: auto spin left)
const WHEEL_DELTA_TO_VELOCITY = 0.0032; // wheel delta -> angular velocity
const WHEEL_MAX_BOOST = 1.2; // clamp for wheel-added angular velocity
const WHEEL_DAMPING_PER_60FPS = 0.9; // wheel momentum falloff

// Compact continent outlines: [lat, lon] polygons (stylised)
const CONTINENTS: [number, number][][] = [
  [[70,-140],[70,-60],[20,-60],[15,-90],[20,-105],[30,-110],[50,-130],[70,-140]],
  [[12,-72],[10,-60],[0,-50],[-10,-37],[-35,-57],[-55,-68],[-35,-72],[0,-78],[12,-72]],
  [[70,30],[70,10],[55,5],[43,5],[36,15],[40,28],[50,30],[70,30]],
  [[35,10],[35,40],[20,45],[0,42],[-35,25],[-35,18],[0,10],[10,20],[20,15],[35,10]],
  [[70,30],[70,180],[40,180],[30,120],[20,110],[10,100],[20,90],[30,70],[40,60],[55,60],[70,60],[70,30]],
  [[-15,130],[-15,145],[-40,148],[-38,140],[-32,120],[-22,114],[-15,130]],
];

const FONT_SIZE_PX = 11; // Used for cols/rows calculation; display size via .hero-globe-pre
const LINE_HEIGHT = 1.15;
// Globe frame size (easy to tune)

function pointInPolygon(lat: number, lon: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function rasterizeContinent(polygon: [number, number][]): [number, number][] {
  const pts: [number, number][] = [];
  const lats = polygon.map(p => p[0]);
  const lons = polygon.map(p => p[1]);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  for (let lat = latMin; lat <= latMax; lat += 2) {
    for (let lon = lonMin; lon <= lonMax; lon += 2) {
      if (pointInPolygon(lat, lon, polygon)) {
        pts.push([lat * Math.PI / 180, lon * Math.PI / 180]);
      }
    }
  }
  return pts;
}

export default function ClientHeroGlobe() {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const wheelSpinVelocityRef = useRef(0);
  const lastTimeRef = useRef(0);
  const frameRef = useRef(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [dims, setDims] = useState({ cols: 110, rows: 34 });

  const landPatches = useMemo(() => CONTINENTS.flatMap(rasterizeContinent), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function recalc() {
      const node = containerRef.current;
      const preNode = preRef.current;
      if (!node || !preNode) return;
      const actualFontSize = parseFloat(getComputedStyle(preNode).fontSize) || FONT_SIZE_PX;
      const charWidth = actualFontSize * 0.62;
      const charHeight = actualFontSize * LINE_HEIGHT;
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (width < 10 || height < 10) return;
      const cols = Math.min(130, Math.floor(width / charWidth));
      const rows = Math.min(50, Math.floor(height / charHeight));
      setDims({ cols, rows });
    }

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    const { cols, rows } = dims;

    function render(ts: number) {
      const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = ts;

      // Auto-spin + temporary wheel momentum
      angleRef.current += dt * (AUTO_SPIN_SPEED + wheelSpinVelocityRef.current);
      const damping = Math.pow(WHEEL_DAMPING_PER_60FPS, dt * 60);
      wheelSpinVelocityRef.current *= damping;

      const A = angleRef.current;

      const output: string[] = [];

      for (let row = 0; row < rows; row++) {
        const line: string[] = [];
        const lineTone: number[] = [];
        for (let col = 0; col < cols; col++) {
          const x = (col / (cols - 1)) * 2 - 1;
          const y = -((row / (rows - 1)) * 2 - 1);
          // Divisor = LINE_HEIGHT / charWidthRatio ≈ 1.15 / 0.62 makes the globe circular
          const ax = x * (cols / rows / (LINE_HEIGHT / 0.42));
          const ay = y;
          const d2 = ax * ax + ay * ay;

          if (d2 > 1) {
            line.push(' ');
            lineTone.push(CHAR_TONES.length - 1);
            continue;
          }

          const az = Math.sqrt(1 - d2);

          // Lighting
          const llen = Math.sqrt(0.25 + 0.49 + 0.25);
          const diffuse = Math.max(0, (ax * -0.5 + ay * 0.7 + az * 0.5) / llen);
          const brightness0 = 0.15 + 0.85 * diffuse;

          // Lat / lon with rotation
          const theta = Math.acos(Math.max(-1, Math.min(1, ay)));
          const phi = Math.atan2(ax, az) + A;
          const lat = Math.PI / 2 - theta;
          const lon = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const lonC = lon > Math.PI ? lon - 2 * Math.PI : lon;

          let isLand = false;
          for (const [plat, plon] of landPatches) {
            if (Math.abs(lat - plat) < 0.055 && Math.abs(lonC - plon) < 0.055) {
              isLand = true;
              break;
            }
          }

          let cb = brightness0;
          // Land is brighter (visually = darker/denser char), more contrast vs ocean
          if (isLand) cb = Math.min(1, brightness0 * 1.6 + 0.18);

          const idx = Math.floor((1 - cb) * (CHARS.length - 1));
          line.push(CHARS[Math.max(0, Math.min(CHARS.length - 1, idx))]);

          // Quantize brightness into text color tones.
          // High brightness (land) -> Low index (Dark color)
          const tone = Math.max(
            0,
            Math.min(CHAR_TONES.length - 1, Math.floor((1 - cb) * CHAR_TONES.length))
          );
          lineTone.push(tone);
        }

        // Run-length encode contiguous chars of same tone to keep DOM light.
        let htmlLine = '';
        let runTone = lineTone[0] ?? 0;
        let run = '';
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]!;
          const tone = lineTone[i] ?? runTone;
          if (i === 0) {
            runTone = tone;
            run = ch;
            continue;
          }
          if (tone === runTone) {
            run += ch;
          } else {
            htmlLine += `<span style="color:${CHAR_TONES[runTone]}">${run}</span>`;
            runTone = tone;
            run = ch;
          }
        }
        if (run.length > 0) {
          htmlLine += `<span style="color:${CHAR_TONES[runTone]}">${run}</span>`;
        }
        output.push(htmlLine);
      }

      pre!.innerHTML = output.join('\n');
      frameRef.current = requestAnimationFrame(render);
    }

    frameRef.current = requestAnimationFrame((ts) => {
      lastTimeRef.current = ts;
      frameRef.current = requestAnimationFrame(render);
    });

    return () => cancelAnimationFrame(frameRef.current);
  }, [landPatches, dims]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function onWheel(e: WheelEvent) {
      // Allow scroll anywhere in the hero area, as long as overlay is closed.
      if (showOverlay) return;

      e.preventDefault();
      e.stopPropagation();

      // Scroll up (deltaY < 0) => spin right, scroll down => spin left
      const clampedDelta = Math.max(-140, Math.min(140, e.deltaY));
      wheelSpinVelocityRef.current += -clampedDelta * WHEEL_DELTA_TO_VELOCITY;
      wheelSpinVelocityRef.current = Math.max(
        -WHEEL_MAX_BOOST,
        Math.min(WHEEL_MAX_BOOST, wheelSpinVelocityRef.current)
      );
    }

    // Native non-passive listener so preventDefault reliably blocks page scroll.
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [showOverlay]);

  const content = heroOverlayContent;

  return (
    <div
      ref={rootRef}
      className="relative w-full h-full select-none flex items-center justify-center overflow-hidden"
    >
      <div
        ref={containerRef}
        className="hero-globe-container flex items-center justify-center"
        style={{
          background: 'radial-gradient(ellipse 50% 65% at 50% 50%, rgba(0,0,0,0.04) 0%, transparent 70%)',
        }}
      >
        <div
          className={`transition-all duration-300 ease-out cursor-pointer ${
            showOverlay ? 'opacity-0 scale-[0.97] pointer-events-none' : 'opacity-100 scale-100'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setShowOverlay(true);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowOverlay(true);
            }
          }}
          aria-label="Click to view capabilities"
        >
          <div
            ref={preRef}
            className="hero-globe-pre leading-[1.15] select-none whitespace-pre pointer-events-none"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
            }}
          />
        </div>
      </div>

      <div
        className={`absolute inset-0 flex items-center justify-center overflow-auto transition-all duration-300 ease-out ${
          showOverlay ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-[0.98]'
        }`}
        onClick={() => setShowOverlay(false)}
      >
        <div className="w-full max-w-4xl px-4 sm:px-8 py-6 pb-24 sm:pb-6">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-800 mb-6 sm:mb-8">{content.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 sm:gap-y-10">
            {content.leftColumn.map((leftSection, i) => (
              <React.Fragment key={leftSection.header}>
                <div className="flex flex-col items-start min-w-0">
                  <h3 className="text-xs font-medium tracking-wider text-slate-500 uppercase mb-2 sm:mb-3">
                    {leftSection.header}
                  </h3>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {leftSection.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col items-start min-w-0">
                  <h3 className="text-xs font-medium tracking-wider text-slate-500 uppercase mb-2 sm:mb-3">
                    {content.rightColumn[i]!.header}
                  </h3>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {content.rightColumn[i]!.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              </React.Fragment>
            ))}
          </div>
          <p className="text-center text-xs text-slate-500 mt-8 sm:mt-10">{content.footerHint}</p>
        </div>
      </div>
    </div>
  );
}
