// Builds every image in assets/.
//
// Text is drawn as outlines from scripts/glyphs/*.json (Bricolage Grotesque + Space Mono, OFL):
// GitHub's image proxy blocks web fonts, so this is the only way custom type looks the same everywhere.
// Animations are CSS + SMIL inside the SVGs (no scripts, which GitHub would strip anyway).
//
//   node scripts/build.mjs                      live stats from GitHub (needs GITHUB_TOKEN)
//   DATA_FILE=data.json node scripts/build.mjs  offline, from a saved GraphQL response
//
// Without data, the static art is rebuilt and the live cards keep their last version.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const LOGIN = process.env.GH_LOGIN || 'yashx420';

const C = {
  bg: '#0B0B12', card: '#10101A', line: '#26263B', ink: '#F5F2EA', dim: '#9090AB', faint: '#4A4A66',
  lime: '#D4FF3A', pink: '#FF5CC8', violet: '#8B6CFF', cyan: '#45E6FF', orange: '#FF8A3D', dark: '#0B0B12',
};

// Projects worth a card. Descriptions are hand-written; stars, language and homepage come from the API.
const FEATURED = [
  { repo: 'palmbeat', title: 'palmbeat', accent: C.lime,
    desc: 'wave at your webcam, get a beat. hand tracking drives melody, bass & drums. runs in the browser, offline.' },
  { repo: 'Sentinel', title: 'Sentinel', accent: C.pink, live: false,
    desc: 'news-bias radar. a fine-tuned transformer reads headlines and calls them left, center or right.' },
  { repo: 'lead-engine', title: 'lead-engine', accent: C.cyan,
    desc: "lead intel for US law firms: finds firms, qualifies them, verifies the decision-maker's email." },
  { repo: 'solace-ai', title: 'solace-ai', accent: C.violet,
    desc: 'emotion-aware companion chatbot with crisis-safety checks. fastapi + openai, react front.' },
  { repo: 'reachinbox-email-scheduler', title: 'reachinbox-scheduler', accent: C.orange,
    desc: "email job scheduler that doesn't flake: express + bullmq + postgres, next.js dashboard." },
  { repo: 'Universe', title: 'UniVerse', accent: C.lime,
    desc: 'ai-powered campus hub: inter-campus feeds, events, forums and ai mentor matching.' },
];

// ---------------------------------------------------------------- text as outlines
const loadFont = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'glyphs', `${n}.json`), 'utf8'));
const FONTS = { D: loadFont('display'), M: loadFont('mono'), B: loadFont('mono-bold') };
const n2 = (v) => +(+v).toFixed(2);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SPARK = 'M0 -1C.08 -.22 .22 -.08 1 0C.22 .08 .08 .22 0 1C-.08 .22 -.22 .08 -1 0C-.22 -.08 -.08 -.22 0 -1Z';
const star5 = (cx, cy, r) => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    p.push(`${n2(cx + rr * Math.cos(a))},${n2(cy + rr * Math.sin(a))}`);
  }
  return p.join(' ');
};

class Svg {
  constructor(w, h, title) { Object.assign(this, { w, h, title, glyphs: new Map(), defs: [], css: [], body: [], uid: 0 }); }
  id(p = 'i') { return `${p}${++this.uid}`; }
  add(...parts) { this.body.push(...parts); return this; }

  // Pen position after each character, in px (index 0 = start). Includes kerning.
  stops(f, str, size, ls = 0) {
    const F = FONTS[f], s = size / F.upm, out = [0];
    let pen = 0, prev = null;
    for (const ch of str) {
      const g = F.glyphs[ch] || F.glyphs['?'];
      if (prev) pen += (F.kern[prev + ch] || 0) * s;
      pen += g.w * s; out.push(pen); pen += ls; prev = ch;
    }
    return out;
  }
  measure(f, str, size, ls = 0) { return this.stops(f, str, size, ls).at(-1); }

