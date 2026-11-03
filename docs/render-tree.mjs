// 観点帳の木を単独のSVGに書き出す。検討ページの見本づくり用。
// 使い方: node docs/render-tree.mjs <観点帳.json> <出力.svg>
import { readFile, writeFile } from 'node:fs/promises';
import { NOTE_TAGS, layoutGrowthTree } from '../public/tree.js';
import { LENSES } from '../plugin/skills/pdcaai/scripts/notebook.mjs';

// style.css と同じ配色（Okabe-Ito）。
const COLOR = {
  self: ['#009E73', '#006B4E'], own: ['#0072B2', '#004C78'], spread: ['#CC79A7', '#8E4A73'],
  hint: ['#56B4E9', '#2B7BAA'], ai: ['#E69F00', '#9A6A00'], skip: ['#BBBBBB', '#8A8A8A'],
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function shape(l) {
  const [fill, line] = COLOR[l.tag];
  const paint = `fill="${fill}" stroke="${line}" stroke-width="1.2"`;
  if (l.shape === 'bud') return `<circle r="5.5" ${paint}/>`;
  if (l.shape === 'flower') {
    return [0, 72, 144, 216, 288].map((a) => `<ellipse rx="3.6" ry="6" transform="rotate(${a}) translate(0 -5)" ${paint}/>`).join('') + '<circle r="2.6" fill="#fff8d6"/>';
  }
  return `<path d="M-11 0 Q0 -8 11 0 Q0 8 -11 0Z" ${paint}/>`;
}

export function renderSvg(cycles) {
  const { width, height, trunk, canopy, branches, leaves } = layoutGrowthTree(cycles, LENSES);
  const cx = width / 2;
  const legendY = 18;
  const legend = Object.entries(NOTE_TAGS).filter(([k]) => k !== 'none').map(([k, v], i) => {
    const x = 10 + (i % 3) * 122;
    const y = legendY + Math.floor(i / 3) * 18;
    return `<circle cx="${x + 6}" cy="${y - 4}" r="5" fill="${COLOR[k][0]}" stroke="${COLOR[k][1]}"/><text x="${x + 15}" y="${y}" font-size="11" fill="#444">${esc(v)}</text>`;
  }).join('');
  const top = 52;
  const body = [
    ...canopy.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="#009E73" fill-opacity="0.07"/>`),
    `<path d="M${cx - 70} ${trunk[0].y1 + 2} Q${cx} ${trunk[0].y1 - 6} ${cx + 70} ${trunk[0].y1 + 2}" fill="none" stroke="#8a6f52" stroke-width="3" stroke-linecap="round"/>`,
    ...trunk.map((t) => `<line x1="${t.x}" y1="${t.y1}" x2="${t.x}" y2="${t.y2}" stroke="#7a5236" stroke-width="${t.width}" stroke-linecap="round"/><text x="8" y="${t.y1 - 8}" font-size="11" fill="#666">${esc(t.label)}</text>`),
    ...branches.map((b) => `<path d="M${b.x0} ${b.y0} Q${b.qx} ${b.qy} ${b.x1} ${b.y1}" fill="none" stroke="#8f6545" stroke-width="3" stroke-linecap="round"/><text x="${b.x1 + b.side * 6}" y="${b.y1 + 4}" text-anchor="${b.side > 0 ? 'start' : 'end'}" font-size="11" fill="#666">${esc(b.label)}</text>`),
    ...leaves.map((l) => `<g transform="translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.angle})"><title>${esc(l.text)}</title>${l.recalled ? '<circle r="14" fill="none" stroke="#C99A2E" stroke-width="2.5"/>' : ''}${shape(l)}</g>`),
  ].join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + top}" width="${width}" height="${height + top}" font-family="sans-serif">
<rect width="100%" height="100%" fill="#fffdf8"/>
${legend}
<g transform="translate(0 ${top})">
${body}
</g>
</svg>`;
}

if (process.argv[2]) {
  const book = JSON.parse(await readFile(process.argv[2], 'utf8'));
  await writeFile(process.argv[3], renderSvg(book.cycles));
}
