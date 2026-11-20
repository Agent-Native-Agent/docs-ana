'use strict';
// xml.js — 작은 XML 파서(요소·속성·텍스트). 네임스페이스 접두사는 이름에 그대로 남긴다(hp:p 등).
// 노드: { name, attrs:{}, children:[node|string] } — 편의 함수 text()/find()/findAll() 포함.
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e in ENT ? ENT[e] : m;
  });
}
const ATTR_RE = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function parse(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0; const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { const t = src.slice(i); if (t.trim()) stack[stack.length - 1].children.push(decode(t)); break; }
    if (lt > i) { const t = src.slice(i, lt); if (t.trim() || stack.length > 1) stack[stack.length - 1].children.push(decode(t)); }
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); stack[stack.length - 1].children.push(src.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    // 태그 끝 찾기(속성값 안의 '>' 고려)
    let j = lt + 1, q = null;
    while (j < n) { const c = src[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    const inner = src.slice(lt + 1, j);
    i = j + 1;
    if (inner[0] === '/') { const name = inner.slice(1).trim(); for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; } continue; }
    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    const sp = body.search(/[\s]/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const node = { name, attrs: {}, children: [] };
    if (sp >= 0) { let m; ATTR_RE.lastIndex = 0; const rest = body.slice(sp); while ((m = ATTR_RE.exec(rest))) node.attrs[m[1]] = decode(m[2] !== undefined ? m[2] : m[3]); }
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}
function text(node) {
  if (typeof node === 'string') return node;
  let s = '';
  for (const c of node.children) s += text(c);
  return s;
}
function find(node, name) { return node.children.find((c) => typeof c !== 'string' && c.name === name) || null; }
function findAll(node, name) { return node.children.filter((c) => typeof c !== 'string' && c.name === name); }
function elements(node) { return node.children.filter((c) => typeof c !== 'string'); }
// 깊이 우선 전체 탐색
function descendants(node, name, out = []) {
  for (const c of node.children) { if (typeof c === 'string') continue; if (!name || c.name === name) out.push(c); descendants(c, name, out); }
  return out;
}
module.exports = { parse, text, find, findAll, elements, descendants, decode };
