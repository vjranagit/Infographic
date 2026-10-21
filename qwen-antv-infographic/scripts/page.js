// Browser side: renders the script-built spec in every layout variant and reports layout metrics.
// Qwen never edits this file; build.py writes spec.json (content, card sizes, variants) next to it.
import { Infographic, ItemDesc, ItemLabel, Group, Rect, getItemProps, jsx, registerItem, setDefaultFont } from '@antv/infographic';
import spec from './spec.json';

const FONT = 'Ubuntu Sans, DejaVu Sans, sans-serif';
const SVGNS = 'http://www.w3.org/2000/svg';
const C = spec.card; // single source of card size + font sizes; build.py derives its char limits from it
const LH = C.lh;
setDefaultFont(FONT);
const ctx = document.createElement('canvas').getContext('2d');
const textW = C.width - 2 * C.pad - 5;

function wrap(text, size, weight, width) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Card height follows its text, capped; anything past the cap is reported as overflow by the DOM check.
function Card(props) {
  const [{ indexes, datum, themeColors }, rest] = getItemProps(props, ['width', 'height']);
  const labelLines = Math.min(C.labelLines, wrap(datum.label, C.labelFs, 'bold', textW).length);
  const descLines = datum.desc ? Math.min(C.descLines, wrap(datum.desc, C.descFs, 'normal', textW).length) : 0;
  const labelH = Math.ceil(labelLines * C.labelFs * LH), descH = Math.ceil(descLines * C.descFs * LH);
  const height = C.pad + labelH + (descH ? 4 + descH : 0) + C.pad;
  return jsx(Group, { ...rest, children: [
    jsx(Rect, { x: 0, y: 0, width: C.width, height, rx: 8, ry: 8, fill: themeColors.colorPrimaryBg, stroke: themeColors.colorPrimary, strokeWidth: 1.5, 'data-element-type': 'shape' }),
    jsx(Rect, { x: 0, y: 0, width: 5, height, rx: 2, ry: 2, fill: themeColors.colorPrimary, 'data-element-type': 'shape' }),
    jsx(ItemLabel, { indexes, x: C.pad + 5, y: C.pad, width: textW, height: labelH, fontSize: C.labelFs, lineHeight: LH, wordWrap: true, alignHorizontal: 'left', fill: themeColors.colorText, children: datum.label }),
    descH ? jsx(ItemDesc, { indexes, x: C.pad + 5, y: C.pad + labelH + 4, width: textW, height: descH, fontSize: C.descFs, lineHeight: LH, lineNumber: descLines, alignHorizontal: 'left', fill: themeColors.colorTextSecondary, children: datum.desc }) : null,
  ].filter(Boolean) });
}
registerItem('qwen-card', { component: Card, composites: ['label', 'desc'] });

const el = (tag, attrs, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const viewBox = (svg) => svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
const setViewBox = (svg, [x, y, w, h]) => { svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h); };

// AntV puts every link label at its edge's midpoint with a fixed 14px font, interleaved with the edges, so a later
// edge can paint over an earlier label and labels land on cards or on other edges. The script re-sizes each label to
// C.linkFs, slides it along its OWN edge to the spot that touches no card, no placed label and no other edge, and
// draws all labels above all edges. Returns [{path, label, edge}] in relation order; label is null if unlabeled.
const LABEL_T = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8, 0.14, 0.86];
const samples = new Map();
function pathPoints(p) { // client-space points every 3 units along an edge
  if (!samples.has(p)) {
    const len = p.getTotalLength(), m = p.getScreenCTM(), pts = [];
    for (let s = 0; s <= len; s += 3) { const q = p.getPointAtLength(s); pts.push(new DOMPoint(q.x, q.y).matrixTransform(m)); }
    samples.set(p, pts);
  }
  return samples.get(p);
}
const crosses = (b, p) => pathPoints(p).some((q) => inside(q, b));