  // Bare <use> elements, one per glyph (valid inside <clipPath>, which can't hold a <g>).
  run(f, str, x, y, size, { anchor = 'start', ls = 0 } = {}) {
    const F = FONTS[f], s = size / F.upm, sc = +s.toFixed(6);
    const w = this.measure(f, str, size, ls);
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    let pen = 0, prev = null;
    const out = [];
    for (const ch of str) {
      const g = F.glyphs[ch] || F.glyphs['?'];
      if (prev) pen += (F.kern[prev + ch] || 0) * s;
      if (g.d) {
        const id = f + ch.codePointAt(0).toString(16);
        this.glyphs.set(id, g.d);
        out.push(`<use xlink:href="#${id}" transform="matrix(${sc} 0 0 ${-sc} ${n2(x0 + pen)} ${n2(y)})"/>`);
      }
      pen += g.w * s + ls; prev = ch;
    }
    return out.join('');
  }
  text(f, str, x, y, size, o = {}) {
    const attrs = [`fill="${o.fill || C.ink}"`];
    if (o.cls) attrs.push(`class="${o.cls}"`);
    if (o.style) attrs.push(`style="${o.style}"`);
    if (o.opacity != null) attrs.push(`opacity="${o.opacity}"`);
    return `<g ${attrs.join(' ')}>${this.run(f, str, x, y, size, o)}</g>`;
  }
  // Several coloured pieces on one line: [[text, colour], ...]
  parts(f, pieces, x, y, size) {
    let off = 0;
    return pieces.map(([t, fill]) => { const g = this.text(f, t, x + off, y, size, { fill }); off += this.measure(f, t, size); return g; }).join('');
  }
  toString() {
    const glyphs = [...this.glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" role="img" aria-label="${esc(this.title)}">`
      + `<title>${esc(this.title)}</title><style>${this.css.join('')}</style><defs>${glyphs}${this.defs.join('')}</defs>${this.body.join('')}</svg>\n`;
  }
}

// SMIL value track that jumps between values: events = [[seconds, value], ...]
function discrete(attr, events, dur, extra = '') {
  const ev = [...events].sort((a, b) => a[0] - b[0]);
  if (!ev.length || ev[0][0] > 0) ev.unshift([0, ev.length ? ev[0][1] : 0]);
  const keep = [];
  for (const e of ev) {
    const k = +(e[0] / dur).toFixed(4);
    if (keep.length && keep.at(-1)[0] >= k) keep[keep.length - 1] = [keep.at(-1)[0], e[1]];
    else keep.push([k, e[1]]);
  }
  return `<animate attributeName="${attr}" dur="${n2(dur)}s" calcMode="discrete" values="${keep.map((e) => n2(e[1])).join(';')}" keyTimes="${keep.map((e) => e[0]).join(';')}" ${extra}/>`;
}

const COMMON_CSS = `
.tw{transform-box:fill-box;transform-origin:center;animation:tw 2.6s ease-in-out infinite}
@keyframes tw{0%,100%{transform:scale(.35) rotate(0deg);opacity:.35}50%{transform:scale(1) rotate(90deg);opacity:1}}
.spin{transform-box:fill-box;transform-origin:center;animation:spin 10s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.float{animation:float 4.2s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.bob{animation:bob 3.2s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-12px) rotate(-1.5deg)}}
.shadow{transform-box:fill-box;transform-origin:center;animation:shadow 3.2s ease-in-out infinite}
@keyframes shadow{0%,100%{transform:scaleX(1);opacity:.16}50%{transform:scaleX(.75);opacity:.07}}
.eyes{transform-box:fill-box;transform-origin:center;animation:blink 4.6s infinite}
@keyframes blink{0%,44%,52%,100%{transform:scaleY(1)}48%{transform:scaleY(.08)}}
.pupils{animation:look 7s ease-in-out infinite}
@keyframes look{0%,16%{transform:translate(0,0)}22%,40%{transform:translate(-7px,3px)}46%,64%{transform:translate(7px,-2px)}70%,88%{transform:translate(2px,6px)}94%,100%{transform:translate(0,0)}}
.glow{transform-box:fill-box;transform-origin:center;animation:glow 1.6s ease-in-out infinite}
@keyframes glow{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}
.cur{animation:cur 1s steps(1) infinite}
@keyframes cur{50%{opacity:0}}
`;

const spark = (x, y, r, fill, cls = 'tw', delay = 0) =>
  `<g transform="translate(${x} ${y}) scale(${r})"><path class="${cls}" d="${SPARK}" fill="${fill}" style="animation-delay:-${delay}s"/></g>`;

// The mascot: a lime blob with googly eyes. Local box about 0..210 x 0..240.
function mascot({ x, y, scale = 1, wave = true }) {
  const body = 'M100 34C153 34 186 67 186 120C186 174 151 204 100 204C49 204 14 174 14 120C14 67 47 34 100 34Z';
  const armR = 'M176 130L206 92', armL = 'M26 140L6 170';
  const armWave = wave
    ? `<animateTransform attributeName="transform" type="rotate" values="0 176 130;-32 176 130;6 176 130;-26 176 130;0 176 130;0 176 130" keyTimes="0;.08;.16;.24;.32;1" dur="4s" repeatCount="indefinite"/>`
    : '';
  const limb = (d, w1, w2, w3) => `<path d="${d}" stroke="#fff" stroke-width="${w1}" stroke-linecap="round"/>`;
  return `<g transform="translate(${x} ${y}) scale(${scale})">`
    + `<ellipse class="shadow" cx="100" cy="224" rx="58" ry="8" fill="${C.lime}"/>`
    + `<g class="bob">`
    // white sticker outline first, so everything after sits on top of it
    + `<g>${armWave}${limb(armR, 40)}</g>${limb(armL, 40)}`
    + `<path d="M100 36Q94 16 110 4" stroke="#fff" stroke-width="18" stroke-linecap="round" fill="none"/>`
    + `<path d="${body}" stroke="#fff" stroke-width="16" fill="#fff"/>`
    + `<g>${armWave}<path d="${armR}" stroke="${C.dark}" stroke-width="28" stroke-linecap="round"/><path d="${armR}" stroke="${C.lime}" stroke-width="16" stroke-linecap="round"/></g>`
    + `<path d="${armL}" stroke="${C.dark}" stroke-width="28" stroke-linecap="round"/><path d="${armL}" stroke="${C.lime}" stroke-width="16" stroke-linecap="round"/>`
    + `<path d="M100 36Q94 16 110 4" stroke="${C.dark}" stroke-width="6" stroke-linecap="round" fill="none"/>`
    + `<circle class="glow" cx="110" cy="4" r="10" fill="${C.pink}" stroke="${C.dark}" stroke-width="5"/>`
    + `<path d="${body}" fill="${C.lime}" stroke="${C.dark}" stroke-width="6"/>`
    + `<ellipse cx="58" cy="68" rx="15" ry="8" fill="#fff" opacity=".55" transform="rotate(-32 58 68)"/>`
    + `<ellipse cx="46" cy="146" rx="12" ry="7" fill="${C.pink}" opacity=".85"/><ellipse cx="154" cy="146" rx="12" ry="7" fill="${C.pink}" opacity=".85"/>`
    + `<g class="eyes"><ellipse cx="72" cy="112" rx="21" ry="25" fill="#fff" stroke="${C.dark}" stroke-width="6"/><ellipse cx="128" cy="112" rx="21" ry="25" fill="#fff" stroke="${C.dark}" stroke-width="6"/>`
    + `<g class="pupils"><circle cx="74" cy="115" r="9.5" fill="${C.dark}"/><circle cx="130" cy="115" r="9.5" fill="${C.dark}"/><circle cx="77.5" cy="111" r="3" fill="#fff"/><circle cx="133.5" cy="111" r="3" fill="#fff"/></g></g>`
    + `<path d="M82 152Q100 172 118 152" stroke="${C.dark}" stroke-width="6" stroke-linecap="round" fill="none"/>`
    + `</g></g>`;
}

// A tilted pill sticker that floats a little.
function sticker(s, { x, y, rot, label, bg, fg = C.dark, delay = 0, size = 17 }) {
  const w = s.measure('B', label, size) + 40;
  return `<g transform="translate(${x} ${y}) rotate(${rot})"><g class="float" style="animation-delay:-${delay}s">`
    + `<rect x="${n2(-w / 2 - 5)}" y="-27" width="${n2(w + 10)}" height="54" rx="27" fill="#fff"/>`
    + `<rect x="${n2(-w / 2)}" y="-22" width="${n2(w)}" height="44" rx="22" fill="${bg}" stroke="${C.dark}" stroke-width="3"/>`
    + s.text('B', label, 0, 6, size, { fill: fg, anchor: 'middle' })
    + `</g></g>`;
}

// ---------------------------------------------------------------- hero
function hero() {
  const W = 1200, H = 500;
  const s = new Svg(W, H, "Hi, I'm Yash: full-stack dev who ships web, mobile and AI things");
  s.css.push(COMMON_CSS, `
.orb{animation:drift 16s ease-in-out infinite alternate}
.o2{animation-duration:20s;animation-delay:-7s}.o3{animation-duration:13s;animation-delay:-3s}
@keyframes drift{0%{transform:translate(0,0)}50%{transform:translate(-70px,40px)}100%{transform:translate(50px,-30px)}}
.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 1.8s ease-out infinite}
@keyframes pulse{0%{transform:scale(1);opacity:.8}100%{transform:scale(3.4);opacity:0}}
.glA,.glB{animation:glA 5.5s steps(1) infinite;opacity:0}.glB{animation-name:glB}
@keyframes glA{0%,86%,100%{transform:translate(0,0);opacity:0}87%{transform:translate(-7px,2px);opacity:.95}89%{transform:translate(4px,-3px);opacity:.95}91%{transform:translate(-2px,1px);opacity:.95}93%{opacity:0}}
@keyframes glB{0%,86%,100%{transform:translate(0,0);opacity:0}87%{transform:translate(6px,-2px);opacity:.95}89%{transform:translate(-5px,3px);opacity:.95}91%{transform:translate(3px,0);opacity:.95}93%{opacity:0}}
.say{opacity:0;animation:say 12.5s infinite}.first{opacity:1}
@keyframes say{0%{opacity:0;transform:translateY(5px)}2%,17%{opacity:1;transform:translateY(0)}19%,100%{opacity:0;transform:translateY(0)}}
`);
  s.defs.push(
    `<clipPath id="card"><rect width="${W}" height="${H}" rx="28"/></clipPath>`,
    `<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#fff" fill-opacity=".07"/></pattern>`,
    `<filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="72"/></filter>`,
    `<linearGradient id="ng" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="680" y2="0" spreadMethod="reflect"><stop offset="0" stop-color="${C.lime}"/><stop offset=".5" stop-color="${C.cyan}"/><stop offset="1" stop-color="${C.violet}"/><animateTransform attributeName="gradientTransform" type="translate" values="0 0;1280 0" dur="12s" repeatCount="indefinite"/></linearGradient>`,
  );
  s.add(`<g clip-path="url(#card)">`,
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`,
    `<circle class="orb" cx="1060" cy="70" r="210" fill="${C.violet}" opacity=".34" filter="url(#blur)"/>`,
    `<circle class="orb o2" cx="700" cy="540" r="170" fill="${C.pink}" opacity=".26" filter="url(#blur)"/>`,
    `<circle class="orb o3" cx="130" cy="-30" r="160" fill="${C.cyan}" opacity=".2" filter="url(#blur)"/>`,
    `<rect width="${W}" height="${H}" fill="url(#dots)"/>`);

  // status pill
  const status = 'now building Auréa: gifting experiences, not things';
  const sw = s.measure('M', status, 15);
  s.add(`<rect x="52" y="38" width="${n2(sw + 62)}" height="40" rx="20" fill="#fff" fill-opacity=".05" stroke="#fff" stroke-opacity=".12"/>`,
    `<circle class="pulse" cx="76" cy="58" r="5" fill="${C.lime}"/><circle cx="76" cy="58" r="5" fill="${C.lime}"/>`,
    s.text('M', status, 94, 63, 15, { fill: C.dim }),
    s.text('M', 'player 1 since 2020', 1158, 63, 14, { fill: C.dim, anchor: 'end', opacity: 0.6 }));

  // name: glitch copies behind a gradient-filled clip of the same glyphs
  const NX = 50, NY = 326, NS = 236;
  const name = s.run('D', 'yash', NX, NY, NS);
  const nameW = s.measure('D', 'yash', NS);
  s.defs.push(`<clipPath id="nameclip">${name}</clipPath>`);
  s.add(s.text('M', "hi, i'm", 60, 142, 24, { fill: C.dim }),
    `<g class="glA" fill="${C.pink}">${name}</g><g class="glB" fill="${C.cyan}">${name}</g>`,
    `<rect x="0" y="90" width="${n2(NX + nameW + 40)}" height="320" fill="url(#ng)" clip-path="url(#nameclip)"/>`,
    spark(n2(NX + nameW + 34), 168, 30, C.pink, 'spin'));

  // typing taglines
  const lines = [
    'professional button-maker',
    'turns caffeine into commits',
    'ships web, mobile & AI things',
    'deploys on fridays. on purpose.',
    'will debug for snacks',
  ];
  const TY = 444, TS = 26, PX = 58;
  const promptW = s.measure('B', '~$ ', TS);
  const X0 = PX + promptW;
  const TC = 0.055, HOLD = 2.1, DC = 0.022, GAP = 0.45;
  let t = 0.3;
  const spans = lines.map((str) => {
    const st = s.stops('M', str, TS), n = str.length, start = t;
    const typedEnd = start + n * TC, delStart = typedEnd + HOLD, end = delStart + n * DC;
    t = end + GAP;
    return { str, st, n, start, typedEnd, delStart, end };
  });
  const T = t;
  const cursor = [[0, X0]];
  s.add(s.text('B', '~$', PX, TY, TS, { fill: C.lime }));
  spans.forEach((sp, i) => {
    const ev = [[0, 0]];
    for (let k = 1; k <= sp.n; k++) { ev.push([sp.start + k * TC, sp.st[k]]); cursor.push([sp.start + k * TC, X0 + sp.st[k]]); }
    for (let k = 1; k <= sp.n; k++) { ev.push([sp.delStart + k * DC, sp.st[sp.n - k]]); cursor.push([sp.delStart + k * DC, X0 + sp.st[sp.n - k]]); }
    const cid = `tl${i}`;
    const rest = i === 0 ? n2(sp.st[sp.n] + 4) : 0; // resting state (no animation): first tagline shown
    s.defs.push(`<clipPath id="${cid}"><rect x="${n2(X0 - 2)}" y="${TY - 34}" width="${rest}" height="48">${discrete('width', ev, T, 'repeatCount="indefinite"')}</rect></clipPath>`);
    s.add(`<g clip-path="url(#${cid})">${s.text('M', sp.str, X0, TY, TS)}</g>`);
  });
  s.add(`<rect class="cur" x="${n2(X0 + spans[0].st[spans[0].n] + 6)}" y="${TY - 23}" width="13" height="28" fill="${C.lime}">${discrete('x', cursor, T, 'repeatCount="indefinite"')}</rect>`);

  // mascot + speech bubble + stickers
  const MX = 912, MY = 112, MS = 1.2;
  s.add(mascot({ x: MX, y: MY, scale: MS }));
  const says = ['gm, world!', 'ship it!!', 'brb, debugging', 'it works?!', 'snack o’clock'];
  const BX = 700, BY = 58, BW = 252, BH = 62;
  s.add(`<g class="float" style="animation-duration:5s">`,
    `<path d="M${BX + BW - 80} ${BY + BH - 6}L${BX + BW - 38} ${BY + BH - 6}L${BX + BW - 20} ${BY + BH + 26}Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`,
    `<rect x="${BX - 5}" y="${BY - 5}" width="${BW + 10}" height="${BH + 10}" rx="${BH / 2 + 5}" fill="#fff"/>`,
    `<rect x="${BX}" y="${BY}" width="${BW}" height="${BH}" rx="${BH / 2}" fill="${C.ink}" stroke="${C.dark}" stroke-width="3"/>`,
    `<path d="M${BX + BW - 76} ${BY + BH - 1.5}L${BX + BW - 40} ${BY + BH - 1.5}L${BX + BW - 24} ${BY + BH + 20}Z" fill="${C.ink}"/>`,
    `<path d="M${BX + BW - 40} ${BY + BH}L${BX + BW - 24} ${BY + BH + 20}L${BX + BW - 76} ${BY + BH}" fill="none" stroke="${C.dark}" stroke-width="3" stroke-linejoin="round"/>`,
    ...says.map((w, i) => s.text('B', w, BX + BW / 2, BY + 38, 21, { fill: C.dark, anchor: 'middle', cls: i ? 'say' : 'say first', style: `animation-delay:${n2(i * 2.5)}s` })),
    `</g>`);
  s.add(sticker(s, { x: 772, y: 446, rot: -6, label: 'full-stack goblin', bg: C.lime, delay: 1 }),
    sticker(s, { x: 1052, y: 452, rot: 5, label: 'prompt whisperer', bg: C.pink, delay: 2.4 }));

  s.add(spark(664, 184, 15, C.violet, 'tw', 0.4), spark(1170, 238, 11, C.lime, 'tw', 1.3), spark(642, 98, 9, C.cyan, 'tw', 2),
    spark(1176, 140, 8, C.cyan, 'tw', 0.9), spark(902, 484, 9, C.pink, 'tw', 1.7));
  s.add(`</g>`, `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="27.5" fill="none" stroke="#fff" stroke-opacity=".09"/>`);
  return s;
}

// ---------------------------------------------------------------- about (terminal)
function about() {
  const prompt = [['yash', C.lime], [':', C.dim], ['~', C.cyan], ['$ ', C.ink]];
  const L = [
    { cmd: 'whoami' },
    { out: [['yash', C.ink], [' · full-stack dev · builds web, mobile & AI things', C.dim]] },
    { cmd: 'cat now.txt' },
    { out: [['building Auréa', C.lime], [': experience gifting. app (expo) + site (woocommerce)', C.dim]] },
    { cmd: 'ls ~/stack' },
    { out: [['typescript/  react/  react-native/  next.js/  node/  python/  php/  llms/', C.cyan]] },
    { cmd: 'cat ~/.fuel' },
    { out: [['deadlines, lo-fi and an unreasonable number of open tabs', C.dim]] },
    { cmd: 'sudo make it-pop' },
    { out: [['[sudo] password for yash: ********', C.pink]] },
    { out: [['ok. adding 12% more pizzazz... done.', C.ink]] },
    { cmd: '' },
  ];
  const W = 1200, TOP = 104, LH = 38, FS = 20, X = 44;
  const H = TOP + (L.length - 1) * LH + 46;
  const s = new Svg(W, H, 'about me, as a terminal session');
  s.css.push(COMMON_CSS);
  s.defs.push(`<clipPath id="win"><rect width="${W}" height="${H}" rx="24"/></clipPath>`);
  s.add(`<g clip-path="url(#win)"><rect width="${W}" height="${H}" fill="#0D0D16"/>`,
    `<rect width="${W}" height="56" fill="#15151F"/><rect y="56" width="${W}" height="1" fill="#fff" fill-opacity=".07"/>`,
    `<circle cx="34" cy="28" r="7.5" fill="#FF5F57"/><circle cx="60" cy="28" r="7.5" fill="#FEBC2E"/><circle cx="86" cy="28" r="7.5" fill="#28C840"/>`,
    s.text('M', 'yash@internet: ~/about-me', W / 2, 33, 15, { fill: C.dim, anchor: 'middle' }),
    s.text('M', 'zsh', W - 34, 33, 14, { fill: C.faint, anchor: 'end' }));
  const pw = prompt.reduce((a, [t]) => a + s.measure('M', t, FS), 0);
  const CH = 0.06;
  let t = 0.8;
  const cursor = [];
  L.forEach((ln, i) => {
    const y = TOP + i * LH;
    if (ln.cmd != null) {
      const typeAt = t + 0.35, n = ln.cmd.length, st = s.stops('M', ln.cmd, FS);
      cursor.push([t, X + pw, y]);
      let g = `<g><set attributeName="opacity" to="0" dur="${n2(t)}s"/>${s.parts('M', prompt, X, y, FS)}`;
      if (n) {
        const cid = s.id('c');
        const dur = typeAt + n * CH;
        const vals = [0, ...st.slice(1)].map(n2).join(';');
        const keys = [0, ...st.slice(1).map((_, k) => +((typeAt + k * CH) / dur).toFixed(4))].join(';');
        s.defs.push(`<clipPath id="${cid}"><rect x="${n2(X + pw - 1)}" y="${y - 26}" width="${n2(st[n] + 4)}" height="36"><animate attributeName="width" dur="${n2(dur)}s" calcMode="discrete" values="${vals}" keyTimes="${keys}" fill="freeze"/></rect></clipPath>`);
        g += `<g clip-path="url(#${cid})">${s.text('M', ln.cmd, X + pw, y, FS)}</g>`;
        for (let k = 1; k <= n; k++) cursor.push([typeAt + (k - 1) * CH, X + pw + st[k], y]);
        t = typeAt + n * CH + 0.3;
      }
      s.add(g + '</g>');
    } else {
      cursor.push([t, -40, -40]);
      s.add(`<g><set attributeName="opacity" to="0" dur="${n2(t)}s"/>${s.parts('M', ln.out, X, y, FS)}</g>`);
      t += 0.14;
      if (L[i + 1] && L[i + 1].cmd != null) t += 0.4;
    }
  });
  const D = t + 0.01;
  const [, fx, fy] = cursor.at(-1);
  s.add(`<g><set attributeName="opacity" to="0" dur="0.8s"/><rect class="cur" x="${n2(fx)}" y="${n2(fy - 19)}" width="12" height="24" fill="${C.lime}">`
    + discrete('x', cursor.map(([tt, x]) => [tt, x]), D, 'fill="freeze"')
    + discrete('y', cursor.map(([tt, , y]) => [tt, y - 19]), D, 'fill="freeze"')
    + `</rect></g>`);
  s.add(`</g>`, `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" stroke="#fff" stroke-opacity=".1"/>`);
  return s;
}

// ---------------------------------------------------------------- stack (two crossing tapes)
function stack() {
  const W = 1200, H = 250;
  const s = new Svg(W, H, 'stack: TypeScript, React, React Native, Expo, Next.js, Node, Python, PHP, WordPress, LLMs and friends');
  const tapes = [
    { y: 152, rot: 3, bg: C.violet, fg: C.ink, dur: 34, dir: 1, items: ['LLMs', 'AGENTS', 'BERT', 'STREAMLIT', 'BULLMQ', 'SQLITE', 'RAZORPAY', 'WOOCOMMERCE', 'EAS', 'CLOUDFLARE', 'PLAYWRIGHT', 'TAILWIND'] },
    { y: 96, rot: -4, bg: C.lime, fg: C.dark, dur: 30, dir: -1, items: ['TYPESCRIPT', 'REACT', 'REACT NATIVE', 'EXPO', 'NEXT.JS', 'NODE', 'EXPRESS', 'PYTHON', 'FASTAPI', 'PHP', 'WORDPRESS', 'POSTGRES', 'OPENAI'] },
  ];
  s.defs.push(`<filter id="sh" x="-10%" y="-60%" width="120%" height="220%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000" flood-opacity=".35"/></filter>`);
  tapes.forEach((tp, ti) => {
    const FS = 23, GAP = 26, SR = 9, TH = 62;
    let seq = '', x = 0;
    for (const it of tp.items) {
      seq += s.text('B', it, x, 8, FS, { fill: tp.fg });
      x += s.measure('B', it, FS) + GAP;
      seq += `<g transform="translate(${n2(x)} 0) scale(${SR})"><path d="${SPARK}" fill="${tp.fg}"/></g>`;
      x += GAP;
    }
    const Lw = n2(x), reps = Math.ceil(1700 / Lw) + 1;
    s.css.push(`.m${ti}{animation:m${ti} ${tp.dur}s linear infinite}@keyframes m${ti}{from{transform:translateX(${tp.dir < 0 ? 0 : -Lw}px)}to{transform:translateX(${tp.dir < 0 ? -Lw : 0}px)}}`);
    let row = '';
    for (let r = 0; r < reps; r++) row += `<g transform="translate(${n2(r * Lw)} 0)">${seq}</g>`;
    s.add(`<g transform="translate(${W / 2} ${tp.y}) rotate(${tp.rot})" filter="url(#sh)">`,
      `<rect x="-900" y="${-TH / 2}" width="1800" height="${TH}" fill="${tp.bg}"/>`,
      `<rect x="-900" y="${-TH / 2 + 5}" width="1800" height="1.5" fill="${tp.fg}" opacity=".35"/><rect x="-900" y="${TH / 2 - 6.5}" width="1800" height="1.5" fill="${tp.fg}" opacity=".35"/>`,
      `<g transform="translate(-860 0)"><g class="m${ti}">${row}</g></g>`,
      `</g>`);
  });
  return s;
}

// ---------------------------------------------------------------- section header sticker
function header(label, bg, fg = C.dark) {
  const W = 1200, H = 84;
  const s = new Svg(W, H, label);
  s.css.push(COMMON_CSS);
  const FS = 22, w = s.measure('B', label, FS) + 56, x = (W - w) / 2;
  s.add(`<rect x="${n2(x - 5)}" y="12" width="${n2(w + 10)}" height="60" rx="30" fill="#fff"/>`,
    `<rect x="${n2(x)}" y="17" width="${n2(w)}" height="50" rx="25" fill="${bg}" stroke="${C.dark}" stroke-width="3"/>`,
    s.text('B', label, W / 2, 50, FS, { fill: fg, anchor: 'middle' }),
    spark(n2(x - 34), 42, 13, bg, 'spin'), spark(n2(x + w + 34), 42, 13, bg, 'spin'));
  return s;
}

// ---------------------------------------------------------------- project card
function card(p, i, info) {
  const W = 600, H = 270;
  const s = new Svg(W, H, `${p.title}: ${p.desc}`);
  const per = n2(2 * (W - 2 + H - 2) - 8 * 22 + 2 * Math.PI * 22);
  s.css.push(`.comet{animation:comet 7s linear infinite}@keyframes comet{from{stroke-dashoffset:0}to{stroke-dashoffset:-${per}px}}
.nudge{animation:nudge 2.2s ease-in-out infinite}@keyframes nudge{0%,100%{transform:translate(0,0)}50%{transform:translate(4px,-4px)}}`);
  s.defs.push(`<clipPath id="cc"><rect width="${W}" height="${H}" rx="22"/></clipPath>`,
    `<filter id="cg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>`);
  const idx = String(i + 1).padStart(2, '0');
  const live = p.live !== false && info.homepage;
  // title shrinks to fit
  let TS = 44;
  while (s.measure('D', p.title, TS) > W - 80 && TS > 26) TS -= 1;
  const words = p.desc.split(' '), lines = [];
  for (const w of words) {
    const cur = lines.at(-1);
    if (cur && s.measure('M', `${cur} ${w}`, 18) <= W - 72) lines[lines.length - 1] = `${cur} ${w}`;
    else lines.push(w);
  }
  s.add(`<g clip-path="url(#cc)"><rect width="${W}" height="${H}" fill="${C.card}"/>`,
    `<circle cx="${W - 40}" cy="40" r="140" fill="${p.accent}" opacity=".07"/>`,
    `<g opacity=".16" fill="none" stroke="${p.accent}" stroke-width="${n2(1.6 / (200 / FONTS.D.upm))}">${s.run('D', idx, W - 18, H + 38, 200, { anchor: 'end' })}</g>`,
    s.text('B', `${idx} /`, 36, 50, 16, { fill: p.accent }),
    s.text('D', p.title, 36, 104, TS),
    ...lines.slice(0, 3).map((ln, k) => s.text('M', ln, 36, 146 + k * 27, 18, { fill: C.dim })),
    `<circle cx="44" cy="${H - 37}" r="7" fill="${info.langColor || C.dim}"/>`,
    s.text('M', info.lang || 'code', 60, H - 31, 16, { fill: C.dim }));
  const lx = 60 + s.measure('M', info.lang || 'code', 16) + 26;
  s.add(`<polygon points="${star5(lx + 8, H - 37, 9)}" fill="${C.ink}" opacity=".8"/>`,
    s.text('M', String(info.stars ?? 0), lx + 24, H - 31, 16, { fill: C.dim }));
  const pill = live ? 'live ↗' : 'repo →';
  const pw = s.measure('B', pill, 15) + 30;
  s.add(`<g class="nudge"><rect x="${n2(W - 32 - pw)}" y="28" width="${n2(pw)}" height="32" rx="16" fill="${live ? p.accent : 'none'}" stroke="${p.accent}" stroke-width="2"/>`,
    s.text('B', pill, W - 32 - pw / 2, 49, 15, { fill: live ? C.dark : p.accent, anchor: 'middle' }), `</g>`);
  s.add(`</g>`,
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="none" stroke="${C.line}" stroke-width="1.5"/>`,
    `<rect class="comet" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="none" stroke="${p.accent}" stroke-width="5" stroke-dasharray="150 ${n2(per - 150)}" filter="url(#cg)" style="animation-delay:-${n2(i * 1.3)}s"/>`,
    `<rect class="comet" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="none" stroke="${p.accent}" stroke-width="2" stroke-dasharray="150 ${n2(per - 150)}" stroke-linecap="round" style="animation-delay:-${n2(i * 1.3)}s"/>`);
  return s;
}

// ---------------------------------------------------------------- stats
function odometer(s, value, x, y, size, delay) {
  const F = 'D', str = String(value);
  const digitW = Math.max(...'0123456789'.split('').map((d) => s.measure(F, d, size)));
  const LH = Math.round(size * 1.05);
  let out = '', cx = x;
  [...str].forEach((ch, i) => {
    if (!/\d/.test(ch)) { out += s.text(F, ch, cx, y, size); cx += s.measure(F, ch, size); return; }
    const cid = s.id('od');
    s.defs.push(`<clipPath id="${cid}"><rect x="${n2(cx - 2)}" y="${n2(y - size * 0.82)}" width="${n2(digitW + 4)}" height="${n2(size * 0.98)}"/></clipPath>`);
    let col = '';
    for (let r = 0; r < 20; r++) col += s.run(F, String(r % 10), cx + digitW / 2, y + r * LH, size, { anchor: 'middle' });
    out += `<g clip-path="url(#${cid})"><g class="od od${ch}" fill="${C.ink}" style="animation-delay:${n2(delay + i * 0.12)}s">${col}</g></g>`;
    cx += digitW;
  });
  s.odLH = LH;
  return { svg: out, width: cx - x };
}

function stats(d) {
  const W = 1200, H = 410;
  const days = d.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const total = d.contributionsCollection.contributionCalendar.totalContributions;
  let longest = 0, run = 0;
  for (const x of days) { run = x.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else if (i === days.length - 1) continue; // today isn't over yet
    else break;
  }
  const repos = d.repositories.nodes;
  const stars = repos.reduce((a, r) => a + r.stargazerCount, 0);
  const SKIP = new Set(['HTML', 'CSS', 'SCSS', 'Shell', 'Batchfile', 'PowerShell', 'Dockerfile', 'Makefile', 'Procfile']);
  const bytes = new Map(), colors = new Map();
  for (const r of repos) for (const e of r.languages.edges) {
    if (SKIP.has(e.node.name)) continue;
    bytes.set(e.node.name, (bytes.get(e.node.name) || 0) + e.size); colors.set(e.node.name, e.node.color);
  }
  const sum = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
  let langs = [...bytes].sort((a, b) => b[1] - a[1]).map(([n, b]) => ({ n, p: (b / sum) * 100, c: colors.get(n) || C.dim }));
  if (langs.length > 4) langs = [...langs.slice(0, 3), { n: 'other', p: langs.slice(3).reduce((a, l) => a + l.p, 0), c: C.faint }];

  const s = new Svg(W, H, `stats: ${total} contributions in the last year, ${d.repositories.totalCount} public repos, ${stars} stars`);
  s.css.push(COMMON_CSS, [...Array(10).keys()].map((k) => `.od${k}{animation-name:od${k};transform:translateY(-${(10 + k) * Math.round(54 * 1.05)}px)}@keyframes od${k}{from{transform:translateY(0)}to{transform:translateY(-${(10 + k) * Math.round(54 * 1.05)}px)}}`).join(''),
    `.od{animation-duration:2s;animation-timing-function:cubic-bezier(.16,.9,.24,1);animation-fill-mode:backwards}
.grow{transform-box:fill-box;transform-origin:left center;animation:grow 1.6s cubic-bezier(.2,.8,.2,1) .4s backwards}@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.fade{animation:fade 1s ease 2s backwards}@keyframes fade{from{opacity:0}to{opacity:1}}
.ping{transform-box:fill-box;transform-origin:center;animation:ping 1.8s ease-out 2.6s infinite both}@keyframes ping{0%{transform:scale(1);opacity:.8}100%{transform:scale(3.2);opacity:0}}`);
  s.defs.push(`<clipPath id="sc"><rect width="${W}" height="${H}" rx="26"/></clipPath>`,
    `<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.lime}" stop-opacity=".35"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></linearGradient>`);
  s.add(`<g clip-path="url(#sc)"><rect width="${W}" height="${H}" fill="${C.card}"/>`,
    `<circle cx="80" cy="420" r="220" fill="${C.violet}" opacity=".08"/>`,
    s.text('D', 'the numbers', 48, 80, 40),
    spark(n2(48 + s.measure('D', 'the numbers', 40) + 26), 58, 13, C.lime, 'spin'));
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  s.add(s.text('M', `refreshed daily by a very diligent robot · ${date}`, W - 48, 74, 15, { fill: C.faint, anchor: 'end' }));

  const tiles = [
    { v: total, label: 'contributions, last year', accent: C.lime },
    { v: longest, label: current ? `best streak (days) · now ${current}` : 'best streak (days)', accent: C.pink },
    { v: d.repositories.totalCount, label: 'public repos (+ secret ones)', accent: C.cyan },
    { v: stars, label: stars ? 'stars. legends, all of you' : 'stars. be the first!', accent: C.orange },
  ];
  tiles.forEach((tl, i) => {
    const x = 48 + (i % 2) * 316, y = 118 + Math.floor(i / 2) * 140, w = 300, h = 122;
    const od = odometer(s, tl.v, x + 24, y + 70, 54, 0.3 + i * 0.25);
    s.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fff" fill-opacity=".035" stroke="#fff" stroke-opacity=".08"/>`,
      `<rect x="${x}" y="${y + 22}" width="4" height="40" rx="2" fill="${tl.accent}"/>`,
      od.svg, s.text('M', tl.label, x + 24, y + 102, 15, { fill: C.dim }));
  });

