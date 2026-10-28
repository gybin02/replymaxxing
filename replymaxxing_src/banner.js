// Banner maker renderer: draws a 1584 x 396 LinkedIn banner on a canvas from short text and a template.
// Modern, minimal: lots of space, one accent, tight type. Text sits on the right; the round profile photo covers the lower left.
(() => {
  const W = 1584, H = 396;
  const X = 620, R = 1480; // text column, clear of the photo
  const PALETTES = {
    violet: { name: "Violet", a: "#6b50f5", b: "#be28d4" },
    blue: { name: "Blue", a: "#2563eb", b: "#06b6d4" },
    emerald: { name: "Emerald", a: "#059669", b: "#84cc16" },
    coral: { name: "Coral", a: "#e11d48", b: "#f97316" },
    graphite: { name: "Graphite", a: "#27272a", b: "#71717a" },
  };
  const TEMPLATES = { paper: "Paper", ink: "Ink", tint: "Tint", gradient: "Gradient" };
  const FONT = '"Geist", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const mix = (hex, toward, t) => { const n = parseInt(hex.slice(1), 16), m = parseInt(toward.slice(1), 16); const c = [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * (1 - t) + ((m >> s) & 255) * t)); return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""); };
  function setFont(ctx, weight, size, track) { ctx.font = `${weight} ${size}px ${FONT}`; try { ctx.letterSpacing = `${track * size}px`; } catch {} }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur);
    return lines.length <= maxLines ? lines : null;
  }
  // Largest size (down to min) where the text fits in maxLines. Balances 2-line headlines so lines are similar length.
  function fit(ctx, text, weight, start, min, maxW, maxLines, track) {
    for (let s = start; s >= min; s -= 2) {
      setFont(ctx, weight, s, track);
      let lines = wrap(ctx, text, maxW, maxLines);
      if (!lines) continue;
      if (lines.length === 2) { for (let w = maxW; w > maxW * 0.55; w -= 20) { const l = wrap(ctx, text, w, 2); if (!l) break; lines = l; } }
      return { size: s, lines };
    }
    setFont(ctx, weight, min, track);
    return { size: min, lines: (wrap(ctx, text, maxW, 99) || [text]).slice(0, maxLines) };
  }

  function background(ctx, tpl, p) {
    if (tpl === "ink") {
      ctx.fillStyle = "#0b0b0f"; ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W + 60, -40, 0, W + 60, -40, 760); g.addColorStop(0, hexA(p.a, 0.55)); g.addColorStop(0.45, hexA(p.b, 0.16)); g.addColorStop(1, "rgba(11,11,15,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      return { ink: "#f5f5f7", soft: "rgba(245,245,247,.62)", cta: "outline", ctaInk: "#f5f5f7", line: "rgba(245,245,247,.28)", accent: mix(p.a, "#ffffff", 0.35) };
    }
    if (tpl === "tint") {
      ctx.fillStyle = mix(p.a, "#ffffff", 0.93); ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = hexA(p.a, 0.14); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(W - 40, H + 80, 330, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W - 40, H + 80, 230, 0, Math.PI * 2); ctx.stroke();
      return { ink: mix(p.a, "#0b0b0f", 0.78), soft: hexA(mix(p.a, "#0b0b0f", 0.7), 0.72), cta: "solid", ctaBg: p.a, ctaInk: "#ffffff", accent: p.a };
    }
    if (tpl === "gradient") {
      const g = ctx.createLinearGradient(0, H, W, 0); g.addColorStop(0, mix(p.a, "#0b0b0f", 0.25)); g.addColorStop(1, mix(p.b, "#0b0b0f", 0.1));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const v = ctx.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, 700); v.addColorStop(0, "rgba(255,255,255,.14)"); v.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      return { ink: "#ffffff", soft: "rgba(255,255,255,.78)", cta: "solid", ctaBg: "#ffffff", ctaInk: mix(p.a, "#0b0b0f", 0.2), accent: "rgba(255,255,255,.9)" };
    }
    // paper
    ctx.fillStyle = "#fafaf7"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(11,11,15,.05)"; for (let x = 64; x < W; x += 48) for (let y = 40; y < H; y += 48) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = "#fafaf7"; ctx.fillRect(X - 40, 0, W - X + 40, H); // dot field only on the left, behind the photo
    return { ink: "#111114", soft: "#5c5f6a", cta: "link", ctaInk: p.a, accent: p.a };
  }

  function drawBanner(canvas, copy, tpl = "paper", palette = "violet") {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const p = PALETTES[palette] || PALETTES.violet;
    const t = background(ctx, TEMPLATES[tpl] ? tpl : "paper", p);
    const maxW = R - X;
    const hd = fit(ctx, copy.headline, 650, 60, 38, maxW, 2, -0.025);
    const sb = copy.sub ? fit(ctx, copy.sub, 400, 28, 21, maxW * 0.92, 2, -0.005) : { size: 0, lines: [] };
    const ctaSize = 22;
    const lh = 1.1, sh = 1.38;
    const hdH = hd.lines.length * hd.size * lh, sbH = sb.lines.length * sb.size * sh;
    const ctaH = copy.cta ? (t.cta === "link" ? ctaSize * 1.4 : ctaSize + 26) : 0;
    const accH = 4 + 22, gap1 = sb.lines.length ? 14 : 0, gap2 = copy.cta ? 28 : 0;
    let y = Math.round((H - (accH + hdH + gap1 + sbH + gap2 + ctaH)) / 2);
    ctx.textBaseline = "top";
    // small accent mark above the headline
    ctx.fillStyle = t.accent; ctx.fillRect(X, y, 36, 4); y += accH;
    ctx.fillStyle = t.ink; setFont(ctx, 650, hd.size, -0.025);
    hd.lines.forEach((l, i) => ctx.fillText(l, X, y + i * hd.size * lh));
    y += hdH + gap1;
    ctx.fillStyle = t.soft; setFont(ctx, 400, sb.size, -0.005);
    sb.lines.forEach((l, i) => ctx.fillText(l, X, y + i * sb.size * sh));
    y += sbH + gap2;
    if (copy.cta) {
      const label = t.cta === "link" ? copy.cta + "  →" : copy.cta;
      setFont(ctx, 550, ctaSize, 0);
      const tw = Math.min(maxW - 40, ctx.measureText(label).width);
      if (t.cta === "link") {
        ctx.fillStyle = t.ctaInk; ctx.fillText(label, X, y, maxW);
        ctx.fillRect(X, y + ctaSize * 1.25, tw, 2);
      } else {
        const w = tw + 44, h = ctaH, r = h / 2;
        ctx.beginPath(); ctx.moveTo(X + r, y); ctx.arcTo(X + w, y, X + w, y + h, r); ctx.arcTo(X + w, y + h, X, y + h, r); ctx.arcTo(X, y + h, X, y, r); ctx.arcTo(X, y, X + w, y, r); ctx.closePath();
        if (t.cta === "outline") { ctx.strokeStyle = t.line; ctx.lineWidth = 2; ctx.stroke(); } else { ctx.fillStyle = t.ctaBg; ctx.fill(); }
        ctx.fillStyle = t.ctaInk; ctx.fillText(label, X + 22, y + 13, maxW - 44);
      }
    }
    try { ctx.letterSpacing = "0px"; } catch {}
    return canvas;
  }
  async function ready() {
    try {
      if (!document.fonts.check(`650 40px ${FONT}`) && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
        const f = new FontFace("Geist", `url(${chrome.runtime.getURL("fonts/Geist-Variable.woff2")})`, { weight: "100 900" });
        document.fonts.add(await f.load());
      }
      await Promise.all([document.fonts.load(`650 60px ${FONT}`), document.fonts.load(`400 28px ${FONT}`), document.fonts.load(`550 22px ${FONT}`)]);
    } catch {}
  }
  self.AB_BANNER = { W, H, PALETTES, TEMPLATES, drawBanner, ready };
})();