function placeLinkLabels(svg) {
  const paths = [...svg.querySelectorAll('path[fill="none"][stroke^="url(#edge-gradient"]')];
  if (!paths.length) return [];
  const decor = paths[0].parentNode;
  const edges = [];
  for (const child of [...decor.children]) {
    if (child.tagName === 'path' && paths.includes(child)) edges.push({ path: child, label: null, edge: spec.links[edges.length] });
    else if (child.tagName === 'g' && child.querySelector('text') && edges.length) edges[edges.length - 1].label = child;
  }
  const cards = [...svg.querySelectorAll('[data-element-type="items-group"] > g')].map((g) => box(g.getBoundingClientRect()));
  const ctm = decor.getScreenCTM(), inv = ctm.inverse(), placed = [];
  // Short edges have the least room to slide, so they choose first.
  for (const e of edges.filter((x) => x.label).sort((a, b) => a.path.getTotalLength() - b.path.getTotalLength())) {
    const { label } = e, text = label.querySelector('text'), rect = label.querySelector('rect');
    text.setAttribute('font-size', C.linkFs);
    const w = Math.ceil(text.getComputedTextLength()) + 10, h = Math.ceil(C.linkFs * 1.35);
    for (const node of [label, rect, text]) { node.setAttribute('width', w); node.setAttribute('height', h); }
    text.setAttribute('x', w / 2); text.setAttribute('y', h / 2);
    const len = e.path.getTotalLength(), m = e.path.getScreenCTM(), cw = w * ctm.a, ch = h * ctm.d;
    let best = null;
    // Centred on the line first; then beside it (offset across the line's direction) if every centred spot is taken.
    for (const [t, side] of [...LABEL_T.map((t) => [t, 0]), ...LABEL_T.flatMap((t) => [[t, 1], [t, -1]])]) {
      const q = e.path.getPointAtLength(t * len), q2 = e.path.getPointAtLength(Math.min(len, t * len + 2));
      const c = new DOMPoint(q.x, q.y).matrixTransform(m);
      const vertical = Math.abs(q2.y - q.y) >= Math.abs(q2.x - q.x);
      if (vertical) c.x += side * (cw / 2 + 6); else c.y += side * (ch / 2 + 4);
      const b = { left: c.x - cw / 2, right: c.x + cw / 2, top: c.y - ch / 2, bottom: c.y + ch / 2 };
      const cost = 10 * cards.filter((k) => overlap(b, k) > 0).length + 10 * placed.filter((k) => overlap(b, k) > 0).length
        + 3 * edges.filter((o) => o !== e && crosses(b, o.path)).length + Math.abs(t - 0.5) + (side ? 0.6 : 0);
      if (!best || cost < best.cost) best = { cost, c, b };
      if (cost < 1) break;
    }
    placed.push(best.b);
    const u = best.c.matrixTransform(inv);
    label.setAttribute('x', u.x - w / 2); label.setAttribute('y', u.y - h / 2);
    label.setAttribute('transform', `translate(${u.x - w / 2}, ${u.y - h / 2})`);
    decor.append(label);
  }
  return edges;
}

// Takeaway + group legend drawn INSIDE the SVG, so the exported SVG is the whole composition (not just the graph).
function footer(svg) {
  const [vx, vy, vw, vh] = viewBox(svg);
  const x0 = vx + 30, w = vw - 60, fs = C.takeawayFs, lfs = C.legendFs;
  let y = vy + vh + 8;
  const g = el('g', { 'data-qwen': 'footer' });
  const lines = wrap(spec.takeaway, fs, 'bold', w - 34);
  const boxH = lines.length * fs * 1.35 + 22;
  g.append(el('rect', { x: x0, y, width: w, height: boxH, rx: 6, fill: '#F1F5F9' }), el('rect', { x: x0, y, width: 6, height: boxH, rx: 2, fill: '#0D9488' }));
  const take = el('text', { x: x0 + 20, y: y + 11, 'font-size': fs, 'font-weight': 700, fill: '#0F172A', 'dominant-baseline': 'hanging', 'data-qwen': 'takeaway' });
  lines.forEach((line, i) => take.append(el('tspan', { x: x0 + 20, dy: i ? fs * 1.35 : 0 }, line)));
  g.append(take);
  y += boxH + 14;
  ctx.font = `normal ${lfs}px ${FONT}`;
  let cx = x0;
  for (const grp of spec.groups) {
    const chipW = 22 + ctx.measureText(grp.name).width + 22;
    if (cx > x0 && cx + chipW > x0 + w) { cx = x0; y += lfs * 1.6; }
    g.append(el('rect', { x: cx, y: y + (lfs - 14) / 2 + 2, width: 14, height: 14, rx: 3, fill: grp.color }),
      el('text', { x: cx + 22, y, 'font-size': lfs, fill: '#334155', 'dominant-baseline': 'hanging', 'data-qwen': 'legend' }, grp.name));
    cx += chipW;
  }
  svg.append(g);
  setViewBox(svg, [vx, vy, vw, y + lfs * 1.6 + 20 - vy]);
}

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const inside = (p, b) => p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom;
const linkName = (e) => (e ? `${e.from}->${e.to}` : 'another link');