  // language mix
  const LX = 704, LW = 448;
  s.add(s.text('B', 'language mix', LX, 140, 16, { fill: C.ink }),
    s.text('M', '(public repos, markup excluded)', LX + s.measure('B', 'language mix ', 16), 140, 14, { fill: C.faint }));
  s.defs.push(`<clipPath id="bar"><rect x="${LX}" y="156" width="${LW}" height="18" rx="9"/></clipPath>`);
  let bx = LX, bar = '';
  langs.forEach((l, i) => {
    const w = (l.p / 100) * LW;
    bar += `<rect x="${n2(bx)}" y="156" width="${n2(Math.max(w, 0.5) + (i < langs.length - 1 ? 2 : 0))}" height="18" fill="${l.c}"/>`;
    bx += w;
  });
  s.add(`<g clip-path="url(#bar)"><g class="grow">${bar}</g></g>`);
  langs.forEach((l, i) => {
    const x = LX + (i % 2) * 230, y = 204 + Math.floor(i / 2) * 26;
    s.add(`<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${l.c}"/>`,
      s.text('M', l.n, x + 20, y, 15, { fill: C.ink }),
      s.text('M', `${l.p.toFixed(1)}%`, x + 20 + s.measure('M', `${l.n} `, 15), y, 15, { fill: C.faint }));
  });

