/* AGENCY HQ: AN AGENT'S PORTFOLIO OVER TIME, DRAWN IN SVG.
   One series, so no legend: the panel's title names it. A 2 px line over a 10% wash, solid
   hairline gridlines at round values, the latest point marked, and the agent's net deposits as
   a reference line, so a reader sees at once whether it is above or below the money put in.
   A crosshair follows the pointer (or the arrow keys) and reads out the exact figure HQ sent;
   the same points are in a table under the chart. Positions are floats for drawing only: every
   number a reader sees is HQ's own string, formatted by hq-format.js. */
import { fmtSol, fmtUtc } from "./hq-format.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

export function niceTicks(lo, hi, count = 4) {
  if (!(hi > lo)) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo: a, hi: b, step, ticks };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export function drawEquity(box, points, { reference = null, referenceLabel = "" } = {}) {
  const draw = () => {
    box.replaceChildren();
    if (points.length < 2) {
      const e = document.createElement("div");
      e.className = "chart-empty";
      e.textContent = points.length ? "One point so far; the line starts with the second." : "No portfolio history yet.";
      box.append(e);
      return;
    }
    const W = Math.max(280, box.clientWidth || 600), H = 260, P = { l: 58, r: 14, t: 16, b: 28 };
    const xs = points.map((p) => Date.parse(p.t)), ys = points.map((p) => Number(p.portfolioSol));
    const ref = reference === null ? null : Number(reference);
    const lo0 = Math.min(...ys, ...(ref === null ? [] : [ref])), hi0 = Math.max(...ys, ...(ref === null ? [] : [ref]));
    const { lo, hi, step, ticks } = niceTicks(Math.max(0, lo0 - (hi0 - lo0) * 0.08), hi0 + (hi0 - lo0) * 0.08);
    const t0 = xs[0], t1 = xs[xs.length - 1] > t0 ? xs[xs.length - 1] : t0 + 1;
    const x = (t) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
    const y = (v) => P.t + ((hi - v) / (hi - lo)) * (H - P.t - P.b);
    const places = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: 0,
      "aria-label": `Portfolio value, ${points.length} points from ${fmtUtc(points[0].t)} to ${fmtUtc(points[points.length - 1].t)}: from ${fmtSol(points[0].portfolioSol)} SOL to ${fmtSol(points[points.length - 1].portfolioSol)} SOL. Use the left and right arrow keys to read each point.` });
    for (const v of ticks) {
      const yy = Math.round(y(v)) + 0.5;
      svg.append(svgEl("line", { class: "grid-line", x1: P.l, x2: W - P.r, y1: yy, y2: yy }));
      const tx = svgEl("text", { class: "axis-text", x: P.l - 8, y: yy + 4, "text-anchor": "end" });
      tx.textContent = v.toFixed(places);
      svg.append(tx);
    }
    const days = [points[0].t, points[Math.floor(points.length / 2)].t, points[points.length - 1].t];
    days.forEach((iso, i) => {
      const tx = svgEl("text", { class: "axis-text", x: [P.l, (P.l + W - P.r) / 2, W - P.r][i], y: H - 8, "text-anchor": ["start", "middle", "end"][i] });
      tx.textContent = shortDay(iso);
      svg.append(tx);
    });
    const pts = points.map((p, i) => [x(xs[i]), y(ys[i])]);
    const line = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
    svg.append(svgEl("path", { class: "area", d: `${line}L${pts[pts.length - 1][0].toFixed(1)},${y(lo).toFixed(1)}L${pts[0][0].toFixed(1)},${y(lo).toFixed(1)}Z` }));
    if (ref !== null) {
      const ry = Math.round(y(ref)) + 0.5;
      svg.append(svgEl("line", { class: "ref", x1: P.l, x2: W - P.r, y1: ry, y2: ry }));
      const rt = svgEl("text", { class: "ref-text", x: W - P.r, y: ry - 6, "text-anchor": "end" });
      rt.textContent = referenceLabel;
      svg.append(rt);
    }
    svg.append(svgEl("path", { class: "line", d: line }));
    const [lx, ly] = pts[pts.length - 1];
    svg.append(svgEl("circle", { class: "dot", cx: lx, cy: ly, r: 4 }));
    const cross = svgEl("line", { class: "cross", y1: P.t, y2: H - P.b, visibility: "hidden" });
    const hot = svgEl("circle", { class: "dot", r: 5, visibility: "hidden" });
    svg.append(cross, hot);
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    box.append(svg, tip);

    let at = -1;
    const show = (i) => {
      at = Math.max(0, Math.min(points.length - 1, i));
      const [cx, cy] = pts[at];
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      hot.setAttribute("cx", cx); hot.setAttribute("cy", cy); hot.setAttribute("visibility", "visible");
      const b = document.createElement("b");
      b.textContent = `${fmtSol(points[at].portfolioSol)} SOL`;
      tip.replaceChildren(b, fmtUtc(points[at].t));
      tip.hidden = false;
      const scale = box.clientWidth / W;
      tip.style.left = `${Math.max(70, Math.min(box.clientWidth - 70, cx * scale))}px`;
      tip.style.top = `${cy * scale}px`;
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); hot.setAttribute("visibility", "hidden"); tip.hidden = true; };
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      let best = 0;
      for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - px) < Math.abs(pts[best][0] - px)) best = i;
      show(best);
    });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (k) { e.preventDefault(); show(at < 0 ? points.length - 1 : at + k); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(points.length - 1); }
    });
  };
  draw();
  if (typeof ResizeObserver !== "undefined") {
    let last = box.clientWidth, raf = 0;
    const ro = new ResizeObserver(() => { if (box.clientWidth === last) return; last = box.clientWidth; cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
    ro.observe(box);
    return () => ro.disconnect();
  }
  return () => {};
}