function measure(sheet, edges) {
  const svg = sheet.querySelector('svg');
  const sheetRect = sheet.getBoundingClientRect();
  const texts = [], cards = [];
  for (const fo of svg.querySelectorAll('foreignObject')) {
    const span = fo.querySelector('span'); if (!span || !span.textContent.trim()) continue;
    const type = fo.getAttribute('data-element-type') || '';
    const fw = +fo.getAttribute('width'), fh = +fo.getAttribute('height'); // local units, same as span scroll size
    texts.push({ text: span.textContent.trim(), type, indexes: fo.getAttribute('data-indexes'), size: parseFloat(getComputedStyle(span).fontSize),
      box: box(fo.getBoundingClientRect()), overflow: span.scrollHeight > fh + 2 || span.scrollWidth > fw + 2 });
  }
  const labels = [];
  for (const e of edges) {
    if (!e.label) continue;
    const t = e.label.querySelector('text');
    const item = { text: t.textContent.trim(), type: 'link', edge: e.edge, size: parseFloat(t.getAttribute('font-size')), box: box(t.getBoundingClientRect()), overflow: false };
    texts.push(item); labels.push([item, e]);
  }
  for (const t of svg.querySelectorAll('[data-qwen] > text')) {
    texts.push({ text: t.textContent.trim(), type: 'footer', size: parseFloat(t.getAttribute('font-size')), box: box(t.getBoundingClientRect()), overflow: false });
  }
  for (const g of svg.querySelectorAll('[data-element-type="items-group"] > g')) {
    cards.push({ indexes: g.querySelector('[data-indexes]')?.getAttribute('data-indexes'), box: box(g.getBoundingClientRect()) });
  }
  const collisions = [];
  const add = (a, b) => collisions.push({ text: a.text, link: a.edge ? linkName(a.edge) : null, other: b });
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i];
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j];
      if (a.indexes && a.indexes === b.indexes) continue; // label and detail of one card
      if (overlap(a.box, b.box) > 4) add(a.edge ? a : b, a.edge ? (b.edge ? `link label ${JSON.stringify(b.text)}` : JSON.stringify(b.text.slice(0, 30))) : JSON.stringify(a.text.slice(0, 30)));
    }
    if (a.indexes) continue;
    for (const c of cards) if (overlap(a.box, c.box) > 4) add(a, 'part #' + c.indexes);
  }
  // A link label that another link's line runs through is ambiguous even though the label is drawn on top.
  for (const [item, own] of labels) {
    const b = { left: item.box.left + 1, top: item.box.top + 1, right: item.box.right - 1, bottom: item.box.bottom - 1 };
    for (const other of edges) {
      // Edges that share a part with this one fan in/out beside it; placement still avoids them when it can.
      if (other === own || (own.edge && other.edge && [other.edge.from, other.edge.to].some((id) => id === own.edge.from || id === own.edge.to))) continue;
      if (crosses(b, other.path)) add(item, `the arrow ${linkName(other.edge)}`);
    }
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++)
    if (overlap(cards[i].box, cards[j].box) > 4) collisions.push({ text: 'part #' + cards[i].indexes, link: null, other: 'part #' + cards[j].indexes });
  // What sets the sheet width: the title/subtitle line or the graph itself.
  const graph = cards.reduce((r, c) => ({ left: Math.min(r.left, c.box.left), right: Math.max(r.right, c.box.right) }), { left: Infinity, right: -Infinity });
  const desc = texts.find((t) => t.type === 'desc'), title = texts.find((t) => t.type === 'title');
  const widest = Math.max(desc ? desc.box.right - desc.box.left : 0, title ? title.box.right - title.box.left : 0);
  return { width: sheetRect.width, height: sheetRect.height, minFont: Math.min(...texts.map((t) => t.size)),
    titleSetsWidth: widest > graph.right - graph.left + 8,
    overflow: texts.filter((t) => t.overflow).map((t) => ({ text: t.text, type: t.type, indexes: t.indexes })), collisions };
}

const sheets = {};
for (const [key, options] of Object.entries(spec.options)) {
  const sheet = document.createElement('div');
  sheet.id = 'sheet-' + key;
  sheet.style.cssText = 'display:inline-block;vertical-align:top;background:#fff';
  const mount = document.createElement('div');
  sheet.append(mount);
  document.body.append(sheet);
  new Infographic({ container: mount, editable: false }).render(options);
  sheets[key] = sheet;
}
await document.fonts.ready;
// AntV refits the viewBox after text layout; wait until it stops changing, then post-process and pin the SVG size.
const viewBoxes = () => Object.values(sheets).map((s) => s.querySelector('svg').getAttribute('viewBox')).join('|');
for (let last = '', i = 0; i < 30 && viewBoxes() !== last; i++) { last = viewBoxes(); await new Promise((r) => setTimeout(r, 150)); }
window.metrics = {};
for (const [key, sheet] of Object.entries(sheets)) {
  const svg = sheet.querySelector('svg');
  svg.style.display = 'block';
  svg.style.background = '#fff';
  setViewBox(svg, viewBox(svg)); // pin to natural size (1 unit = 1 CSS px) before any geometry is read
  const edges = placeLinkLabels(svg);
  // Grow the viewBox if a re-sized label now pokes out of it (never shrink: AntV's margins stay).
  const [vx, vy, vw, vh] = viewBox(svg), bb = svg.getBBox();
  const x0 = Math.min(vx, bb.x - 20), y0 = Math.min(vy, bb.y - 20);
  setViewBox(svg, [x0, y0, Math.max(vx + vw, bb.x + bb.width + 20) - x0, Math.max(vy + vh, bb.y + bb.height + 20) - y0]);
  footer(svg);
  samples.clear(); // the viewBox moved, so cached client-space edge points are stale
  window.metrics[key] = measure(sheet, edges);
}
window.renderReady = true;
