// =========================================================================
// AUCKLAND SKYLINE ASCII / MOSAIC 2D RASTER EFFECT ENGINE (21st.dev Recipe)
// Implements the full 8-stage Canvas2D render pipeline + JSON parameters
// =========================================================================

export const AUCKLAND_RECIPE_CONFIG = {
  renderMode: "mosaic",
  bgMode: "solid",
  bgBlur: 12,
  bgOpacity: 80,
  cellSize: 3,
  coverage: 100,
  invert: false,
  styleBlend: "source-over",
  charSet: "binary",
  customChars: "",
  brightness: 40,
  contrast: 45,
  edgeEmphasis: 0,
  density: 100,
  toneCurve: [
    { x: 0, y: 0 },
    { x: 0.28, y: 0.14 },
    { x: 0.784426084620838, y: 0 },
    { x: 1, y: 1 },
    { x: 0.99, y: 0 }
  ],
  tint: "#cccccc",
  tintOpacity: 38,
  overlayBlend: "screen",
  saturation: 67,
  grayscale: 70,
  blurType: "off",
  blurAmount: 35,
  blurAngle: 0,
  directionalBothSides: false,
  tiltFocus: 35,
  tiltPosition: 50,
  tiltFeather: 15,
  lensFocus: 40,
  blurCenterX: 50,
  blurCenterY: 50,
  progressivePosition: 55,
  progressiveReverse: false,
  pfx: {
    vignette: { enabled: false, intensity: 38 },
    scanLines: { enabled: false, intensity: 28 },
    chromatic: { enabled: false, intensity: 40 },
    bloom: { enabled: false, intensity: 60 },
    filmGrain: { enabled: false, intensity: 40 },
    glitch: { enabled: false, intensity: 20 },
    pixelate: { enabled: false, intensity: 15 },
    halftone: { enabled: true, intensity: 2 },
    filmDust: { enabled: false, intensity: 20 }
  },
  animated: true,
  animStyle: "shimmer",
  animSpeed: { enabled: true, intensity: 233 },
  animIntensity: { enabled: true, intensity: 40 },
  lights: { enabled: false, points: [] },
  mask: {
    enabled: false,
    tool: "freehand",
    brushSize: 30,
    showOverlay: false,
    invert: false,
    dataUrl: null,
    shapes: []
  }
};

const CHAR_SETS = {
  binary: "01",
  standard: " .:-=+*#%@",
  blocks: " ░▒▓█",
  minimal: " ·•●",
  hex: "0123456789ABCDEF",
  matrix: "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ012345789"
};

/**
 * Generates a rich procedural Auckland Skyline source image (Sky Tower, CBD, Waitemata Harbour reflection)
 * so the Canvas2D pipeline always has a crisp, high-contrast subject with zero external CORS failures.
 */