  // 52-week sparkline
  const weeks = d.contributionsCollection.contributionCalendar.weeks.map((w) => w.contributionDays.reduce((a, x) => a + x.contributionCount, 0)).slice(-52);
  const GX = LX, GY = 290, GW = LW, GH = 82, max = Math.max(1, ...weeks);
  s.add(s.text('B', 'activity', GX, GY - 8, 16), s.text('M', '(weekly, last 52 weeks)', GX + s.measure('B', 'activity ', 16), GY - 8, 14, { fill: C.faint }));
  const pts = weeks.map((v, i) => [GX + (i / (weeks.length - 1)) * GW, GY + 14 + GH - (v / max) * GH]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${n2(p[0])} ${n2(p[1])}`).join('');
  const peak = weeks.indexOf(max), pp = pts[peak];
  s.css.push(`.draw{animation:draw 2.4s cubic-bezier(.3,.7,.2,1) .6s backwards}@keyframes draw{from{stroke-dashoffset:${n2(len + 2)}px}to{stroke-dashoffset:0}}`);
  s.add(`<path class="fade" d="${line}L${GX + GW} ${GY + 14 + GH}L${GX} ${GY + 14 + GH}Z" fill="url(#area)"/>`,
    `<path class="draw" d="${line}" stroke="${C.lime}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" fill="none" stroke-dasharray="${n2(len + 2)}"/>`,
    `<circle class="ping" cx="${n2(pp[0])}" cy="${n2(pp[1])}" r="5" fill="${C.pink}"/><circle class="fade" cx="${n2(pp[0])}" cy="${n2(pp[1])}" r="5" fill="${C.pink}" stroke="${C.card}" stroke-width="2"/>`,
    `<g class="fade">${s.text('M', `peak: ${max}`, n2(Math.min(pp[0] + 12, GX + GW - 70)), n2(Math.max(pp[1] - 4, GY + 8)), 13, { fill: C.pink })}</g>`);
  s.add(`</g>`, `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="25.5" fill="none" stroke="#fff" stroke-opacity=".09"/>`);
  return s;
}

// ---------------------------------------------------------------- footer
function footer() {
  const W = 1200, H = 230;
  const s = new Svg(W, H, 'thanks for scrolling');
  s.css.push(COMMON_CSS);
  s.defs.push(`<clipPath id="fc"><rect width="${W}" height="${H}" rx="26"/></clipPath>`);
  s.add(`<g clip-path="url(#fc)"><rect width="${W}" height="${H}" fill="${C.bg}"/>`,
    `<circle cx="1100" cy="250" r="200" fill="${C.pink}" opacity=".1"/>`,
    mascot({ x: 70, y: 18, scale: 0.82 }),
    s.text('D', 'thanks for scrolling', 300, 112, 54),
    s.text('M', 'now go drink some water. then maybe star something.', 302, 156, 19, { fill: C.dim }),
    s.text('M', 'made with way too much svg', W - 40, H - 30, 13, { fill: C.faint, anchor: 'end' }),
    spark(1110, 70, 16, C.lime, 'tw', 0.2), spark(1050, 140, 9, C.violet, 'tw', 1.1), spark(1150, 150, 7, C.cyan, 'tw', 1.8),
    `</g>`, `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="25.5" fill="none" stroke="#fff" stroke-opacity=".09"/>`);
  return s;
}

// ---------------------------------------------------------------- data + write
async function getData() {
  const query = fs.readFileSync(path.join(ROOT, 'scripts', 'query.graphql'), 'utf8');
  if (process.env.DATA_FILE) return JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8')).data.user;
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.warn('no GITHUB_TOKEN: keeping the last stats and cards'); return null; }
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': `${LOGIN}-profile` },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.data || !j.data.user) { console.warn('GraphQL failed, keeping the last stats and cards:', JSON.stringify(j).slice(0, 300)); return null; }
  return j.data.user;
}

const write = (name, svg) => {
  const file = path.join(ASSETS, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg.toString());
  console.log(`${name.padEnd(28)} ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
};

const data = await getData();
write('hero.svg', hero());
write('about.svg', about());
write('stack.svg', stack());
write('built.svg', header("things i've built (and mostly didn't break)", C.lime));
write('wild.svg', header("sites i've released into the wild", C.pink));
write('snake-title.svg', header('a snake is eating my contribution graph. as one does.', C.violet, C.ink));
write('footer.svg', footer());
if (data) {
  const byName = new Map(data.repositories.nodes.map((r) => [r.name.toLowerCase(), r]));
  FEATURED.forEach((p, i) => {
    const r = byName.get(p.repo.toLowerCase()) || {};
    write(`cards/${p.repo.toLowerCase()}.svg`, card(p, i, {
      stars: r.stargazerCount, homepage: r.homepageUrl,
      lang: r.primaryLanguage && r.primaryLanguage.name, langColor: r.primaryLanguage && r.primaryLanguage.color,
    }));
  });
  write('stats.svg', stats(data));
}