function createAucklandSkylineSource(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");

  const horizonY = Math.floor(height * 0.64);

  // 1. Twilight Sky Gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, "#0b132b");
  skyGrad.addColorStop(0.45, "#1c2541");
  skyGrad.addColorStop(0.8, "#3a506b");
  skyGrad.addColorStop(1, "#6fffe9");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  // Soft atmospheric glow behind Sky Tower
  const towerX = Math.floor(width * 0.56);
  const glow = ctx.createRadialGradient(towerX, horizonY - height * 0.15, 4, towerX, horizonY - height * 0.1, width * 0.45);
  glow.addColorStop(0, "rgba(180, 225, 255, 0.85)");
  glow.addColorStop(0.4, "rgba(91, 192, 190, 0.35)");
  glow.addColorStop(1, "rgba(11, 19, 43, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, horizonY);

  // 2. Distant Rangitoto Island silhouette on left-center
  ctx.fillStyle = "#162038";
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(width * 0.08, horizonY - height * 0.06);
  ctx.lineTo(width * 0.18, horizonY - height * 0.11);
  ctx.lineTo(width * 0.23, horizonY - height * 0.115);
  ctx.lineTo(width * 0.34, horizonY - height * 0.04);
  ctx.lineTo(width * 0.42, horizonY);
  ctx.closePath();
  ctx.fill();

  // 3. Harbour Bridge arch on left
  ctx.strokeStyle = "#8ecae6";
  ctx.lineWidth = Math.max(1.5, width * 0.004);
  ctx.beginPath();
  ctx.moveTo(width * 0.04, horizonY);
  ctx.quadraticCurveTo(width * 0.16, horizonY - height * 0.13, width * 0.28, horizonY);
  ctx.stroke();

  // Bridge struts
  for (let x = width * 0.06; x <= width * 0.26; x += width * 0.02) {
    const t = (x - width * 0.04) / (width * 0.24);
    const archY = horizonY - Math.sin(t * Math.PI) * (height * 0.065);
    ctx.beginPath();
    ctx.moveTo(x, horizonY);
    ctx.lineTo(x, archY);
    ctx.stroke();
  }

  // 4. Auckland CBD Skyline Buildings
  const buildings = [
    { x: 0.30, w: 0.035, h: 0.16 },
    { x: 0.34, w: 0.040, h: 0.24 },
    { x: 0.385, w: 0.032, h: 0.20 },
    { x: 0.42, w: 0.045, h: 0.32 }, // PwC Tower
    { x: 0.47, w: 0.038, h: 0.27 },
    { x: 0.51, w: 0.035, h: 0.22 },
    { x: 0.59, w: 0.044, h: 0.35 }, // Vero Centre
    { x: 0.64, w: 0.038, h: 0.26 },
    { x: 0.685, w: 0.045, h: 0.30 },
    { x: 0.735, w: 0.036, h: 0.19 },
    { x: 0.78, w: 0.042, h: 0.22 },
    { x: 0.83, w: 0.035, h: 0.14 },
    { x: 0.87, w: 0.050, h: 0.10 }
  ];

  buildings.forEach((b, idx) => {
    const bx = Math.floor(b.x * width);
    const bw = Math.max(6, Math.floor(b.w * width));
    const bh = Math.floor(b.h * height);
    const by = horizonY - bh;

    ctx.fillStyle = idx % 2 === 0 ? "#111a2e" : "#192742";
    ctx.fillRect(bx, by, bw, bh);

    //Lit office windows grid
    ctx.fillStyle = "rgba(235, 248, 255, 0.85)";
    const winStepY = Math.max(3, Math.floor(height * 0.022));
    const winStepX = Math.max(3, Math.floor(width * 0.008));
    for (let wy = by + 4; wy < horizonY - 4; wy += winStepY) {
      for (let wx = bx + 2; wx < bx + bw - 3; wx += winStepX) {
        if (((wx * 17 + wy * 31 + idx * 7) % 10) > 3) {
          ctx.fillRect(wx, wy, Math.max(1.5, winStepX * 0.55), Math.max(1.5, winStepY * 0.45));
        }
      }
    }
  });

  // 5. Iconic Auckland Sky Tower (Needle + Observation Pod)
  const towerBaseW = Math.max(6, width * 0.018);
  const towerTopY = horizonY - height * 0.54;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(towerX - towerBaseW * 0.35, horizonY - height * 0.38, towerBaseW * 0.7, height * 0.38);

  // Observation deck rings
  const podY = horizonY - height * 0.39;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(towerX, podY, towerBaseW * 1.35, height * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#94d2bd";
  ctx.fillRect(towerX - towerBaseW * 1.1, podY - height * 0.012, towerBaseW * 2.2, height * 0.016);

  // Spire needle
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, towerBaseW * 0.25);
  ctx.beginPath();
  ctx.moveTo(towerX, podY - height * 0.02);
  ctx.lineTo(towerX, towerTopY);
  ctx.stroke();

  // Bright beacon at tip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(towerX, towerTopY, Math.max(2.5, towerBaseW * 0.45), 0, Math.PI * 2);
  ctx.fill();

  // 6. Waitemata Harbour Water & Shimmering Reflections
  const waterGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  waterGrad.addColorStop(0, "#1d3557");
  waterGrad.addColorStop(0.5, "#0f172a");
  waterGrad.addColorStop(1, "#060b16");
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  // Shoreline boardwalk lights
  ctx.fillStyle = "#ffffff";
  for (let x = width * 0.25; x < width * 0.92; x += Math.max(4, width * 0.012)) {
    ctx.fillRect(x, horizonY - 1, Math.max(2, width * 0.006), 2.5);
  }

  // Water reflection streaks under CBD and Sky Tower
  for (let y = horizonY + 2; y < height; y += 3) {
    const progress = (y - horizonY) / (height - horizonY);
    const spread = 1 + progress * 1.8;
    ctx.fillStyle = `rgba(210, 235, 255, ${0.55 * (1 - progress * 0.75)})`;
    // Sky Tower reflection column
    const rw = towerBaseW * 2.2 * spread;
    ctx.fillRect(towerX - rw * 0.5 + Math.sin(y * 0.4) * 3, y, rw, 1.8);

    // CBD reflection bands
    buildings.forEach((b, i) => {
      if ((y + i * 3) % 6 < 3) {
        const bx = b.x * width;
        const bw = b.w * width * 0.8;
        ctx.fillStyle = `rgba(165, 215, 250, ${0.35 * (1 - progress * 0.8)})`;
        ctx.fillRect(bx + Math.cos(y * 0.3 + i) * 2, y, bw, 1.5);
      }
    });
  }

  return c;
}

/**
 * Evaluates piecewise toneCurve [ {x, y}, ... ] sorted by x
 */
function buildToneCurveLUT(toneCurve) {
  const lut = new Uint8ClampedArray(256);
  if (!Array.isArray(toneCurve) || toneCurve.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  // Sort control points by x ascending, deduplicating close x
  const pts = [...toneCurve].sort((a, b) => a.x - b.x);
  for (let i = 0; i < 256; i++) {
    const xn = i / 255;
    if (xn <= pts[0].x) {
      lut[i] = Math.round(pts[0].y * 255);
      continue;
    }
    if (xn >= pts[pts.length - 1].x) {
      lut[i] = Math.round(pts[pts.length - 1].y * 255);
      continue;
    }
    let yVal = xn;
    for (let j = 0; j < pts.length - 1; j++) {
      const p0 = pts[j];
      const p1 = pts[j + 1];
      if (xn >= p0.x && xn <= p1.x) {
        const span = p1.x - p0.x;
        const t = span > 0.0001 ? (xn - p0.x) / span : 0;
        // Smooth cosine interpolation between tone points
        const smoothT = (1 - Math.cos(t * Math.PI)) * 0.5;
        yVal = p0.y + smoothT * (p1.y - p0.y);
        break;
      }
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(yVal * 255)));
  }
  return lut;
}

function hexToRgb(hex) {
  const clean = (hex || "#cccccc").replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

/**
 * Mounts the Auckland Skyline Canvas2D effect onto a target <canvas> element.
 */
export function mountAucklandSkylineCanvas(canvas, customConfig = {}) {
  if (!canvas) return () => {};
  const cfg = {
    ...AUCKLAND_RECIPE_CONFIG,
    ...customConfig,
    pfx: { ...AUCKLAND_RECIPE_CONFIG.pfx, ...(customConfig.pfx || {}) }
  };

  const ctx = canvas.getContext("2d", { alpha: false });
  const toneLUT = buildToneCurveLUT(cfg.toneCurve);
  const tintRgb = hexToRgb(cfg.tint);
  const chars = cfg.customChars || CHAR_SETS[cfg.charSet] || CHAR_SETS.binary;

  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let cellData = [];
  let sourceCanvas = null;
  let rafId = null;
  let isVisible = true;

  function sampleGrid() {
    const rect = canvas.parentElement?.getBoundingClientRect() || { width: window.innerWidth, height: 220 };
    // Cap internal resolution for 60fps smoothness on mobile & desktop
    const maxW = Math.min(Math.max(320, Math.floor(rect.width)), 960);
    const maxH = Math.min(Math.max(140, Math.floor(rect.height)), 420);

    width = maxW;
    height = maxH;
    canvas.width = width;
    canvas.height = height;

    sourceCanvas = createAucklandSkylineSource(width, height);
    const sCtx = sourceCanvas.getContext("2d");
    const imgData = sCtx.getImageData(0, 0, width, height).data;

    const cs = Math.max(3, cfg.cellSize || 3);
    cols = Math.ceil(width / cs);
    rows = Math.ceil(height / cs);
    cellData = new Array(cols * rows);

    const briOffset = (cfg.brightness || 0) * 1.4;
    const contrastFactor = (259 * ((cfg.contrast || 0) + 255)) / (255 * (259 - (cfg.contrast || 0)));
    const satFactor = (cfg.saturation ?? 100) / 100;
    const grayMix = (cfg.grayscale ?? 0) / 100;
    const tOpacity = (cfg.tintOpacity ?? 0) / 100;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * cs;
        const y0 = r * cs;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;

        for (let dy = 0; dy < cs && y0 + dy < height; dy++) {
          for (let dx = 0; dx < cs && x0 + dx < width; dx++) {
            const idx = ((y0 + dy) * width + (x0 + dx)) * 4;
            sumR += imgData[idx];
            sumG += imgData[idx + 1];
            sumB += imgData[idx + 2];
            count++;
          }
        }

        let cr = sumR / count;
        let cg = sumG / count;
        let cb = sumB / count;

        // Step 4: Color adjustments in order: brightness -> contrast -> saturation -> grayscale -> toneCurve -> tint (screen)
        cr = contrastFactor * (cr + briOffset - 128) + 128;
        cg = contrastFactor * (cg + briOffset - 128) + 128;
        cb = contrastFactor * (cb + briOffset - 128) + 128;

        const luma = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        cr = luma + (cr - luma) * satFactor;
        cg = luma + (cg - luma) * satFactor;
        cb = luma + (cb - luma) * satFactor;

        cr = cr * (1 - grayMix) + luma * grayMix;
        cg = cg * (1 - grayMix) + luma * grayMix;
        cb = cb * (1 - grayMix) + luma * grayMix;

        cr = Math.max(0, Math.min(255, cr));
        cg = Math.max(0, Math.min(255, cg));
        cb = Math.max(0, Math.min(255, cb));

        // Apply Tone Curve
        const curvedLuma = toneLUT[Math.round(0.299 * cr + 0.587 * cg + 0.114 * cb)] / 255;
        const lumaRatio = luma > 1 ? (curvedLuma * 255) / luma : curvedLuma;
        cr = Math.min(255, cr * 0.45 + cr * lumaRatio * 0.55);
        cg = Math.min(255, cg * 0.45 + cg * lumaRatio * 0.55);
        cb = Math.min(255, cb * 0.45 + cb * lumaRatio * 0.55);

        // Screen blend with tint (#cccccc at 38%)
        if (tOpacity > 0) {
          const sr = 255 - ((255 - cr) * (255 - tintRgb.r)) / 255;
          const sg = 255 - ((255 - cg) * (255 - tintRgb.g)) / 255;
          const sb = 255 - ((255 - cb) * (255 - tintRgb.b)) / 255;
          cr = cr * (1 - tOpacity) + sr * tOpacity;
          cg = cg * (1 - tOpacity) + sg * tOpacity;
          cb = cb * (1 - tOpacity) + sb * tOpacity;
        }

        let normLum = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255;
        if (cfg.invert) normLum = 1 - normLum;

        // Deterministic hash for shimmer & coverage
        const hash = Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1;

        cellData[r * cols + c] = {
          x: x0,
          y: y0,
          r: Math.round(cr),
          g: Math.round(cg),
          b: Math.round(cb),
          lum: normLum,
          hash
        };
      }
    }
  }

  function renderFrame(timestamp) {
    if (!isVisible) {
      rafId = requestAnimationFrame(renderFrame);
      return;
    }

    const cs = Math.max(3, cfg.cellSize || 3);
    const speedVal = cfg.animSpeed?.enabled ? (cfg.animSpeed.intensity || 100) / 100 : 0;
    const animAmt = cfg.animIntensity?.enabled ? (cfg.animIntensity.intensity || 40) / 100 : 0;
    const t = (timestamp * 0.0022) * speedVal;

    // Step 1: Background Mode
    ctx.globalCompositeOperation = "source-over";
    if (cfg.bgMode === "solid") {
      ctx.fillStyle = `rgba(9, 13, 24, ${(cfg.bgOpacity ?? 80) / 100})`;
      ctx.fillRect(0, 0, width, height);
    } else if (cfg.bgMode === "photo" && sourceCanvas) {
      ctx.globalAlpha = (cfg.bgOpacity ?? 80) / 100;
      ctx.drawImage(sourceCanvas, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#090d18";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.globalCompositeOperation = cfg.styleBlend || "source-over";
    const covThreshold = (cfg.coverage ?? 100) / 100;
    const densityScale = (cfg.density ?? 100) / 100;
    const mode = cfg.renderMode || "mosaic";

    // Step 3 & 8: Draw cells with animated shimmer
    for (let i = 0; i < cellData.length; i++) {
      const cell = cellData[i];
      if (!cell || cell.hash > covThreshold) continue;

      let animMod = 0;
      if (cfg.animated && animAmt > 0) {
        if (cfg.animStyle === "shimmer") {
          animMod = Math.sin(t + cell.hash * Math.PI * 10 + cell.x * 0.03) * animAmt * 0.32;
        } else if (cfg.animStyle === "wave") {
          animMod = Math.sin(t + cell.x * 0.04 + cell.y * 0.02) * animAmt * 0.25;
        } else if (cfg.animStyle === "pulse") {
          animMod = Math.sin(t) * animAmt * 0.2;
        } else {
          animMod = (Math.sin(t * 2 + cell.hash * 20) > 0.6 ? 0.25 : -0.1) * animAmt;
        }
      }

      const lum = Math.max(0, Math.min(1, cell.lum + animMod));
      if (lum < 0.04) continue;

      const rr = Math.min(255, Math.max(0, Math.round(cell.r + animMod * 95)));
      const gg = Math.min(255, Math.max(0, Math.round(cell.g + animMod * 105)));
      const bb = Math.min(255, Math.max(0, Math.round(cell.b + animMod * 120)));
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;

      if (mode === "mosaic" || mode === "pixel") {
        const pad = mode === "mosaic" ? 0.5 : 0;
        const sz = Math.max(1, (cs - pad) * Math.min(1, (0.45 + lum * 0.65) * densityScale));
        const offset = (cs - sz) * 0.5;
        ctx.fillRect(cell.x + offset, cell.y + offset, sz, sz);
      } else if (mode === "dots" || mode === "rings") {
        const rad = Math.max(0.6, (cs * 0.48) * lum * densityScale);
        ctx.beginPath();
        ctx.arc(cell.x + cs * 0.5, cell.y + cs * 0.5, rad, 0, Math.PI * 2);
        if (mode === "rings") {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        } else {
          ctx.fill();
        }
      } else if (mode === "characters") {
        const cIdx = Math.min(chars.length - 1, Math.floor(lum * chars.length));
        const ch = chars[cIdx];
        if (ch && ch !== " ") {
          ctx.font = `${cs}px monospace`;
          ctx.fillText(ch, cell.x, cell.y + cs);
        }
      } else {
        ctx.fillRect(cell.x, cell.y, cs - 0.5, cs - 0.5);
      }
    }

    // Step 5: Post-effects (pfx.halftone enabled: true, intensity: 2)
    if (cfg.pfx?.halftone?.enabled) {
      const htAlpha = Math.min(0.35, (cfg.pfx.halftone.intensity || 2) * 0.025);
      ctx.fillStyle = `rgba(255, 255, 255, ${htAlpha})`;
      const step = cs * 2;
      for (let y = 0; y < height; y += step) {
        for (let x = (y % (step * 2) === 0 ? 0 : cs); x < width; x += step) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    if (cfg.pfx?.scanLines?.enabled) {
      ctx.fillStyle = `rgba(0, 0, 0, ${(cfg.pfx.scanLines.intensity || 20) / 200})`;
      for (let y = 0; y < height; y += 3) {
        ctx.fillRect(0, y, width, 1);
      }
    }

    if (cfg.animated) {
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  sampleGrid();
  rafId = requestAnimationFrame(renderFrame);

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sampleGrid, 150);
  };
  window.addEventListener("resize", onResize);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => { isVisible = e.isIntersecting; });
  });
  observer.observe(canvas);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    observer.disconnect();
  };
}
