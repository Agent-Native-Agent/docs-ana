'use strict';
// nrf-api.js — 문서(한/글 HWP·HWPX, Word DOCX, 그 밖은 올릴 때 작업용 DOCX 로 바꿈 — lib/convert.js) 공동 수정 백엔드. 의존성 없음. channel-core 의 extraApi 훅에 꽂힌다.
//
// 저장(ANA_DATA_DIR/nrf/docs/<id>/):  original.hwpx|hwp (올린 그대로, 바꾸지 않는다) · meta.json · state.json
//   state = { rev, seq, paras: { <문단키>: { segs, rev, added? } }, comments: [{id, cid, by, at, text}] }
//   · 고친 문단만 들어 있다. 조각(segs) 모양은 lib/track.js.
//   · 문단키: 원본 문단 = "<구역>.<번호>" (HWPX 는 구역 XML 의 hp:p 순서 번호), 새 문단 = "a<번호>" (added.after 뒤에 놓인다)
//
// 라우트 (에이전트도 curl 로 같은 API 를 쓴다)
//   GET    /api/nrf/me
//   GET    /api/nrf/docs                         문서 목록
//   POST   /api/nrf/docs {name, data(base64)}    올리기(.hwp/.hwpx)
//   DELETE /api/nrf/docs/:id                     지우기(올린 사람)
//   POST   /api/nrf/docs/:id/members {email}      작성자 등록(올린 사람·관리자) — 등록된 작성자만 문서를 열고 고친다
//   DELETE /api/nrf/docs/:id/members/:email       작성자 빼기
//   POST   /api/nrf/docs/:id/members/:email/role {role: edit|view|manage}  작성자 권한(편집 · 보기 · 관리) — 관리는 공유·권한도 바꾼다
//   POST   /api/nrf/docs/:id/join                  등록 요청(작성자가 아닌 사람이 공유 주소로 왔을 때)
//   GET    /api/nrf/docs/:id/refs                 참고 폴더: {folders, files} (등록된 작성자)
//   POST   /api/nrf/docs/:id/refs {name, data(base64), folder?}   참고 파일 올리기(아무 형식, 20MB 까지)
//   GET    /api/nrf/docs/:id/refs/:fid            참고 파일 받기(그림·PDF 는 바로 보기)
//   POST   /api/nrf/docs/:id/refs/:fid {from?, note?}   누구 자료인지(제공자)와 메모 적기(올린 사람·문서 올린 사람)
//   DELETE /api/nrf/docs/:id/refs/:fid            지우기(올린 사람·문서 올린 사람)
//   POST   /api/nrf/docs/:id/refs/folders {name}  폴더 만들기 · DELETE …/refs/folders/:name  빈 폴더 지우기
//   POST   /api/nrf/docs/:id/table {tbl, op:'row', after}            표에 행 추가(after 행 아래 — 위에서 내려온 병합 칸은 함께 늘어난다)
//   POST   /api/nrf/docs/:id/table {tbl, op:'merge', a:[행,열], dir:'down'|'right'}   칸 병합(합쳐지는 칸은 비어 있어야 한다)
//   대신 입력(관리자): edit·para·table·comments 본문에 as:<등록된 작성자 이메일> 을 넣으면 그 사람 이름의 변경으로 남는다(누가 대신 넣었는지 via 로 기록)
//   POST   /api/nrf/people {email, name?, color?}  사람의 표시 이름·색 정하기(관리자) — nrf/names.json · nrf/colors.json
//   암호 입장(구글 로그인 없이): 관리자가 문서에 암호를 걸면, 주소 /nrf.html?doc=<id> 에서 이름+암호로 들어온다
//   POST   /api/nrf/docs/:id/guest {password} | {off:true}   암호 설정·끄기(관리자만)
//   GET    /api/nrf/guest/info?doc=<id>            {on}  (로그인 없이)
//   POST   /api/nrf/guest/login {doc, name, password}  → {token}  (로그인 없이 · 틀리면 잠깐 잠김)
//   GET    /api/nrf/stream                         이 화면용 실시간 알림(SSE) — 열 수 있는 문서의 알림만 간다
//   손님 토큰은 x-nrf-guest 헤더나 ?g= 로 보낸다. 손님은 그 문서 하나만 열고 고친다.
//   공유 주소: /?doc=<id>  (메인 화면이 그 문서를 연다)
//   GET    /api/nrf/docs/:id                     {doc, view, state, changes, authors, me}
//   GET    /api/nrf/docs/:id/state               {state, changes, authors} (실시간 갱신용)
//   POST   /api/nrf/docs/:id/edit {key, base, text}   문단의 최종 글을 base → text 로(차이를 변경으로 기록). base 가 지금과 다르면 409
//   POST   /api/nrf/docs/:id/para {after, text}       after 문단 뒤에 새 문단
//   POST   /api/nrf/docs/:id/para {del: 문단키}       문단(줄) 지우기 — 빈 줄은 '문단 삭제' 표시, 글이 있으면 글을 모두 지움
//   POST   /api/nrf/docs/:id/table {tbl, op:'split', a:[행,열], cuts?:[{row, paras?:[문단키]}]}   여러 행에 걸친 칸을 행 경계에서 나눔
//   POST   /api/nrf/docs/:id/format {items:[{key,a,b}], set:{b,i,u,sz,c} | clear:true | align}   글자 서식(최종 글의 a~b) · 문단 정렬
//   POST   /api/nrf/docs/:id/revert {cid}             변경 되돌리기(그 변경을 한 사람)
//   POST   /api/nrf/docs/:id/comments {cid, text}     변경에 코멘트
//   DELETE /api/nrf/docs/:id/comments/:cmid
//   GET    /api/nrf/docs/:id/final.hwpx | final.txt | original     내려받기
//   GET    /api/nrf/docs/:id/image?name=          문서 안 그림
// 바뀌면 SSE(/api/stream)로 {kind:'nrf', docId, rev, by} 를 방송한다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hwp5 = require('./lib/hwp5');
const hwpx = require('./lib/hwpx');
const track = require('./lib/track');
const hwpxEdit = require('./lib/hwpx-edit');
const zip = require('./lib/zip');
const SRC = require('./lib/sources');
const docx = require('./lib/docx');
const convert = require('./lib/convert');
const pdfexport = require('./lib/pdfexport');              // 지금 보기대로(메모 · 수정사항) PDF 내보내기
const docxexport = require('./lib/docxexport');
const fixedexport = require('./lib/fixedexport');          // Word 내보내기 — PDF 와 쪽 수 · 서식이 같게
const aitell = require('./lib/aitell/detect.js');            // 표현점검: AI스러운 표현 탐지(유형 94개) — 출처·라이선스는 lib/aitell/NOTICE.md
const aitellCatalog = require('./lib/aitell/catalog.js');
const DR = require('./lib/docreview/rules.js');
const DRO = require('./lib/docreview/owner-rules.js');           // 주인이 지적해 온 것을 규칙으로(2026-11-19)                 // 문서검토: AI 작성 신호를 문단·문장·단어·조판으로(사용자가 준 doc-review 패키지) — lib/docreview/NOTICE.md
const DR_REVIEWER = require('./lib/docreview/ai.js').REVIEWER;

const MAX_UPLOAD = 30e6;
const MAX_PARA = 20000;
const MAX_COMMENT = 4000;
const MAX_REF = 20e6;            // 참고 파일 하나
const MAX_REF_DOC = 200e6;       // 문서 하나의 참고 폴더 전체
const MIN_FREE = 150e6;          // 디스크 여유가 이보다 적으면 올리기를 받지 않는다
const REF_INLINE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
const DEFAULT_FOLDER = '참고 파일';
const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };

function createNrfApi(core, opts) {
  const { DATA_DIR, ID_HEADER = '', USERS_FILE = '', dash = null } = opts;
  // 관리자: 로고 햄버거(ANA 메뉴)·컨텍스트 칩·에이전트 대화가 보이는 사람. NRF_ADMINS(쉼표) 로 바꾼다.
  const ADMINS = new Set(String(process.env.NRF_ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const isAdmin = (email) => ADMINS.has(email) || (!ID_HEADER && email === 'ana');
  const DOCS = path.join(DATA_DIR, 'nrf', 'docs');
  fs.mkdirSync(DOCS, { recursive: true });
  const sendJson = core.sendJson;
  let appBroadcast = () => {};
  const streams = new Set();    // 이 화면용 SSE 구독자 {res, me}
  // 알림은 그 문서를 열 수 있는 사람에게만 보낸다(문서 id 가 없는 알림은 로그인한 사람에게만)
  // 한 사람에게만 보내는 알림(올리기 진행 상황)
  function sendTo(who, ev) { for (const c of streams) if (c.me === who) try { c.res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} }
  function broadcast(ev) {
    try { appBroadcast(ev); } catch {}
    const m = ev.docId ? readJson(path.join(DOCS, ev.docId, 'meta.json'), null) : null;
    for (const c of streams) {
      let ok;
      if (ev.docId) { if (m) { if (!Array.isArray(m.members)) m.members = [m.uploader]; ok = canOpen(m, c.me) || (ev.join && false); } else ok = ev.deleted && (!isGuest(c.me) || guestDoc(c.me) === ev.docId); }
      else ok = !isGuest(c.me);
      if (ok) try { c.res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
    }
  }
  setInterval(() => { for (const c of streams) try { c.res.write(': ping\n\n'); } catch {} }, 25000).unref();
  const cache = new Map();     // id → {doc(parsed), view, index, origKeys}
  const states = new Map();    // id → state

  // ---------- 신원 ----------
  // 요청한 사람:
  //   로그인한 사람  = 게이트웨이가 붙인 이메일
  //   손님          = 유효한 손님 토큰 → 'g-<손님id>.<문서id>@guest'
  //   ''            = 게이트웨이를 거쳐 왔지만 로그인도 토큰도 없는 사람(아무것도 못 한다)
  //   'ana'         = 이 서버 안에서 온 호출(에이전트·스크립트) — 게이트웨이 표시가 없는 요청만
  const viaGateway = (req) => !!(req.headers['x-anahub-public-view'] || req.headers['x-forwarded-host'] || req.headers['x-forwarded-for']);
  function who(req, url) {
    const e = ID_HEADER ? String(req.headers[ID_HEADER.toLowerCase()] || '').trim().toLowerCase() : '';
    if (e) return e;
    const tok = String(req.headers['x-nrf-guest'] || (url && url.searchParams.get('g')) || '');
    if (tok) { const g = guestOf(tok); if (g) return g; }
    return viaGateway(req) ? '' : 'ana';
  }
  const isGuest = (w) => /^g-[a-f0-9]{8}\.[a-f0-9]{12}@guest$/.test(w);
  const guestDoc = (w) => w.slice(11, 23);
  // ---------- 손님(암호 입장) ----------
  const SECRET = (() => { const f = path.join(DATA_DIR, 'nrf', 'secret'); try { return fs.readFileSync(f); } catch { const k = crypto.randomBytes(32); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, k, { mode: 0o600 }); return k; } })();
  const b64 = (b) => Buffer.from(b).toString('base64url');
  const sign = (body) => b64(crypto.createHmac('sha256', SECRET).update(body).digest());
  const pwHash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  function guestToken(docId, gid, ver, link) { const body = b64(JSON.stringify({ d: docId, g: gid, v: ver, ...(link ? { k: 'l', x: Date.now() + 3650 * 86400e3 } : { x: Date.now() + 30 * 86400e3 }) })); return `${body}.${sign(body)}`; }
  function guestOf(tok) {
    const [body, sig] = tok.split('.'); if (!body || !sig) return null;
    const want = sign(body); if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
    if (!p || p.x < Date.now() || !/^[a-f0-9]{12}$/.test(p.d) || !/^[a-f0-9]{8}$/.test(p.g)) return null;
    const m = readJson(path.join(DOCS, p.d, 'meta.json'), null);
    if (!m) return null;
    if (p.k === 'l') { if (!m.link || !m.link.on || m.link.ver !== p.v) return null; }       // 링크 공유를 끄면 그 전 토큰은 못 쓴다
    else if (!m.guest || !m.guest.on || m.guest.ver !== p.v) return null;        // 암호를 바꾸거나 끄면 그 전 토큰은 못 쓴다
    return `g-${p.g}.${p.d}@guest`;
  }
  const fails = new Map();      // 문서:주소 → {n, until}
  const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  function profileOf(email) { try { const u = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); return (u && u.users && u.users[email]) || {}; } catch { return {}; } }
  const peopleFile = (n) => path.join(DATA_DIR, 'nrf', `${n}.json`);
  const colorOf = (email) => { const c = readJson(peopleFile('colors'), {})[email]; return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined; };
  function nameOf(email) {
    if (email === 'ana') return 'ANA';
    { const n = readJson(peopleFile('names'), {})[email]; if (n) return String(n); }      // 관리자가 정한 표시 이름이 먼저
    try { const u = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); const n = u && u.users && u.users[email] && u.users[email].name; if (n) return String(n); } catch {}
    // 아직 로그인한 적 없는 작성자의 이름: nrf/names.json {이메일: 이름} (작성자 등록 때 적어 둔다)
    try { const n = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'nrf', 'names.json'), 'utf8'))[email]; if (n) return String(n); } catch {}
    return email.split('@')[0];
  }

  // ---------- 저장 ----------
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, o) => { const t = `${f}.tmp${process.pid}`; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, f); };
  const dirOf = (id) => path.join(DOCS, id);
  const okId = (id) => /^[a-f0-9]{12}$/.test(id) && fs.existsSync(path.join(dirOf(id), 'meta.json'));
  const metaOf = (id) => {
    const m = readJson(path.join(dirOf(id), 'meta.json'), null);
    if (m && !Array.isArray(m.members)) m.members = [...new Set([m.uploader, ...(m.authors || [])])];   // 예전 문서: 올린 사람 + 고친 사람
    if (m && !Array.isArray(m.requests)) m.requests = [];
    return m;
  };
  const saveMeta = (id, m) => writeJson(path.join(dirOf(id), 'meta.json'), m);
  // 문서를 열고 고칠 수 있는 사람: 등록된 작성자 · 관리자 · 로컬 에이전트(헤더 없음 = 'ana')
  const canOpen = (m, who) => !!who && (who === 'ana' || isAdmin(who) || m.members.includes(who) || (isGuest(who) && guestDoc(who) === m.id && !!((m.guest && m.guest.on) || (m.link && m.link.on))));
  // 작성자마다 권한: edit(편집 · 기본) · view(보기) · manage(편집 + 공유·권한 관리). 올린 사람은 늘 관리
  const roleOf = (m, e) => (e === m.uploader ? 'owner' : ((m.roles || {})[e] || 'edit'));
  const canManage = (m, who) => !!who && (who === 'ana' || isAdmin(who) || m.uploader === who || (m.members.includes(who) && roleOf(m, who) === 'manage'));
  // 대신 입력: 관리자가 본문에 as 를 넣으면 그 작성자(이 문서에 등록된 사람) 이름으로 기록한다
  function actorOf(meta, me, body) {
    const as = body && typeof body.as === 'string' ? body.as.trim().toLowerCase() : '';
    if (!as || as === me) return { by: me };
    if (!(me === 'ana' || isAdmin(me))) return { error: '다른 사람 이름으로 넣는 것은 관리자만 할 수 있습니다' };
    if (!meta.members.includes(as)) return { error: '이 문서에 등록된 작성자의 이름으로만 넣을 수 있습니다' };
    return { by: as, via: me };
  }
  function markVia(id, cids, via) {
    if (!via || !cids || !cids.length) return;
    const s = stateOf(id); if (!s.via) s.via = {};
    for (const c of cids) if (!s.via[c]) s.via[c] = via;
    writeJson(path.join(dirOf(id), 'state.json'), s);
  }
  // 화면에 주는 암호 입장 정보 — 암호(해시)는 절대 내보내지 않는다. 들어온 손님 목록은 관리자에게만.
  const linkOn = (m) => !!(m && m.link && m.link.on);
  // 보기 전용: 링크로 들어온 사람(링크가 보기 전용일 때) · 암호로 들어온 손님(암호가 보기 전용일 때). 직접 등록한 작성자 · 주인 · 관리자는 늘 고칠 수 있다
  const viewOnly = (m, who) => {
    if (!who || who === 'ana' || canManage(m, who)) return false;
    if (m.members.includes(who) && !(m.link && (m.link.joined || []).includes(who))) return roleOf(m, who) === 'view';
    if (isGuest(who)) return !!(m.guest && m.guest.on && m.guest.role === 'view') && !(m.link && m.link.on && m.link.role !== 'view');
    return !!(m.link && m.link.on && m.link.role === 'view' && (m.link.joined || []).includes(who));
  };
  const linkInfo = (m, who) => ({ on: linkOn(m), role: (m.link && m.link.role) || 'edit', ...(canManage(m, who) ? { at: m.link && m.link.at, log: ((m.link && m.link.log) || []).slice(-30) } : {}) });
  const guestInfo = (m, who) => ({ on: !!(m.guest && m.guest.on), role: (m.guest && m.guest.role) || 'edit', ...(who === 'ana' || isAdmin(who) ? { at: m.guest && m.guest.at, log: ((m.guest && m.guest.log) || []).slice(-30) } : {}) });
  const okEmail = (e) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) && e.length <= 200;
  function stateOf(id) {
    let s = states.get(id);
    if (!s) {
      s = readJson(path.join(dirOf(id), 'state.json'), null) || { rev: 0, seq: 0, paras: {}, comments: [] };
      states.set(id, s);
    }
    return s;
  }
  function saveState(id, by) {
    const s = stateOf(id);
    s.rev++;
    writeJson(path.join(dirOf(id), 'state.json'), s);
    const meta = metaOf(id);
    if (meta) { meta.updatedAt = Date.now(); meta.changes = changesOf(id).length; try { meta.preview = previewOf(id); } catch {} if (by && !meta.authors.includes(by)) meta.authors.push(by); saveMeta(id, meta); }
    broadcast({ kind: 'nrf', docId: id, rev: s.rev, by });
    mirrorSoon();
  }
  function listDocs() {
    let ids = []; try { ids = fs.readdirSync(DOCS); } catch {}
    return ids.map((id) => metaOf(id)).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  }
  // Work 그래프(work-graph.json)의 docs 배열에 문서 목록을 비춘다 — Knowledge 그래프에 문서가 보이게
  let mirrorTimer = null;
  function mirrorSoon() { if (!dash || mirrorTimer) return; mirrorTimer = setTimeout(() => { mirrorTimer = null; mirror(); }, 3000); }
  function mirror() {
    if (!dash) return;
    try {
      const data = dash.loadData();
      data.docs = listDocs().map((m) => ({ id: `doc-${m.id}`, title: m.name, format: m.format, uploader: m.uploader, authors: m.authors, changes: m.changes || 0, date: new Date(m.createdAt).toISOString().slice(0, 10), updatedAt: m.updatedAt }));
      dash.saveData(data);
    } catch (e) { console.error('[nrf] mirror failed:', e.message); }
  }

  // 한/글이 아닌 문서는 DOCX 로 읽고 쓴다: DOCX 는 올린 그대로, 그 밖(PDF·PPTX·XLSX·TXT …)은 올릴 때 만든 작업용 work.docx
  const isHwp = (meta) => meta.format === 'hwpx' || meta.format === 'hwp';
  const workFile = (id, meta) => path.join(dirOf(id), isHwp(meta) || meta.format === 'docx' ? `original.${meta.format}` : 'work.docx');

  // ---------- 문서 읽기 → 화면용 구조 ----------
  function loadDoc(id) {
    let rec = cache.get(id);
    if (rec) return rec;
    const meta = metaOf(id);
    const t0 = Date.now();
    const buf = fs.readFileSync(workFile(id, meta));
    const doc = meta.format === 'hwpx' ? hwpx.parse(buf) : meta.format === 'hwp' ? hwp5.parse(buf) : docx.parse(buf);
    if (doc.format === 'docx' && !doc.lrpb) { const hints = readJson(path.join(dirOf(id), 'pages.json'), null); if (hints) docx.applyPageHints(doc, hints); }      // Word 가 쪽 나눔을 적지 않은 문서: 올릴 때 계산해 둔 쪽 나눔
    // 한/글: 쪽 단위로 그리도록 쪽 나눔을 문단에 적는다 — 쪽 나누기(pageBreak) · 새 구역 · 줄 배치(lineseg)의 세로 위치가 다시 0 으로 돌아간 곳.
    // 줄 배치가 없는 파일(다른 프로그램이 만든 HWPX)도 있어, 화면이 용지 높이를 재서 넘치는 곳에서 한 번 더 나눈다(view.auto).
    if (!doc.sects && (doc.format === 'hwpx' || doc.format === 'hwp')) {
      doc.sections.forEach((sec, si) => {
        let last = null;
        sec.paragraphs.forEach((p, i) => {
          if (i === 0) { if (si > 0) { p.sect = si; p.pb = 1; } }
          else if (p.pageBreak) p.pb = 1;
          const ls = p.lines || [];
          if (!p.pb && i > 0 && ls.length && last !== null && ls[0].vertpos + 200 < last) p.pb = 1;
          if (ls.length) last = ls[ls.length - 1].vertpos;
        });
      });
      // 머리말·꼬리말·쪽 번호: 구역 첫머리의 조판 부호에서. 글은 줄마다, 머리말 속 떠 있는 그림(로고)은 쪽마다 같은 자리에.
      const hfOf = (sec) => {
        const out = { hdr: null, ftr: null, himg: [], pn: null, hide: null };
        const lines = (ps) => ps.filter((q) => q.text && q.text.trim()).map((q) => { const cs = doc.charShapes[(q.charShapes[0] || {}).id] || {}; const ps2 = doc.paraShapes[q.paraShapeId] || {}; return { t: q.text, a: ps2.align, h: cs.height, b: cs.bold ? 1 : 0, c: cs.color }; });
        for (const p of sec.paragraphs.slice(0, 3)) for (const c of p.controls || []) {
          if (c.type === 'header' && !out.hdr) { out.hdr = lines(c.paragraphs); for (const q of c.paragraphs) for (const x of q.controls || []) if (x.type === 'shape' && x.binRef && x.treatAsChar === false) out.himg.push({ name: x.binRef, w: x.width, h: x.height, an: { h: { rel: x.horzRelTo === 1 ? 'margin' : 'page', off: x.hOffset || 0 }, v: { rel: x.vertRelTo === 1 ? 'margin' : 'page', off: x.vOffset || 0 } } }); }
          else if (c.type === 'footer' && !out.ftr) out.ftr = lines(c.paragraphs);
          else if (c.type === 'pgnp') out.pn = { pos: c.pos, side: c.side };
          else if (c.type === 'pghd' && !out.hide) out.hide = { h: c.header, f: c.footer, n: c.pageNum };
        }
        return out;
      };
      doc.sects = doc.sections.map((sec) => { const hf = hfOf(sec); const hide = hf.hide || {};
        return { page: { width: sec.page.width, height: sec.page.height, left: sec.page.left, right: sec.page.right, top: sec.page.top + (sec.page.header || 0), bottom: sec.page.bottom + (sec.page.footer || 0), header: sec.page.top > 1500 ? Math.min(sec.page.top - 1200, 2000) : 0, footer: Math.max(600, Math.round(sec.page.bottom * 0.6)) },
          hdr: hf.hdr ? { default: hf.hdr, first: hide.h ? [] : hf.hdr } : null, ftr: hf.ftr ? { default: hf.ftr, first: hide.f ? [] : hf.ftr } : null, titlePg: !!hf.hide, himg: hf.himg, himgFirst: !hide.h, pn: hf.pn, pnFirst: !hide.n }; });
      doc.autoPage = true;
    }
    const index = new Map();      // key → {text, sec, xi}
    const origKeys = [];
    const tables = new Map();     // 표키(안은 문단키#번호) → {sec, xt, rows, cells:[{r,c,rs,cs,w,h,keys}]}
    const secs = doc.sections.map((sec, si) => {
      let n = 0;
      const node = (p) => {
        const xi = p.xi !== undefined ? p.xi : n; n++;
        const k = `${si}.${xi}`;
        index.set(k, { text: p.text, sec: si, xi, runIds: p.runIds, ctl: !!(p.controls && p.controls.length) }); origKeys.push(k);
        let cs = p.charShapes || [];
        if (doc.format !== 'hwpx' && p.ctrlChars && p.ctrlChars.length) cs = cs.map((c) => ({ id: c.id, pos: c.pos - p.ctrlChars.filter((x) => x.pos < c.pos).reduce((a, x) => a + (x.code === 9 ? 7 : 8), 0) }));
        const out = { k, ps: p.paraShapeId, cs: cs.map((c) => [Math.max(0, c.pos), c.id]), t: p.text };
        if (p.marker) out.m = p.marker;
        if (p.pb) out.pb = p.pb;                       // 이 문단 앞에서 쪽이 넘어간다(넘어가는 쪽 수)
        if (p.sect !== undefined) out.sx = p.sect;     // 여기서 구역이 시작한다(쪽 크기·머리말·꼬리말)
        const ctrls = []; let ti = 0;
        for (const c of p.controls) {
          if (c.type === 'table') {
            const tk = `${k}#${ti++}`;
            const t = { t: 'tbl', k: tk, rows: c.rows, cols: c.cols, w: c.width, cells: c.cells.map((cl) => ({ r: cl.row, c: cl.col, rs: cl.rowspan, cs: cl.colspan, w: cl.width, h: cl.height, p: cl.paragraphs.map(node), ...(cl.css ? { x: cl.css } : {}) })) };
            if (c.css !== undefined) { t.x = c.css; t.g = c.grid; if (c.rowBreaks && c.rowBreaks.length) t.rb = c.rowBreaks; }
            if (c.cellSpacing) t.sp = c.cellSpacing;
            if (c.caption) t.cap = c.caption.map(node);
            tables.set(tk, { sec: si, xt: c.xt, rows: c.rows, cells: t.cells.map((cl) => ({ r: cl.r, c: cl.c, rs: cl.rs, cs: cl.cs, w: cl.w, h: cl.h, keys: cl.p.map((x) => x.k) })) });
            ctrls.push(t);
          } else if (c.type === 'shape') {
            const kids = (c.paragraphs || []).map(node);
            const name = c.binRef || (c.binId ? `BIN${c.binId.toString(16).toUpperCase().padStart(4, '0')}` : null);
            if (c.kind === 'svg') ctrls.push({ t: 'svg', w: c.width, h: c.height, s: c.svg, an: c.anchor });
            else if (name) {
              const img = { t: 'img', name, w: c.width, h: c.height };
              // 쪽 기준으로 떠 있는 그림(한/글: 글자처럼 취급 아님 + 종이·쪽 기준): 용지 위 그 자리에 놓는다
              if (c.treatAsChar === false && (c.vertRelTo === 0 || c.vertRelTo === 1) && (c.horzRelTo === 0 || c.horzRelTo === 1)) img.an = { h: { rel: c.horzRelTo === 0 ? 'page' : 'margin', off: c.hOffset || 0 }, v: { rel: c.vertRelTo === 0 ? 'page' : 'margin', off: c.vOffset || 0 }, behind: c.textWrap === 'BEHIND_TEXT' };
              ctrls.push(img);
            }
            else if (kids.length) ctrls.push({ t: 'box', w: c.width, h: c.height, p: kids });
          } else if (c.paragraphs) {
            const kids = c.paragraphs.map(node);       // 머리말·꼬리말·각주: 번호는 세되, 각주만 보인다
            if (c.type === 'fn' || c.type === 'en') ctrls.push({ t: 'note', p: kids });
          }
        }
        if (ctrls.length) out.c = ctrls;
        return out;
      };
      const paras = sec.paragraphs.map(node);
      return { page: { w: sec.page.width, l: sec.page.left, r: sec.page.right, t: sec.page.top }, paras };
    });
    const view = {
      secs,
      charShapes: doc.charShapes.map((c) => c && ({ h: c.height, b: c.bold ? 1 : 0, i: c.italic ? 1 : 0, u: c.underline ? 1 : 0, c: typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) && c.color !== '#000000' ? c.color : undefined, f: c.fontName || doc.fonts[c.fontId] || '', ...(c.ff ? { ff: c.ff } : {}), ...(c.css ? { x: c.css } : {}) })),
      paraShapes: doc.paraShapes.map((s) => s && ({ a: s.align, ml: s.marginLeft, mr: s.marginRight, ind: s.indent, sb: s.spaceBefore, sa: s.spaceAfter, ls: s.lineSpacingType === 'percent' ? s.lineSpacing : 0, ...(s.css ? { x: s.css } : {}), ...(s.rtab ? { rt: s.rtab } : {}) })),
    };
    if (doc.sects) {       // Word 계열: 쪽 단위로 그린다 — 구역마다 쪽 크기·여백·머리말·꼬리말
      view.sects = doc.sects.map((x) => ({ page: { w: x.page.width, h: x.page.height, l: x.page.left, r: x.page.right, t: x.page.top, b: x.page.bottom, hd: x.page.header, ft: x.page.footer }, hdr: x.hdr, ftr: x.ftr, tp: x.titlePg ? 1 : 0, st: x.start, ...(x.himg && x.himg.length ? { himg: x.himg, hif: x.himgFirst ? 1 : 0 } : {}), ...(x.pn ? { pn: x.pn, pnf: x.pnFirst ? 1 : 0 } : {}) }));
      view.pages = doc.pages;
      if (doc.autoPage) view.auto = 1;
    }
    rec = { doc, view, index, origKeys, tables, ms: Date.now() - t0, stats: { paras: origKeys.length, tables: tables.size, images: (doc.binNames || []).length, pages: doc.pages || 0 } };
    cache.set(id, rec);
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return rec;
  }

  // ---------- 변경 다루기 ----------
  function segsOf(id, key) {
    const s = stateOf(id);
    if (s.paras[key]) return s.paras[key].segs;
    const o = loadDoc(id).index.get(key);
    if (o) return track.baseSegs(o.text);
    return rowOpOf(id, key) ? [] : null;                 // 새 행의 칸 문단(n<행>.<열>)은 빈 글에서 시작
  }

  // ---------- 표: 행 추가 · 칸 병합 ----------
  // state.tables[표키] = { ops: [ {op:'row', id:'R7', after:<행>, by, at, cid} | {op:'merge', id:'M9', a:[행,열], dir, by, at, cid} ] }
  // <행> = 원본 행 번호(숫자) 또는 새 행 id('R7'). 새 행의 칸 문단 키 = 'n<행id>.<열>'.
  const tableOps = (id, tk) => ((stateOf(id).tables || {})[tk] || {}).ops || [];
  function rowOpOf(id, key) {
    const m = /^n([RS]\d+)\.(\d+)$/.exec(key); if (!m) return null;
    for (const [tk, t] of Object.entries(stateOf(id).tables || {})) { const op = t.ops.find((o) => (o.op === 'row' && o.id === m[1]) || (o.op === 'split' && (o.id === m[1] || o.cuts.some((q) => q.id === m[1])))); if (op) return { tk, op, col: Number(m[2]) }; }
    return null;
  }
  // 원본 표 + 기록된 변경 → 지금의 표 모양
  function effTable(id, tk, upto) {
    const base = loadDoc(id).tables.get(tk); if (!base) return null;
    const rows = Array.from({ length: base.rows }, (_, i) => i);
    const cells = base.cells.map((c) => ({ c: c.c, cs: c.cs, span: Array.from({ length: c.rs }, (_, i) => c.r + i), w: c.w, h: c.h, paras: c.keys.slice(), orig: [c.r, c.c], tplOrig: [c.r, c.c], tpl: c.keys[0] }));
    const applied = [];
    for (const op of tableOps(id, tk)) {
      if (upto && op === upto) break;
      if (op.op === 'row') {
        const i = rows.indexOf(op.after); if (i < 0) continue;
        rows.splice(i + 1, 0, op.id);
        const here = cells.filter((x) => x.span.includes(op.after));
        const rowH = Math.max(0, ...here.filter((x) => x.span.length === 1).map((x) => x.h)) || Math.max(0, ...here.map((x) => Math.round(x.h / x.span.length)));
        for (const cell of here) {
          if (cell.span.length > 1) { cell.span.splice(cell.span.indexOf(op.after) + 1, 0, op.id); cell.h += rowH; }
          else cells.push({ c: cell.c, cs: cell.cs, span: [op.id], w: cell.w, h: rowH || cell.h, paras: [`n${op.id}.${cell.c}`], orig: null, tplOrig: cell.tplOrig, tpl: cell.tpl, added: { by: op.by, at: op.at, cid: op.cid } });
        }
        applied.push(op);
      } else if (op.op === 'merge') {
        const a = cells.find((x) => x.span[0] === op.a[0] && x.c === op.a[1]); if (!a) continue;
        const b = mergeTarget(rows, cells, a, op.dir); if (!b) continue;
        if (op.dir === 'down') { a.span = a.span.concat(b.span); a.h += b.h; } else { a.cs += b.cs; a.w += b.w; }
        a.merged = { by: op.by, at: op.at, cid: op.cid }; a.absorbed = (a.absorbed || []).concat(b.paras, b.absorbed || []);
        cells.splice(cells.indexOf(b), 1);
        applied.push(op);
      } else if (op.op === 'cellprop') {
        // 칸 속성: 바탕색(fill: '#RRGGBB' | 'none') · 세로 정렬(va: TOP|CENTER|BOTTOM)
        const a = cells.find((x) => x.span[0] === op.a[0] && x.c === op.a[1]); if (!a) continue;
        a.props = { ...(a.props || {}), ...op.props }; a.propMark = { by: op.by, at: op.at, cid: op.cid };
        applied.push(op);
      } else if (op.op === 'colw') {
        // 열 너비: c 열을 delta 만큼 넓히고(좁히고) 바로 오른쪽 열에서 그만큼 뺀다 — 표 전체 너비는 그대로
        const hit = (x, col) => x.c <= col && col < x.c + x.cs;
        const right = cells.some((x) => hit(x, op.c + 1));
        for (const x of cells) { const inA = hit(x, op.c), inB = right && hit(x, op.c + 1); if (inA && !inB) x.w += op.delta; else if (inB && !inA) x.w -= op.delta; }
        applied.push(op);
      } else if (op.op === 'rowdel') {
        // 행 삭제: 그 행의 칸에 표시만 한다(수정 표시 보기에서는 취소선, 최종본·내려받기에서는 빠진다)
        if (!rows.includes(op.row)) continue;
        const here = cells.filter((x) => x.span.includes(op.row)); if (!here.length || here.some((x) => x.span.length > 1)) continue;
        for (const x of here) x.rowDel = { by: op.by, at: op.at, cid: op.cid };
        applied.push(op);
      } else if (op.op === 'split') {
        // 여러 행에 걸친 칸을 행 경계(cuts[].row = 새 조각이 시작하는 행)에서 나눈다. 원래 문단은 지정한 조각으로 자리만 옮긴다.
        const a = cells.find((x) => x.span[0] === op.a[0] && x.c === op.a[1]); if (!a || a.span.length < 2) continue;
        const span = a.span.slice();
        const cuts = op.cuts.filter((q) => span.indexOf(q.row) > 0).sort((x, y) => span.indexOf(x.row) - span.indexOf(y.row));
        if (!cuts.length) continue;
        const unitH = a.h / span.length; const all = a.paras.slice(); const mark = { by: op.by, at: op.at, cid: op.cid };
        const starts = cuts.map((q) => span.indexOf(q.row));
        a.span = span.slice(0, starts[0]); a.h = Math.round(unitH * a.span.length); a.split = mark;
        cuts.forEach((q, i) => {
          const sp = span.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : span.length);
          const mine = all.filter((k) => (q.paras || []).includes(k));
          a.paras = a.paras.filter((k) => !mine.includes(k));
          cells.push({ c: a.c, cs: a.cs, span: sp, w: a.w, h: Math.round(unitH * sp.length), paras: mine.length ? mine : [`n${q.id}.${a.c}`], orig: null, tplOrig: a.tplOrig, tpl: a.tpl, split: mark });
        });
        if (!a.paras.length) a.paras = [`n${op.id}.${a.c}`];
        applied.push(op);
      }
    }
    return { base, rows, cells, applied };
  }
  // a 의 바로 아래(down)·오른쪽(right)에서 크기가 맞는 칸
  function mergeTarget(rows, cells, a, dir) {
    if (dir === 'down') { const next = rows[rows.indexOf(a.span[a.span.length - 1]) + 1]; return next === undefined ? null : cells.find((x) => x.span[0] === next && x.c === a.c && x.cs === a.cs) || null; }
    return cells.find((x) => x.c === a.c + a.cs && x.span.length === a.span.length && x.span[0] === a.span[0]) || null;
  }
  const gridOf = (id, tk) => { const e = effTable(id, tk); return e && { rows: e.rows, cells: e.cells.map((x) => ({ row: x.span[0], r: e.rows.indexOf(x.span[0]), c: x.c, rs: x.span.length, cs: x.cs, w: x.w, paras: x.paras, tpl: x.tpl, ...(x.added ? { added: x.added } : {}), ...(x.merged ? { merged: x.merged } : {}), ...(x.split ? { split: x.split } : {}), ...(x.rowDel ? { rowDel: x.rowDel } : {}), ...(x.props ? { props: x.props, propMark: x.propMark } : {}) })) }; };
  function tableOp(id, body, by) {
    const s = stateOf(id); const tk = String(body.tbl || '');
    const e = effTable(id, tk); if (!e) return { code: 404, error: '그런 표가 없습니다' };
    const ref = (v) => (typeof v === 'number' || /^R\d+$/.test(String(v)) ? v : null);
    const at = Date.now();
    let op;
    if (body.op === 'row') {
      const after = ref(body.after);
      if (after === null || !e.rows.includes(after)) return { code: 400, error: '기준 행을 찾을 수 없습니다' };
      if (e.rows.length >= 200) return { code: 400, error: '행이 너무 많습니다' };
      op = { op: 'row', id: `R${++s.seq}`, after, by, at, cid: `c${++s.seq}` };
    } else if (body.op === 'merge') {
      const dir = body.dir === 'right' ? 'right' : 'down';
      const a = Array.isArray(body.a) ? e.cells.find((x) => x.span[0] === ref(body.a[0]) && x.c === Number(body.a[1])) : null;
      if (!a) return { code: 400, error: '칸을 찾을 수 없습니다' };
      const b = mergeTarget(e.rows, e.cells, a, dir);
      if (!b) return { code: 400, error: dir === 'down' ? '바로 아래에 너비가 같은 칸이 없습니다' : '바로 오른쪽에 높이가 같은 칸이 없습니다' };
      const chain = addedAfter(id);
      const busy = b.paras.some((k) => track.finalText(segsOf(id, k) || []) || chain(k).length || (loadDoc(id).index.get(k) || {}).text);
      if (busy) return { code: 400, error: '합쳐질 칸에 글이 있습니다 — 그 칸을 먼저 비워 주세요(원래 글이 있던 칸은 합칠 수 없습니다)' };
      op = { op: 'merge', id: `M${++s.seq}`, a: [a.span[0], a.c], dir, by, at, cid: `c${++s.seq}` };
    } else if (body.op === 'cellprop') {
      const a = Array.isArray(body.a) ? e.cells.find((x) => x.span[0] === ref(body.a[0]) && x.c === Number(body.a[1])) : null;
      if (!a) return { code: 400, error: '칸을 찾을 수 없습니다' };
      const props = {}; const b = body.props || {};
      if (b.fill !== undefined) { if (b.fill === 'none' || /^#[0-9a-f]{6}$/i.test(b.fill)) props.fill = b.fill; else return { code: 400, error: '바탕색은 #RRGGBB 또는 none' }; }
      if (b.va !== undefined) { if (['TOP', 'CENTER', 'BOTTOM'].includes(b.va)) props.va = b.va; else return { code: 400, error: '세로 정렬은 TOP·CENTER·BOTTOM' }; }
      if (!Object.keys(props).length) return { code: 400, error: '바꿀 속성이 없습니다' };
      op = { op: 'cellprop', id: `P${++s.seq}`, a: [a.span[0], a.c], props, by, at, cid: `c${++s.seq}` };
    } else if (body.op === 'colw') {
      const c = Number(body.c), delta = Math.round(Number(body.delta));
      const ncol = Math.max(...e.cells.map((x) => x.c + x.cs));
      if (!(c >= 0 && c < ncol) || !Number.isFinite(delta) || !delta || Math.abs(delta) > 20000) return { code: 400, error: '열 또는 너비가 맞지 않습니다' };
      const hit = (x, col) => x.c <= col && col < x.c + x.cs; const right = c + 1 < ncol;
      const after = e.cells.map((x) => { const inA = hit(x, c), inB = right && hit(x, c + 1); return x.w + (inA && !inB ? delta : inB && !inA ? -delta : 0); });
      if (after.some((w) => w < 1200)) return { code: 400, error: '칸이 너무 좁아집니다' };
      op = { op: 'colw', id: `W${++s.seq}`, c, delta, by, at, cid: `c${++s.seq}` };
    } else if (body.op === 'rowdel') {
      const row = ref(body.row);
      if (row === null || !e.rows.includes(row)) return { code: 400, error: '지울 행을 찾을 수 없습니다' };
      const here = e.cells.filter((x) => x.span.includes(row));
      if (here.some((x) => x.rowDel)) return { code: 400, error: '이미 지운 행입니다' };
      if (here.some((x) => x.span.length > 1)) return { code: 400, error: '여러 행에 걸친 칸이 있는 행은 지울 수 없습니다 — 그 칸을 먼저 「행마다 나누기」 해 주세요' };
      const live = e.rows.filter((r) => !e.cells.some((x) => x.span.includes(r) && x.rowDel));
      if (live.length <= 1) return { code: 400, error: '표에 하나 남은 행은 지울 수 없습니다' };
      op = { op: 'rowdel', id: `D${++s.seq}`, row, by, at, cid: `c${++s.seq}` };
    } else if (body.op === 'split') {
      const a = Array.isArray(body.a) ? e.cells.find((x) => x.span[0] === ref(body.a[0]) && x.c === Number(body.a[1])) : null;
      if (!a) return { code: 400, error: '칸을 찾을 수 없습니다' };
      if (a.span.length < 2) return { code: 400, error: '여러 행에 걸친 칸만 나눌 수 있습니다' };
      // cuts 가 없으면 행마다 나눈다(글은 모두 맨 위 조각에 남는다)
      const raw = Array.isArray(body.cuts) && body.cuts.length ? body.cuts : a.span.slice(1).map((row) => ({ row }));
      const seenRow = new Set(); const seenP = new Set(); const cuts = [];
      for (const q of raw) {
        const row = ref(q && q.row);
        if (row === null || a.span.indexOf(row) < 1 || seenRow.has(row)) return { code: 400, error: '나눌 행이 이 칸 안에 없습니다' };
        seenRow.add(row);
        const paras = Array.isArray(q.paras) ? q.paras.map(String) : [];
        for (const k of paras) { if (!a.paras.includes(k) || seenP.has(k)) return { code: 400, error: '옮길 문단이 이 칸에 없습니다' }; seenP.add(k); }
        cuts.push({ row, paras });
      }
      if (seenP.size >= a.paras.length) return { code: 400, error: '맨 위 조각에 문단이 하나는 남아야 합니다' };
      op = { op: 'split', id: `S${++s.seq}`, a: [a.span[0], a.c], cuts: cuts.map((q) => ({ row: q.row, id: `S${++s.seq}`, paras: q.paras })), by, at, cid: `c${++s.seq}` };
    } else return { code: 400, error: 'op 는 row · rowdel · merge · split · cellprop · colw' };
    if (!s.tables) s.tables = {};
    (s.tables[tk] = s.tables[tk] || { ops: [] }).ops.push(op);
    saveState(id, by);
    return { code: 200, op, grid: gridOf(id, tk) };
  }
  // 문단 순서(새 문단 포함): 기준 문단 바로 뒤에, 같은 기준이면 나중에 만든 것이 위
  function addedAfter(id) {
    const s = stateOf(id); const kids = new Map();
    for (const [k, p] of Object.entries(s.paras)) if (p.added) { if (!kids.has(p.added.after)) kids.set(p.added.after, []); kids.get(p.added.after).push(k); }
    for (const l of kids.values()) l.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    const chain = (k, out = []) => { for (const c of kids.get(k) || []) { out.push(c); chain(c, out); } return out; };
    return chain;
  }
  function orderOf(id) {
    const chain = addedAfter(id); const out = [];
    const { origKeys } = loadDoc(id);
    // 새 행의 칸 문단은 바로 위 원본 행의 마지막 문단 뒤에 놓는다
    const pos = new Map(origKeys.map((k, i) => [k, i])); const tail = new Map();
    for (const tk of Object.keys(stateOf(id).tables || {})) {
      const e = effTable(id, tk); if (!e) continue;
      let anchor = null;
      for (const r of e.rows) {
        const keys = e.cells.filter((x) => x.span[0] === r).sort((x, y) => x.c - y.c).flatMap((x) => x.paras);
        if (typeof r === 'number') { const o = keys.filter((k) => pos.has(k)).sort((x, y) => pos.get(y) - pos.get(x))[0]; if (o) anchor = o; }
        const fresh = keys.filter((k) => !pos.has(k));
        if (anchor && fresh.length) { if (!tail.has(anchor)) tail.set(anchor, []); tail.get(anchor).push(...fresh); }
      }
    }
    for (const k of origKeys) { out.push(k); chain(k, out); for (const n of tail.get(k) || []) { out.push(n); chain(n, out); } }
    return out;
  }
  function changesOf(id) {
    const s = stateOf(id); const out = []; const rowCh = new Map();
    // 칸 병합은 합친 칸의 첫 문단 자리에 카드가 놓인다
    const merges = new Map();
    for (const tk of Object.keys(s.tables || {})) { const e = effTable(id, tk); if (!e) continue; for (const op of e.applied.filter((o) => o.op === 'cellprop' || o.op === 'colw')) { const cell = op.op === 'cellprop' ? e.cells.find((x) => x.span[0] === op.a[0] && x.c === op.a[1]) : e.cells.filter((x) => x.c <= op.c && op.c < x.c + x.cs).sort((x, y) => e.rows.indexOf(x.span[0]) - e.rows.indexOf(y.span[0]))[0]; if (cell) { if (!merges.has(cell.paras[0])) merges.set(cell.paras[0], []); merges.get(cell.paras[0]).push(op); } } for (const op of e.applied.filter((o) => o.op === 'rowdel')) { const first = e.cells.filter((x) => x.span[0] === op.row).sort((x, y) => x.c - y.c)[0]; if (first) { if (!merges.has(first.paras[0])) merges.set(first.paras[0], []); merges.get(first.paras[0]).push(op); } } for (const c of e.cells) if (c.merged || c.split) { for (const op of e.applied.filter((o) => (o.op === 'merge' || o.op === 'split') && o.a[0] === c.span[0] && o.a[1] === c.c)) { if (!merges.has(c.paras[0])) merges.set(c.paras[0], []); merges.get(c.paras[0]).push(op); } } }
    for (const key of orderOf(id)) {
      const ro = rowOpOf(id, key);
      for (const op of merges.get(key) || []) { const e = { cid: op.cid, by: op.by, at: op.at, del: '', ins: '', key, table: op.op, dir: op.dir, ...(op.props ? { props: op.props } : {}), ...(op.op === 'colw' ? { delta: op.delta } : {}) }; if (op.op === 'split') { if (rowCh.has(op.cid)) continue; rowCh.set(op.cid, e); } out.push(e); }
      if (ro && !rowCh.has(ro.op.cid)) { const e = { cid: ro.op.cid, by: ro.op.by, at: ro.op.at, del: '', ins: '', key, table: ro.op.op }; rowCh.set(e.cid, e); out.push(e); }
      const p = s.paras[key]; if (!p) continue;
      const list = track.changesOf(p.segs);
      if (p.added && !list.some((c) => c.cid === p.added.cid)) list.unshift({ cid: p.added.cid, by: p.added.by, at: p.added.at, del: '', ins: '' });
      for (const c of list) {
        const row = rowCh.get(c.cid);
        if (row) { if (c.ins) row.ins += (row.ins ? ' | ' : '') + c.ins; if (c.at > row.at) row.at = c.at; continue; }   // 새 행에 쓴 글은 '행 추가' 변경 하나로
        const e = { ...c, key }; if (p.added && p.added.cid === c.cid) e.newPara = true; out.push(e);
      }
      if (p.gone) out.push({ cid: p.gone.cid, by: p.gone.by, at: p.gone.at, del: '', ins: '', key, paraDel: true });
      const reg = s.fmt || {};
      for (const fm of track.formatsOf(p.segs)) { const g = reg[fm.cid] || {}; out.push({ cid: fm.cid, by: g.by || 'ana', at: g.at || 0, del: '', ins: '', key, fmt: g.set || {}, text: fm.text }); }
      if (p.pf && p.pf.align) { const g = reg[p.pf.align[1]] || {}; out.push({ cid: p.pf.align[1], by: g.by || 'ana', at: g.at || 0, del: '', ins: '', key, fmt: { align: p.pf.align[0] }, text: '' }); }
    }
    for (const e of out) { const v = (s.via || {})[e.cid]; if (v) { e.via = v; e.viaName = nameOf(v); } }
    return out;
  }
  function authorsOf(id) {
    const meta = metaOf(id);
    const all = [...new Set([...(meta.authors || []), ...meta.members])];
    return all.map((email, i) => ({ email, name: nameOf(email), color: i % 8, hex: colorOf(email), seen: (meta.seen || {})[email] || 0, member: meta.members.includes(email), editor: (meta.authors || []).includes(email) }));
  }
  function pruneComments(id) {
    const s = stateOf(id); const live = new Set(changesOf(id).map((c) => c.cid));
    s.comments = s.comments.filter((c) => live.has(c.cid));
  }
  // 원본 파일 판(수정 시각) — 서버 밖에서 원본이 바뀌면(문단 수가 달라질 수 있다) 열린 화면이 문서를 다시 읽는다
  const fileVer = (id) => { try { const m = metaOf(id); return Math.round(fs.statSync(workFile(id, m)).mtimeMs); } catch { return 0; } };
  const publicState = (id) => { const s = stateOf(id); return { fv: fileVer(id), notes: s.notes || [], check: s.check || null, review: s.review || null, source: s.source || null, state: { rev: s.rev, paras: s.paras, comments: s.comments, order: orderOf(id), tables: Object.fromEntries(Object.keys(s.tables || {}).filter((tk) => s.tables[tk].ops.length).map((tk) => [tk, gridOf(id, tk)]).filter((x) => x[1])) }, changes: changesOf(id), authors: authorsOf(id) }; };

  function editPara(id, key, base, text, by) {
    const s = stateOf(id);
    const segs = segsOf(id, key);
    if (!segs) return { code: 404, error: '그런 문단이 없습니다' };
    const cur = track.finalText(segs);
    if (base !== undefined && base !== cur) return { code: 409, error: '다른 사람이 이 문단을 먼저 고쳤습니다', para: { key, segs, rev: (s.paras[key] || {}).rev || 0 } };
    if (text === cur) return { code: 200, para: { key, segs, rev: (s.paras[key] || {}).rev || 0 }, same: true };
    const at = Date.now();
    const prev = s.paras[key] || {};
    // 내가 만든 새 문단·새 행에 쓰는 글은 그 '새 문단'·'행 추가' 변경 하나로 묶는다
    const ro = rowOpOf(id, key);
    const own = prev.added || (ro && { by: ro.op.by, cid: ro.op.cid });
    const r = track.applyEdit(segs, text, by, at, () => (own && own.by === by ? own.cid : `c${++s.seq}`));
    const marked = track.hasMarks(r.segs);
    const next = { ...prev, segs: r.segs, rev: (prev.rev || 0) + 1 };
    if (next.gone && text) delete next.gone;                        // 지운 빈 줄에 글을 쓰면 다시 살아난다
    if (!marked && !next.added && !next.gone && !next.pf) delete s.paras[key];
    else s.paras[key] = next;
    pruneComments(id);
    saveState(id, by);
    return { code: 200, para: { key, segs: r.segs, rev: (s.paras[key] || {}).rev || 0 }, cids: r.cids };
  }
  function addPara(id, after, text, by) {
    const s = stateOf(id);
    if (!segsOf(id, after)) return { code: 404, error: '기준 문단이 없습니다' };
    const at = Date.now(); const cid = `c${++s.seq}`; const key = `a${++s.seq}`;
    s.paras[key] = { segs: text ? [{ t: text, ins: { by, at, cid } }] : [], rev: 1, added: { after, by, at, cid } };
    saveState(id, by);
    return { code: 200, key, cid };
  }
  // 문단(줄) 지우기: 글이 있으면 글을 모두 지우고(취소선), 빈 줄이면 '문단 삭제' 표시를 남긴다. 최종본에서는 그 줄이 빠진다.
  function delPara(id, key, by) {
    const s = stateOf(id);
    let segs = segsOf(id, key);
    if (!segs) return { code: 404, error: '그런 문단이 없습니다' };
    const o = loadDoc(id).index.get(key);
    if (key[0] === 'n') return { code: 400, error: '칸의 첫 문단은 지울 수 없습니다', quiet: true };
    if (o && o.ctl) return { code: 400, error: '표·그림이 들어 있는 문단은 지울 수 없습니다', quiet: true };
    if (removed(id, key)) return { code: 200, same: true };
    // 표 칸 안이면 그 칸에 다른 문단이 남아 있어야 한다
    let root = key; while (s.paras[root] && s.paras[root].added) root = s.paras[root].added.after;
    const chain = addedAfter(id);
    for (const tk of loadDoc(id).tables.keys()) {
      const e = effTable(id, tk); const cell = e && e.cells.find((x) => x.paras.includes(root)); if (!cell) continue;
      const live = cell.paras.flatMap((k) => [k, ...chain(k)]).filter((k) => k !== key && !removed(id, k));
      if (!live.length) return { code: 400, error: '칸에 하나 남은 문단은 지울 수 없습니다', quiet: true };
    }
    const cids = [];
    if (track.finalText(segs)) { const r = editPara(id, key, undefined, '', by); if (r.code !== 200) return r; cids.push(...(r.cids || [])); segs = segsOf(id, key); }
    const p = s.paras[key];
    if (p && p.added && !p.segs.length && p.added.by === by) { const r = revertChange(id, p.added.cid, by, true); return r.code === 200 ? { code: 200, cids, gonePara: true } : r; }
    if (!removed(id, key)) {
      const at = Date.now(); const cid = `c${++s.seq}`;
      s.paras[key] = { ...(p || { segs }), rev: ((p || {}).rev || 0) + 1, gone: { by, at, cid } };
      cids.push(cid);
      saveState(id, by);
    }
    return { code: 200, cids };
  }
  function revertChange(id, cid, by, force) {
    const s = stateOf(id);
    const ch = changesOf(id).find((c) => c.cid === cid);
    if (!ch) return { code: 404, error: '그런 변경이 없습니다' };
    if (ch.by !== by && !force) return { code: 403, error: '자기가 한 변경만 되돌릴 수 있습니다' };
    const loaded = loadDoc(id);
    // 표 변경 되돌리기: 행 추가 → 그 행과 그 칸의 글을 없애고, 그 아래 달린 행은 앞 행으로 옮긴다. 칸 병합 → 병합만 푼다.
    for (const [tk, t] of Object.entries(s.tables || {})) {
      const op = t.ops.find((o) => o.cid === cid); if (!op) continue;
      if (op.op === 'row' || op.op === 'split') {
        const ids = op.op === 'row' ? [op.id] : [op.id, ...op.cuts.map((q) => q.id)];
        const gone = new Set(Object.keys(s.paras).filter((k) => ids.some((x) => k.startsWith(`n${x}.`))));
        let grew = true; while (grew) { grew = false; for (const [k, p] of Object.entries(s.paras)) if (p.added && gone.has(p.added.after) && !gone.has(k)) { gone.add(k); grew = true; } }
        for (const k of gone) delete s.paras[k];
        if (op.op === 'row') {
          for (const o of t.ops) { if (o.op === 'row' && o.after === op.id) o.after = op.after; }
          t.ops = t.ops.filter((o) => o !== op && !((o.op === 'merge' || o.op === 'split') && o.a[0] === op.id));
          for (const o of t.ops) if (o.op === 'split') o.cuts = o.cuts.filter((q) => q.row !== op.id);
          t.ops = t.ops.filter((o) => !(o.op === 'split' && !o.cuts.length));
        } else t.ops = t.ops.filter((o) => o !== op);
      } else t.ops = t.ops.filter((o) => o !== op);
      if (!t.ops.length) delete s.tables[tk];
    }
    for (const [key, p] of Object.entries(s.paras)) {
      if (p.added && p.added.cid === cid) {
        for (const q of Object.values(s.paras)) if (q.added && q.added.after === key) q.added.after = p.added.after;   // 그 뒤에 달린 새 문단은 앞 문단으로 옮긴다
        delete s.paras[key]; continue;
      }
      if (p.gone && p.gone.cid === cid) { delete p.gone; p.rev = (p.rev || 0) + 1; }
      if (p.pf && p.pf.align && p.pf.align[1] === cid) { delete p.pf; p.rev = (p.rev || 0) + 1; }
      const segs = track.revertFormat(track.revert(p.segs, cid), cid);
      if (!track.hasMarks(segs) && !p.added && !p.gone && !p.pf && (loaded.index.has(key) || key[0] === 'n')) delete s.paras[key];
      else if (JSON.stringify(segs) !== JSON.stringify(p.segs)) { p.segs = segs; p.rev = (p.rev || 0) + 1; }
    }
    if (s.fmt) delete s.fmt[cid];
    pruneComments(id);
    saveState(id, by);
    return { code: 200 };
  }

  // ---------- 서식: 글자(굵게·기울임·밑줄·크기·색) · 문단 정렬 ----------
  // 글자 서식은 조각의 f 에, 정렬은 paras[key].pf.align 에 [값, cid] 로. 누가·언제·무엇을 = state.fmt[cid] { by, at, set | align }.
  const ALIGNS = ['left', 'center', 'right', 'justify'];
  function formatOp(id, body, by) {
    const s = stateOf(id); if (!s.fmt) s.fmt = {};
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 300);
    if (!items.length) return { code: 400, error: '서식을 바꿀 글이 없습니다' };
    const at = Date.now(); const cids = [];
    const align = body.align === undefined ? null : String(body.align);
    if (align !== null && !ALIGNS.includes(align)) return { code: 400, error: '정렬은 left · center · right · justify' };
    const set = {};
    if (!align && !body.clear) {
      const b = body.set || {};
      for (const k of ['b', 'i', 'u']) if (b[k] !== undefined) set[k] = b[k] ? 1 : 0;
      if (b.sz !== undefined) { const z = Math.round(Number(b.sz)); if (!(z >= 400 && z <= 9600)) return { code: 400, error: '글자 크기는 4~96pt' }; set.sz = z; }
      if (b.c !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(String(b.c))) return { code: 400, error: '색은 #rrggbb' }; set.c = String(b.c).toLowerCase(); }
      if (!Object.keys(set).length) return { code: 400, error: '바꿀 서식이 없습니다' };
    }
    for (const it of items) {
      const key = String((it && it.key) || ''); const segs = segsOf(id, key); if (!segs) continue;
      const prev = s.paras[key] || {};
      if (align) {
        const old = prev.pf && prev.pf.align; const reuse = old && s.fmt[old[1]] && s.fmt[old[1]].by === by;
        const cid = reuse ? old[1] : `c${++s.seq}`;
        s.fmt[cid] = { by, at, align };
        s.paras[key] = { ...prev, segs, rev: (prev.rev || 0) + 1, pf: { align: [align, cid] } };
        cids.push(cid); continue;
      }
      const len = track.finalText(segs).length;
      const a = Math.max(0, Math.min(len, Math.floor(Number(it.a) || 0))); const b = Math.max(a, Math.min(len, it.b === undefined ? len : Math.floor(Number(it.b))));
      if (b <= a) continue;
      let out;
      if (body.clear) out = track.applyFormat(segs, a, b, null, null, true).segs;
      else {
        // 같은 사람이 같은 범위에 이어서 입히는 서식은 변경 하나로 묶는다
        const chars = track.toChars(segs); let i = 0; let common = null; const outside = new Set();
        for (const ch of chars) { if (ch.del) continue; const ids = new Set(Object.values(ch.f || {}).map((v) => v[1])); if (i >= a && i < b) common = common === null ? ids : new Set([...common].filter((x) => ids.has(x))); else for (const x of ids) outside.add(x); i++; }
        const reuse = [...(common || [])].find((x) => !outside.has(x) && s.fmt[x] && s.fmt[x].by === by);
        const cid = reuse || `c${++s.seq}`;
        s.fmt[cid] = { by, at, set: { ...((reuse && s.fmt[cid].set) || {}), ...set } };
        out = track.applyFormat(segs, a, b, set, cid).segs; cids.push(cid);
      }
      if (!track.hasMarks(out) && !prev.added && !prev.gone && !prev.pf) delete s.paras[key];
      else s.paras[key] = { ...prev, segs: out, rev: (prev.rev || 0) + 1 };
    }
    // 더는 쓰이지 않는 서식 기록을 치운다
    const live = new Set();
    for (const p of Object.values(s.paras)) { for (const x of p.segs) if (x.f) for (const v of Object.values(x.f)) live.add(v[1]); if (p.pf && p.pf.align) live.add(p.pf.align[1]); }
    for (const k of Object.keys(s.fmt)) if (!live.has(k)) delete s.fmt[k];
    pruneComments(id);
    saveState(id, by);
    return { code: 200, cids };
  }

  // ---------- 최종본 ----------
  // 최종본에서 빠지는 문단: '문단 삭제' 표시가 있거나, 있던 글이 모두 지워진 문단(처음부터 빈 줄은 남는다)
  const removed = (id, key) => { const o = loadDoc(id).index.get(key); const p = stateOf(id).paras[key]; if (!p) return false; if (p.gone) return true; if (key[0] === 'n') return false; return !track.finalText(p.segs) && !!((o && o.text) || p.segs.length); };
  function finalTextOf(id) {
    return orderOf(id).filter((k) => !removed(id, k)).map((k) => track.finalText(segsOf(id, k))).join('\n');
  }
  // ---------- 표현점검: 문서의 최종 글에서 AI스러운 곳을 유형·근거와 함께 찾아 메모(state.notes, tag '표현점검')로 단다 ----------
  // 메모 하나 = { id:'x번호', tag, key(문단), a, b(그 문단 최종 글의 위치), quote(그 자리 글자), rule, group, label, sev, strength, reason, caveat?, at, by }
  const XP_TAG = '표현점검';
  // 표현점검 설정(주인이 관리): 끈 항목(off: {유형 번호·낱말 번호: 1})과 글의 갈래 — <데이터>/nrf/xp-settings.json
  const xpFile = path.join(DATA_DIR, 'nrf', 'xp-settings.json');
  const xpSettings = () => { const x = readJson(xpFile, null) || {}; return { off: x.off && typeof x.off === 'object' ? x.off : {}, genre: aitell.GENRES.includes(x.genre) ? x.genre : '보고서', lexicon: x.lexicon !== false, ai: x.ai !== false, at: x.at || 0, by: x.by || '' }; };
  const noteSig = (n) => `${n.rule}|${n.key}|${n.quote}`;
  async function runCheck(id, by, genre, say) {
    const s = stateOf(id);
    const keys = orderOf(id).filter((k) => !removed(id, k));
    const spans = []; let text = '';
    for (const k of keys) { const t = track.finalText(segsOf(id, k) || []).replace(/\n/g, ' '); if (!t) continue; spans.push({ k, start: text.length, len: t.length, t }); text += `${t}\n`; }
    await say(`글 모음 — 문단 ${spans.length}개 · ${text.length.toLocaleString()}자`, 20);
    // 한 번에 볼 수 있는 길이를 넘으면 문단 경계에서 나눠 본다
    const chunks = []; let from = 0;
    for (let i = 0; i < spans.length; i++) { const end = spans[i].start + spans[i].len + 1; if (end - spans[from].start > aitell.MAX_CHARS - 1000 && i > from) { chunks.push([from, i]); from = i; } }
    if (spans.length) chunks.push([from, spans.length]);
    const types = aitellCatalog.catalog().counts;
    await say(`유형 ${types.types}개(규칙 ${types.logic} · 읽어서 판단 ${types.llm}) + 낱말 사전 ${types.lexicon}개로 점검 중…`, 35);
    const set = xpSettings(); const off = s.noteOff || {}; const notes = []; let skipped = 0; const at = Date.now(); let meta = null; const rules = new Map(); const signals = [];
    const t0 = Date.now();
    for (const [a, b] of chunks) {
      const base = spans[a].start; const lastSpan = spans[b - 1];
      const r = aitell.detect(text.slice(base, lastSpan.start + lastSpan.len), { genre });
      meta = meta || r.meta; for (const sg of r.signals || []) if (chunks.length === 1) signals.push(sg);
      let si = a;
      for (const f of r.findings) {
        const pos = base + f.start;
        while (si + 1 < b && spans[si + 1].start <= pos) si++;
        while (si > a && spans[si].start > pos) si--;
        const sp = spans[si]; const la = Math.max(0, Math.min(sp.len, pos - sp.start)); const lb = Math.max(la, Math.min(sp.len, base + f.end - sp.start));
        const n = { tag: XP_TAG, key: sp.k, a: la, b: lb, quote: sp.t.slice(la, lb), rule: f.rule, group: f.group, label: f.label, sev: f.severity, strength: f.strength, reason: f.reason, ...(f.caveat ? { caveat: f.caveat } : {}), ...(f.keep_when ? { keep: f.keep_when } : {}), src: f.source, at, by };
        if (set.off[f.rule] || (f.source === 'lexicon' && !set.lexicon)) { skipped++; continue; }      // 관리 화면에서 끈 항목
        if (off[noteSig(n)]) continue;
        n.id = `x${++s.seq}`; notes.push(n);
        const e = rules.get(f.rule) || { rule: f.rule, label: f.label, sev: f.severity, count: 0, strong: 0 }; e.count++; if (f.strength === 'strong') e.strong++; rules.set(f.rule, e);
      }
    }
    const strong = notes.filter((n) => n.strength === 'strong').length;
    if (skipped) await say(`꺼 둔 항목에 걸린 ${skipped}곳은 뺐습니다`, 78);
    await say(`점검 끝 (${Date.now() - t0}ms) — 찾은 곳 ${notes.length}곳: 뚜렷 ${strong} · 참고 ${notes.length - strong} · 유형 ${rules.size}가지`, 80);
    s.notes = [...(s.notes || []).filter((n) => n.tag !== XP_TAG), ...notes];
    s.check = { judge: null, ai: set.ai && aiTypes().length > 0, at, by, genre: (meta && meta.genre) || genre || '일반', found: notes.length, strong, weak: notes.length - strong, level: chunks.length === 1 && meta ? meta.level : '', types: rules.size, rules: [...rules.values()].sort((x, y) => y.strong - x.strong || y.count - x.count), signals: signals.map((x) => ({ id: x.id, label: x.label, fired: !!x.fired, value: x.value === undefined ? '' : String(x.value).slice(0, 200), basis: x.basis || '' })) };
    saveState(id, by);
    await say(`메모 ${notes.length}개를 「${XP_TAG}」 태그로 달았습니다`, 95);
    return s.check;
  }

  // ---------- 표현점검 · AI 판단: 규칙으로 못 잡는 유형(catalog 의 method 'llm')과 낱말 사전의 문맥 확인을 이 ANA 의 에이전트가 읽고 판단한다 ----------
  // 흐름: 화면이 규칙 점검 뒤 judge-ask 로 지시문을 받아 에이전트 대화(/api/chat)로 보낸다 → 에이전트가 judge-input 을 읽고 → judge 로 결과를 등록한다
  const aiTypes = () => { const set = xpSettings(); return set.ai ? aitellCatalog.catalog().types.filter((t) => t.method === 'llm' && !set.off[t.id]) : []; };
  function judgeInput(id) {
    const s = stateOf(id); const meta = metaOf(id);
    const paras = orderOf(id).filter((k) => !removed(id, k)).map((k) => ({ k, t: track.finalText(segsOf(id, k) || []) })).filter((x) => x.t.trim());
    const notes = (s.notes || []).filter((n) => n.tag === XP_TAG && n.src !== 'llm').map((n) => ({ id: n.id, rule: n.rule, label: n.label, strength: n.strength, key: n.key, quote: n.quote, reason: n.reason, ...(n.keep ? { keep: n.keep } : {}) }));
    return { id, name: meta.name, genre: (s.check && s.check.genre) || xpSettings().genre, types: aiTypes().map((t) => ({ id: t.id, label: t.label, signature: t.signature })), paras, notes,
      howto: 'add = AI 판단 유형에 해당하는 곳(quote 는 그 문단 글자 그대로, key 는 문단 키) · confirm = 참고(weak) 메모 중 문맥상 해당하는 것 · dismiss = 문맥상 해당 없는 메모. 고쳐 쓰지 않는다.' };
  }
  function judgeApply(id, body) {
    const s = stateOf(id); const set = xpSettings(); const cat = aitellCatalog.catalog();
    const known = new Map([...cat.types.map((t) => [t.id, t]), ...cat.lexicon.map((e) => [e.id, { id: e.id, label: `어색한 낱말 "${e.headword}"`, severity: 'S3' }])]);
    const at = Date.now(); const rejected = [];
    const spans = orderOf(id).filter((k) => !removed(id, k)).map((k) => ({ k, t: track.finalText(segsOf(id, k) || []) }));
    s.notes = (s.notes || []).filter((n) => !(n.tag === XP_TAG && n.src === 'llm'));          // 다시 보내면 덮어쓴다
    let added = 0, confirmed = 0, dismissed = 0;
    for (const x of (Array.isArray(body.add) ? body.add : []).slice(0, 500)) {
      const quote = String((x && x.quote) || ''); const rule = String((x && x.rule) || '');
      const t = known.get(rule);
      if (!quote || !t) { rejected.push({ quote, rule, why: !t ? '모르는 유형 번호' : '구절이 비었음' }); continue; }
      if (set.off[rule]) { rejected.push({ quote, rule, why: '꺼 둔 항목' }); continue; }
      let nth = Math.max(1, x.nth | 0 || 1); let hit = null;
      for (const sp of x.key ? spans.filter((q) => q.k === String(x.key)) : spans) { let i = -1; while ((i = sp.t.indexOf(quote, i + 1)) >= 0) { if (--nth === 0) { hit = { k: sp.k, a: i }; break; } } if (hit) break; }
      if (!hit) { rejected.push({ quote, rule, why: '문서에서 그 구절을 찾지 못함(글자 그대로 옮겨 주세요)' }); continue; }
      const nn = { id: `x${++s.seq}`, tag: XP_TAG, key: hit.k, a: hit.a, b: hit.a + quote.length, quote, rule, group: rule.replace(/-.*/, ''), label: String(x.label || t.label || rule).slice(0, 120), sev: t.severity || '', strength: x.strength === 'weak' ? 'weak' : 'strong', reason: String(x.reason || '').slice(0, 600), src: 'llm', at, by: 'AI 판단' };
      if (x.to !== undefined) { const e = setSuggest(id, nn, x.from || quote, x.to); if (e) rejected.push({ quote, rule, why: `제안: ${e}` }); }
      s.notes.push(nn); added++;
    }
    const byId = new Map(s.notes.map((n) => [n.id, n]));
    for (const x of (Array.isArray(body.confirm) ? body.confirm : [])) { const n = byId.get(String((x && x.id) || '')); if (!n || n.tag !== XP_TAG) continue; n.strength = 'strong'; n.ai = String(x.why || '문맥상 해당').slice(0, 300); confirmed++; }
    let suggested = 0;
    for (const x of (Array.isArray(body.suggest) ? body.suggest : []).slice(0, 1000)) { const n = byId.get(String((x && x.id) || '')); if (!n || n.tag !== XP_TAG) continue; const e = setSuggest(id, n, x.from || n.quote, x.to); if (e) rejected.push({ id: n.id, why: `제안: ${e}` }); else suggested++; }
    for (const x of (Array.isArray(body.dismiss) ? body.dismiss : [])) { const n = byId.get(String((x && x.id) || '')); if (!n || n.tag !== XP_TAG) continue; s.notes = s.notes.filter((q) => q !== n); (s.noteOff = s.noteOff || {})[noteSig(n)] = 1; dismissed++; }
    if (s.check) {
      const xs = s.notes.filter((n) => n.tag === XP_TAG); const strong = xs.filter((n) => n.strength === 'strong').length;
      Object.assign(s.check, { found: xs.length, strong, weak: xs.length - strong, judge: { status: 'done', askedAt: (s.check.judge || {}).askedAt || null, log: (s.check.judge || {}).log || [], at, note: String(body.note || '').slice(0, 400), added, confirmed, dismissed, suggested, rejected: rejected.length } });
    }
    saveState(id, 'ana');
    return { added, confirmed, dismissed, suggested, rejected };
  }

  // ---------- 고쳐 쓰기 제안: 표현점검·문서검토 메모에 AI(이 ANA 의 에이전트)가 단 제안 { from: 문단의 원래 글(구절~문장), to: 바꿀 글 } — '적용' 하면 변경 추적으로 고친다 ----------
  function setSuggest(id, n, from, to) {
    from = String(from || ''); to = String(to == null ? '' : to).replace(/\r/g, '').slice(0, 2000);
    if (!from || from.length > 2000) return '바꿀 원래 글(from)이 비었거나 너무 깁니다';
    if (from === to) return '바꿀 글이 원래 글과 같습니다';
    const fin = track.finalText(segsOf(id, n.key) || []);
    if (!fin.includes(from)) return '문단에서 원래 글(from)을 찾지 못했습니다(글자 그대로)';
    n.sug = { from, to, at: Date.now() }; delete n.sugAsk;
    return '';
  }
  function applySuggest(id, n, by) {
    if (!n.sug) return { code: 400, error: '이 메모에는 제안이 없습니다' };
    const fin = track.finalText(segsOf(id, n.key) || []);
    let i = -1, best = -1; while ((i = fin.indexOf(n.sug.from, i + 1)) >= 0) if (best < 0 || Math.abs(i - (n.a || 0)) < Math.abs(best - (n.a || 0))) best = i;      // 메모 자리에 가장 가까운 것
    if (best < 0) return { code: 409, error: '문단 글이 바뀌어 제안을 적용할 수 없습니다 — 제안을 다시 받아 주세요' };
    const r = editPara(id, n.key, fin, fin.slice(0, best) + n.sug.to + fin.slice(best + n.sug.from.length), by);
    if (r.code !== 200) return r;
    n.applied = { at: Date.now(), by, cids: r.cids || [] }; saveState(id, by);
    return r;
  }

  // ---------- 문서검토: 문서 최종 글을 doc-review 규칙으로 점검해 「문서검토」 메모를 단다. AI 검토는 이 ANA 의 에이전트가 이어서 한다 ----------
  const DR_TAG = '문서검토';
  const DR_STRUCT = [
    ['uniform', '문장', '문장 길이가 고르다'], ['ending', '문장', '같은 종결어미가 이어진다'], ['comma', '문장', '연결어미 뒤 쉼표'], ['notbut', '문장', '"A가 아니라 B" 대구의 반복'],
    ['triad', '문장', '셋씩 묶은 나열'], ['conn', '문장', '문장마다 접속어로 시작'], ['short', '문장', '짧은 홑문장만 이어진다'],
    ['puniform', '문단', '문단 길이가 고르다'], ['must', '문단', '문단마다 당위 · 전망으로 맺는다'], ['p34', '문단', '문단마다 문장이 3~4개'], ['ahead', '문단', '끝부분의 막연한 "향후 · 앞으로"'],
    ['three', '문단', '"먼저 – 또한 – 마지막으로" 3단 틀'], ['sameopen', '문단', '같은 말로 시작하는 문단'],
    ['mdleak', '조판', '마크다운 기호가 글자로 남음'], ['emoji', '조판', '그림 문자(이모지)'], ['dash', '조판', '줄표(—) 남용'], ['colon', '조판', '"주제: 부제" 꼴 제목'], ['quote', '조판', '따옴표 강조'],
    ['leadbold', '조판', '"굵은 머리말: 설명" 꼴 항목'], ['bold', '조판', '굵은 글씨 남용'], ['lists', '조판', '목록마다 줄 수가 같다'],
  ];
  const drCatalog = () => ({
    rules: [...DR.WORD_RULES.map(([id, level, name, re, min, why, fix]) => ({ id, level, name, why, fix, ev: DR.EVID[id] || '보통', basis: id === 'policy' ? '1,000자에 9회 이상이고 8회 이상' : min >= 3 ? `문서에서 ${min}회 이상이고 1,000자당 ${DR.DENSITY[id]}회 이상` : `${min}회부터` })),
      ...DR_STRUCT.map(([id, level, name]) => ({ id, level, name, why: '', fix: '', ev: DR.EVID[id] || '보통', basis: '문서 전체를 세어 본다' })),
      ...DRO.RULES.map((r) => ({ id: r.id, level: r.level, name: r.name, why: r.why, fix: r.fix, ev: '보통', basis: r.basis, owner: true }))],
    levels: DR.LEVELS, weight: DR.WEIGHT,
    verdict: ['직접 증거(대화 말투 · 글자로 남은 기호 · 빈 자리표시)가 있으면 높음', '밀도 9 이상 · 강함 신호 2가지 이상 · 서로 다른 신호 5가지 이상 · 3갈래 이상이면 높음', '밀도 4 이상 · 서로 다른 신호 3가지 이상 · 2갈래 이상이면 보통', '그 밖은 낮음. AI 검토가 짚은 것은 많아도 두 가지로만 친다'],
    source: { name: 'doc-review 1.0.0 (AI Workplace 문서 검토)', basis: '규칙의 분류와 일부 번호는 epoko77-ai/im-not-ai(MIT)를 참고해 다시 쓴 것' },
  });
  const drFile = path.join(DATA_DIR, 'nrf', 'dr-settings.json');
  const drSettings = () => { const x = readJson(drFile, null) || {}; return { off: x.off && typeof x.off === 'object' ? x.off : {}, ai: x.ai !== false, at: x.at || 0, by: x.by || '' }; };
  const drSig = (n) => `${n.rule}|${n.key}|${n.quote}`;
  function drParas(id) {
    const out = [];
    for (const k of orderOf(id).filter((q) => !removed(id, q))) {
      const t = track.finalText(segsOf(id, k) || []).replace(/\s+/g, ' ').trim(); if (t.length < 2) continue;
      out.push({ i: out.length, k, page: null, text: t, heading: t.length <= 40 && !/[.!?。…다요음함임됨]$/.test(t) });
    }
    return out;
  }
  function drVerdict(s) {
    const r = s.review; if (!r) return;
    const byRule = new Map();
    for (const n of (s.notes || []).filter((x) => x.tag === DR_TAG)) { const k = `${n.src}|${n.rule}`; if (!byRule.has(k)) byRule.set(k, { rule: n.rule, src: n.src === 'AI' ? 'AI' : '규칙', level: n.level, pattern: n.label, ev: n.ev, weight: n.weight || 1, count: n.count || 1 }); else if (n.src === 'AI') byRule.get(k).count++; }
    for (const g of r.global || []) byRule.set(`g|${g.rule}`, { rule: g.rule, src: '규칙', level: g.level, pattern: g.pattern, ev: g.ev, weight: g.weight || 1, count: g.count || 1 });
    r.verdict = DR.verdictOf({ findings: [...byRule.values()], stats: r.stats });
    r.found = (s.notes || []).filter((x) => x.tag === DR_TAG).length; r.kinds = byRule.size;
  }
  async function runReview(id, by, say, lone) {
    const s = stateOf(id); const set = drSettings(); const at = Date.now(); const t0 = Date.now();
    const paras = drParas(id);
    await say(`글 모음 — 문단 ${paras.length}개`, 20);
    if (!paras.length) throw new Error('문서에서 글을 찾지 못했습니다');
    const raw = paras.map((p) => p.text).join('\n');
    await say(`규칙 점검 중 — 낱말·구 ${DR.WORD_RULES.length}가지 · 문장·문단·조판 ${DR_STRUCT.length}가지`, 40);
    const r = DR.ruleCheck(paras, '', raw);
    r.findings.push(...DRO.ownerCheck(paras));      // 주인 지적 규칙
    if (lone && lone.length) { const f = DRO.lonePages(paras, lone); if (f) r.findings.push(f); }      // 화면 쪽 나눔: 한두 줄만 남은 쪽
    const off = s.drOff || {}; const notes = []; const global = []; let skipped = 0;
    for (const f of r.findings) {
      if (set.off[f.rule]) { skipped++; continue; }
      const base = { tag: DR_TAG, rule: f.rule, level: f.level, label: f.pattern, ev: f.ev, weight: f.weight, count: f.count || 1, reason: f.why || '', fix: f.fix || '', src: '규칙', strength: f.ev === '직접' || f.ev === '강함' ? 'strong' : 'weak', at, by };
      const spots = (f.spots || []).filter((sp) => paras[sp.p]);
      if (!spots.length) { global.push({ rule: f.rule, level: f.level, pattern: f.pattern, why: f.why, fix: f.fix, ev: f.ev, weight: f.weight, count: f.count || 1 }); continue; }
      for (const sp of spots) {
        const k = paras[sp.p].k; const fin = track.finalText(segsOf(id, k) || []); const a = fin.indexOf(sp.quote);
        const n = { ...base, key: k, a: Math.max(0, a), b: Math.max(0, a) + (a >= 0 ? sp.quote.length : 0), quote: a >= 0 ? sp.quote : '' };
        if (off[drSig(n)]) continue;
        n.id = `x${++s.seq}`; notes.push(n);
      }
    }
    if (skipped) await say(`꺼 둔 규칙에 걸린 ${skipped}가지는 뺐습니다`, 60);
    s.notes = [...(s.notes || []).filter((n) => n.tag !== DR_TAG), ...notes];
    s.review = { at, by, global, metrics: r.metrics, stats: r.stats, ai: set.ai, judge: null };
    drVerdict(s);
    await say(`규칙 점검 끝 (${Date.now() - t0}ms) — 찾은 것 ${r.findings.length - skipped}가지 · 메모 ${notes.length}곳 · 문서 전체 ${global.length}가지 · AI 작성 신호 ${s.review.verdict.level}`, 80);
    saveState(id, by);
    return s.review;
  }
  // ---------- 출처: 기획서 문장마다 참고 폴더의 어느 문서 · 어느 자리에서 왔는지(근거), 참고 문서와 다른지(상반), 찾지 못했는지(출처 없음) ----------
  // 서버가 글자 3개 묶음으로 가장 가까운 참고 문장을 찾아 1차로 매기고, 주인 계정이면 에이전트가 읽어 확정한다(skills/source-check).
  const SRC_TAG = '출처';
  const SRC_EXT = ['hwpx', 'hwp', 'docx', 'doc', 'odt', 'rtf', 'pptx', 'xlsx', 'pdf', 'txt', 'md', 'csv', 'html', 'htm'];
  const refTextFile = (id, fid) => path.join(dirOf(id), 'refs-text', `${fid}.json`);
  async function refTexts(id, say) {
    const r = refsOf(id); const out = [];
    for (const f of r.files) {
      const ext = path.extname(f.file).slice(1).toLowerCase();
      if (!SRC_EXT.includes(ext)) { await say(`${f.name} — 글이 없는 형식이라 건너뜀`); continue; }
      const cf = refTextFile(id, f.id); let c = readJson(cf, null);
      if (!c || c.size !== f.size) {
        const t0 = Date.now();
        try { c = { size: f.size, name: f.name, sents: await SRC.extract(ext, fs.readFileSync(path.join(dirOf(id), 'refs', f.file)), { tmp: path.join(DATA_DIR, 'nrf'), profile: path.join(DATA_DIR, 'nrf', 'lo') }) || [] }; }
        catch (e) { await say(`${f.name} — 글을 뽑지 못했습니다: ${e.message}`); continue; }
        fs.mkdirSync(path.dirname(cf), { recursive: true }); writeJson(cf, c);
        await say(`${f.name} — 문장 ${c.sents.length.toLocaleString()}개 뽑음 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
      } else await say(`${f.name} — 문장 ${c.sents.length.toLocaleString()}개 (뽑아 둔 것)`);
      out.push({ fid: f.id, name: f.name, sents: c.sents, path: cf });
    }
    return out;
  }
  // 문단의 최종 글을 문장으로 나눈다(자리 a·b 그대로)
  function srcUnits(id) {
    const out = [];
    for (const k of orderOf(id).filter((q) => !removed(id, q))) {
      const fin = track.finalText(segsOf(id, k) || []); if (!fin.trim()) continue;
      const cuts = [0]; const re = /[.!?。](?=\s+\S)|\s(?=[○□◈•▶■◆※]\s)|\n/g; let m;
      while ((m = re.exec(fin))) cuts.push(m.index + 1);
      cuts.push(fin.length);
      for (let i = 0; i + 1 < cuts.length; i++) {
        let a = cuts[i], b = cuts[i + 1]; while (a < b && /\s/.test(fin[a])) a++; while (b > a && /\s/.test(fin[b - 1])) b--;
        const t = fin.slice(a, b); if (SRC.norm(t).length < 8) continue;
        out.push({ k, a, b, t });
      }
    }
    return out;
  }
  function srcStats(s) {
    const src = s.source; if (!src) return;
    const ns = (s.notes || []).filter((n) => n.tag === SRC_TAG);
    src.stats = { all: ns.length, ok: ns.filter((n) => n.rel === '근거').length, bad: ns.filter((n) => n.rel === '상반').length, none: ns.filter((n) => n.rel === '없음').length };
  }
  async function runSource(id, by, say) {
    const s = stateOf(id); const at = Date.now();
    const refs = refsOf(id).files; if (!refs.length) throw new Error('참고 폴더에 파일이 없습니다 — 기획서를 만들 때 쓴 문서를 참고 폴더에 올려 주세요');
    await say(`참고 파일 ${refs.length}개에서 글 뽑는 중`, 15);
    const files = await refTexts(id, (m) => say(m));
    if (!files.some((f) => f.sents.length)) throw new Error('참고 파일에서 글을 찾지 못했습니다');
    const t1 = Date.now(); const ix = SRC.buildIndex(files);
    await say(`참고 글 색인 — ${ix.wins.length.toLocaleString()}개 묶음 (${Date.now() - t1}ms)`, 50);
    const units = srcUnits(id); if (!units.length) throw new Error('기획서에서 문장을 찾지 못했습니다');
    await say(`기획서 문장 ${units.length}개 대조 중`, 60);
    const notes = []; const t2 = Date.now();
    for (const u of units) {
      const m = SRC.match(ix, u.t) || { score: 0 };
      const ref = m.fid && m.score >= 0.2 ? { fid: m.fid, name: m.name, loc: m.loc, t: m.t } : null;
      let rel = '없음', strength = 'weak', reason = '참고 파일에서 비슷한 글을 찾지 못했습니다';
      const nc = m.score >= 0.35 ? SRC.numConflict(u.t, m.t || '') : null;
      if (nc) { rel = '상반'; reason = `가장 가까운 참고 글과 수치가 다릅니다: ${nc}`; }
      else if (m.score >= 0.6) { rel = '근거'; strength = 'strong'; reason = `참고 글과 ${Math.round(m.score * 100)}% 겹칩니다`; }
      else if (m.score >= 0.35) { rel = '근거'; reason = `참고 글과 ${Math.round(m.score * 100)}% 겹칩니다 — 줄이거나 바꿔 쓴 것으로 보입니다`; }
      notes.push({ id: `x${++s.seq}`, tag: SRC_TAG, key: u.k, a: u.a, b: u.b, quote: u.t, rel, score: m.score, ...(ref ? { ref } : {}), reason, src: '규칙', strength, at, by });
    }
    s.notes = [...(s.notes || []).filter((n) => n.tag !== SRC_TAG), ...notes];
    s.source = { at, by, files: files.map((f) => ({ fid: f.fid, name: f.name, n: f.sents.length })), judge: null };
    srcStats(s); saveState(id, by);
    await say(`대조 끝 (${Date.now() - t2}ms) — 근거 ${s.source.stats.ok} · 상반 ${s.source.stats.bad} · 출처 없음 ${s.source.stats.none}`, 85);
    return s.source;
  }
  function srcApply(id, body) {
    const s = stateOf(id); if (!s.source) return { error: '먼저 출처 대조를 돌려 주세요' };
    const byId = new Map((s.notes || []).filter((n) => n.tag === SRC_TAG).map((n) => [n.id, n]));
    const files = new Map((s.source.files || []).map((f) => [f.fid, f])); const texts = new Map();
    const textOf = (fid) => { if (!texts.has(fid)) { const c = readJson(refTextFile(id, fid), null); texts.set(fid, c ? c.sents : []); } return texts.get(fid); };
    const rejected = []; let set = 0;
    for (const x of (Array.isArray(body.set) ? body.set : []).slice(0, 3000)) {
      const n = byId.get(String((x && x.id) || '')); if (!n) { rejected.push({ id: x && x.id, why: '그런 출처 메모가 없습니다' }); continue; }
      const rel = ['근거', '상반', '없음'].includes(x.rel) ? x.rel : null; if (!rel) { rejected.push({ id: n.id, why: 'rel 은 근거·상반·없음' }); continue; }
      if (rel !== '없음' && (x.ref || x.fid)) {
        const f = files.get(String(x.fid || '')); if (!f) { rejected.push({ id: n.id, why: 'fid 가 참고 파일이 아닙니다' }); continue; }
        const q = String(x.ref || '').slice(0, 600); const sents = textOf(f.fid);
        const hit = sents.find((y) => SRC.has(y.t, q)) || (SRC.has(sents.map((y) => y.t).join(' '), q) ? { loc: x.loc || '' } : null);
        if (!q || !hit) { rejected.push({ id: n.id, why: '참고 파일에서 ref 글을 찾지 못했습니다(글자 그대로)' }); continue; }
        n.ref = { fid: f.fid, name: f.name, loc: String(x.loc || hit.loc || '').slice(0, 60), t: q };
      } else if (rel === '없음') delete n.ref;
      else if (!n.ref) { rejected.push({ id: n.id, why: '근거·상반에는 ref(참고 글 그대로)와 fid 가 필요합니다' }); continue; }
      n.rel = rel; n.src = 'AI'; n.strength = rel === '없음' ? 'weak' : 'strong'; if (x.why) n.reason = String(x.why).slice(0, 400); set++;
    }
    srcStats(s);
    s.source.judge = { status: 'done', askedAt: (s.source.judge || {}).askedAt || null, log: (s.source.judge || {}).log || [], at: Date.now(), set: (s.notes || []).filter((n) => n.tag === SRC_TAG && n.src === 'AI').length, rejected: rejected.length, note: String(body.note || '').slice(0, 300) };
    saveState(id, null);
    return { set, rejected, stats: s.source.stats };
  }
  function drApply(id, body) {
    const s = stateOf(id); const at = Date.now(); const rejected = []; let added = 0;
    const spans = drParas(id);
    s.notes = (s.notes || []).filter((n) => !(n.tag === DR_TAG && n.src === 'AI'));
    for (const x of (Array.isArray(body.add) ? body.add : []).slice(0, 40)) {
      const quote = String((x && x.quote) || '').slice(0, 80); const level = DR.LEVELS.includes(x && x.level) ? x.level : '';
      if (quote.length < 4 || !level) { rejected.push({ quote, why: !level ? 'level 은 문단|문장|단어|조판' : '구절이 너무 짧음' }); continue; }
      const sp = (x.key ? spans.filter((q) => q.k === String(x.key)) : spans).find((q) => track.finalText(segsOf(id, q.k) || []).includes(quote));
      if (!sp) { rejected.push({ quote, why: '문서에서 그 구절을 찾지 못함(글자 그대로)' }); continue; }
      const a = track.finalText(segsOf(id, sp.k) || []).indexOf(quote);
      const nn = { id: `x${++s.seq}`, tag: DR_TAG, key: sp.k, a, b: a + quote.length, quote, rule: `ai:${String(x.pattern || '').slice(0, 24)}`, level, label: String(x.pattern || '어색한 부분').slice(0, 24), ev: '보통', weight: 1.2, count: 1, reason: String(x.why || '').slice(0, 300), fix: String(x.fix || '').slice(0, 300), src: 'AI', strength: 'weak', at, by: 'AI 검토' };
      if (x.to !== undefined) { const e = setSuggest(id, nn, x.from || quote, x.to); if (e) rejected.push({ quote, why: `제안: ${e}` }); }
      s.notes.push(nn); added++;
    }
    let suggested = 0; const byId = new Map((s.notes || []).map((n) => [n.id, n]));
    for (const x of (Array.isArray(body.suggest) ? body.suggest : []).slice(0, 1000)) { const n = byId.get(String((x && x.id) || '')); if (!n || n.tag !== DR_TAG) continue; const e = setSuggest(id, n, x.from || n.quote, x.to); if (e) rejected.push({ id: n.id, why: `제안: ${e}` }); else suggested++; }
    if (s.review) { s.review.judge = { status: 'done', suggested, askedAt: (s.review.judge || {}).askedAt || null, log: (s.review.judge || {}).log || [], at, added, rejected: rejected.length, note: String(body.note || '').slice(0, 300) }; drVerdict(s); }
    saveState(id, 'ana');
    return { added, suggested, rejected };
  }

  // 문서함 카드에 보이는 첫머리 글
  const previewOf = (id) => finalTextOf(id).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14).map((l) => l.slice(0, 70)).join('\n').slice(0, 600);
  function finalHwpx(id) {
    const s = stateOf(id); const { index, origKeys } = loadDoc(id);
    const chain = addedAfter(id);
    const alignOf = (k) => { const p = s.paras[k]; return p && p.pf && p.pf.align ? p.pf.align[0] : undefined; };
    const plan = new Map();
    const get = (sec) => { if (!plan.has(sec)) plan.set(sec, { sec, edits: new Map(), added: new Map() }); return plan.get(sec); };
    for (const key of origKeys) {
      const o = index.get(key); const p = s.paras[key];
      if (p) { const it = get(o.sec); it.edits.set(o.xi, p.segs); if (p.gone) (it.remove = it.remove || new Set()).add(o.xi); if (p.pf && p.pf.align) (it.aligns = it.aligns || new Map()).set(o.xi, p.pf.align[0]); }
      const kids = chain(key).filter((k) => !removed(id, k));
      if (kids.length) get(o.sec).added.set(o.xi, kids.map((k) => ({ segs: s.paras[k].segs, align: alignOf(k) })));
    }
    // 표 변경(행 추가·칸 병합): 표마다 지금의 모양과 새 칸의 글
    for (const tk of Object.keys(s.tables || {})) {
      const e = effTable(id, tk); if (!e || !e.applied.length) continue;
      const item = get(e.base.sec); if (!item.tables) item.tables = new Map();
      const delRows = new Set(e.applied.filter((o) => o.op === 'rowdel').map((o) => o.row));
      const rowsF = e.rows.filter((r) => !delRows.has(r)); const cellsF = e.cells.filter((x) => !x.rowDel);
      item.tables.set(e.base.xt, {
        rows: rowsF, goneRows: [...delRows].filter((r) => typeof r === 'number'),
        cells: cellsF.map((x) => ({ props: x.props, r: rowsF.indexOf(x.span[0]), c: x.c, rs: x.span.length, cs: x.cs, w: x.w, h: x.h, orig: x.orig, tplOrig: x.tplOrig, isNew: !x.orig, row: x.span[0],
          // 새 칸의 내용: 원래 문단을 옮겨 온 것({xi}: 고친 글·그 뒤에 넣은 문단까지 함께 옮긴다) 또는 새로 쓴 글({text})
          paras: x.orig ? [] : x.paras.flatMap((k) => (index.has(k) ? [{ xi: index.get(k).xi }] : [k, ...chain(k).filter((q) => !removed(id, q))].map((q) => ({ text: track.finalText(segsOf(id, q) || []), segs: segsOf(id, q) || [], align: alignOf(q) })))) })),
        gone: e.base.cells.filter((c) => !cellsF.some((x) => x.orig && x.orig[0] === c.r && x.orig[1] === c.c)).map((c) => [c.r, c.c]),
      });
    }
    const meta = metaOf(id);
    const buf = fs.readFileSync(workFile(id, meta));
    return meta.format === 'hwpx' ? hwpxEdit.buildFinal(buf, [...plan.values()]) : docx.buildFinal(buf, [...plan.values()]);
  }

  // ---------- 참고 폴더(문서마다): refs.json = { folders: [이름], files: [{id, name, folder, size, by, at, file}] } · 파일은 refs/<id><확장자>
  const refsFile = (id) => path.join(dirOf(id), 'refs.json');
  function refsOf(id) {
    const r = readJson(refsFile(id), null) || { folders: [DEFAULT_FOLDER], files: [] };
    if (!Array.isArray(r.folders) || !r.folders.length) r.folders = [DEFAULT_FOLDER];
    if (!Array.isArray(r.files)) r.files = [];
    return r;
  }
  const cleanName = (n, max = 120) => String(n || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/^\.+/, '').trim().slice(0, max);
  // 참고 폴더에 올린 ZIP: 압축을 풀어 같은 이름의 폴더에 파일로 넣는다(원래 ZIP 도 남긴다). 폴더 안 경로는 「하위폴더 · 파일」 이름으로 펼친다.
  function unzipRef(id, f, me) {
    const r = refsOf(id); const buf = fs.readFileSync(path.join(dirOf(id), 'refs', f.file));
    let z; try { z = zip.parse(buf); } catch { return { error: '압축 파일을 읽지 못했습니다' }; }
    const names = z.list().filter((n) => !n.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store$|Thumbs\.db$)/.test(n) && !/(^|\/)\._/.test(n));
    if (!names.length) return { error: '압축 안에 파일이 없습니다' };
    if (names.length > 200) return { error: `압축 안의 파일이 너무 많습니다(${names.length}개 · 200개까지)` };
    let stem = cleanName(f.name.replace(/\.zip$/i, ''), 40); if ((stem.match(/_/g) || []).length > stem.length / 2) stem = '';
    // 이름이 깨졌으면(밑줄뿐) 압축 안의 맨 위 폴더 이름이나 '압축 풀기' 로
    const tops = [...new Set(names.map((n) => n.split('/')[0]))];
    if (!stem) stem = tops.length === 1 && names.some((n) => n.includes('/')) ? cleanName(tops[0], 40) : '압축 풀기';
    let folder = stem; for (let i = 2; r.folders.includes(folder); i++) folder = `${stem} (${i})`;
    if (r.folders.length >= 30) return { error: '폴더는 30개까지 만들 수 있습니다' };
    const used = r.files.reduce((a, x) => a + x.size, 0); let add = 0; const skipped = [];
    for (const n of names) { const e = z.info(n); if (e.enc) return { error: '암호가 걸린 압축은 풀 수 없습니다' }; if (e.usize > MAX_REF) skipped.push(n); else add += e.usize; }
    if (used + add > MAX_REF_DOC) return { error: '풀면 참고 폴더 한도(200MB)를 넘습니다' };
    if (freeBytes() - add < MIN_FREE) return { error: '서버 저장 공간이 부족해 지금은 풀 수 없습니다' };
    const strip = tops.length === 1 && names.every((n) => n.includes('/')) ? tops[0].length + 1 : 0;
    const out = []; const seen = new Set(r.files.filter((x) => x.folder === folder).map((x) => x.name));
    for (const n of names) {
      if (skipped.includes(n)) continue;
      let data; try { data = z.read(n); } catch { skipped.push(n); continue; }
      let nm = cleanName(n.slice(strip).split('/').filter(Boolean).join(' · ')) || 'file';
      for (let i = 2; seen.has(nm); i++) nm = nm.replace(/( \(\d+\))?(\.[^.]*)?$/, (m0, a, ext) => ` (${i})${ext || ''}`);
      seen.add(nm);
      const fid = `r${crypto.randomBytes(5).toString('hex')}`;
      const ext = (path.extname(nm).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
      fs.writeFileSync(path.join(dirOf(id), 'refs', fid + ext), data);
      out.push({ id: fid, name: nm, folder, size: data.length, by: f.by || me, at: Date.now(), file: fid + ext, from: f.from, unzipped: f.id });
    }
    r.folders.push(folder); r.files.push(...out); f.unzippedTo = folder;
    const ff = r.files.find((x) => x.id === f.id); if (ff) ff.unzippedTo = folder;
    writeJson(refsFile(id), r);
    return { folder, files: out.length, skipped: skipped.map((n) => path.basename(n)) };
  }
  const freeBytes = () => { try { const st = fs.statfsSync(DOCS); return st.bavail * st.bsize; } catch { return Infinity; } };
  const publicRefs = (id, who) => { const r = refsOf(id); return { folders: r.folders, files: r.files.map(({ file, ...f }) => ({ ...f, byName: nameOf(f.by), ...(who === 'ana' || isAdmin(who) ? { path: path.join(dirOf(id), 'refs', file) } : {}) })), limit: { file: MAX_REF, total: MAX_REF_DOC, used: r.files.reduce((a, f) => a + f.size, 0) } }; };

  function sendFile(res, data, name, type) {
    res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' });
    res.end(data);
  }

  // ---------- 라우트 ----------
  // 문지기 — 서버의 모든 요청보다 먼저 돈다(server.js 가 앞에 끼운다). 로그인하지 않은 사람과 손님은
  // 문서 화면(/nrf.html)과 /api/nrf/ 밖으로 한 발도 못 나간다: ANA 대시보드, 에이전트 대화(/api/chat), PRD 등은 모두 401.
  // (channel-core 의 대화 경로는 extraApi 보다 먼저 처리되므로 extraApi 안에서 막는 것으로는 부족하다.)
  function guard(req, res) {
    let url; try { url = new URL(req.url, 'http://x'); } catch { return false; }
    const me = who(req, url);
    // 퍼머넌트 링크 /d/<문서 id>: 관리자는 ANA 화면에서 그 문서를, 다른 사람은 문서 화면만 연다(주소는 그대로 남는다)
    const dm = /^\/d\/([a-f0-9]{12})\/?$/.exec(url.pathname);
    if (dm && (req.method === 'GET' || req.method === 'HEAD')) {
      if (me === 'ana' || (me && !isGuest(me) && isAdmin(me))) { res.writeHead(302, { location: `/?doc=${dm[1]}`, 'cache-control': 'no-store' }); res.end(); return true; }
      let html; try { html = fs.readFileSync(path.join(__dirname, 'nrf.html')); } catch { return false; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': html.length, 'referrer-policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : html); return true;
    }
    if (me === 'ana' || (me && !isGuest(me) && isAdmin(me))) return false;   // 대시보드·에이전트 대화는 관리자(와 서버 안의 ANA)만
    const p = url.pathname;
    if (p.startsWith('/api/nrf/')) return false;
    if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/nrf.html' || p === '/ana-logo.png')) return false;
    if (req.method === 'GET' && p === '/') { res.writeHead(302, { location: `/nrf.html${url.search || ''}`, 'cache-control': 'no-store' }); res.end(); return true; }
    if (me && !isGuest(me)) sendJson(res, 403, { error: '관리자만 쓸 수 있습니다' });
    else sendJson(res, 401, { error: '로그인이 필요합니다', anon: true });
    return true;
  }
  async function extraApi(req, res, url) {
    const p = url.pathname;
    const me = who(req, url);
    // 로그인하지 않은 사람·손님은 문서 화면과 그 API 밖으로 나가지 못한다(ANA 대시보드·에이전트 대화·다른 API 는 닫혀 있다)
    if (!me || isGuest(me)) {
      if (!p.startsWith('/api/nrf/')) {
        if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/nrf.html' || p === '/ana-logo.png')) return false;
        if (req.method === 'GET' && p === '/') { res.writeHead(302, { location: `/nrf.html${url.search || ''}`, 'cache-control': 'no-store' }); return res.end(), true; }
        return sendJson(res, 401, { error: '로그인이 필요합니다', anon: true }), true;
      }
    }
    if (!p.startsWith('/api/nrf/')) return false;
    const write = req.method !== 'GET';
    try {
      if (write && req.method !== 'DELETE' && !core.csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      // ----- 로그인 없이 되는 것: 내가 누구인지 · 암호 입장 -----
      if (p === '/api/nrf/guest/info' && req.method === 'GET') {
        const d = String(url.searchParams.get('doc') || ''); const m = /^[a-f0-9]{12}$/.test(d) ? readJson(path.join(DOCS, d, 'meta.json'), null) : null;
        return sendJson(res, 200, { on: !!(m && m.guest && m.guest.on), link: linkOn(m), name: linkOn(m) ? m.name : undefined }), true;
      }
      if (p === '/api/nrf/guest/login' && req.method === 'POST') {
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const d = String(body.doc || ''); const m = /^[a-f0-9]{12}$/.test(d) && okId(d) ? metaOf(d) : null;
        const key = `${d}:${clientIp(req)}`; const f = fails.get(key) || { n: 0, until: 0 };
        if (f.until > Date.now()) return sendJson(res, 429, { error: `여러 번 틀렸습니다 — ${Math.ceil((f.until - Date.now()) / 60000)}분 뒤에 다시 해 주세요` }), true;
        const name = String(body.name || '').replace(/[<>"()\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20);
        if (!name) return sendJson(res, 400, { error: '이름을 적어 주세요' }), true;
        const byLink = linkOn(m);       // 링크 공유가 켜진 문서: 이름만 적고 들어온다
        const good = byLink || (!!(m && m.guest && m.guest.on) && crypto.timingSafeEqual(Buffer.from(pwHash(body.password || '', m.guest.salt)), Buffer.from(m.guest.hash)));
        if (!good) {
          f.n++; if (f.n >= 8) { f.until = Date.now() + 10 * 60000; f.n = 0; } fails.set(key, f);
          return sendJson(res, 403, { error: '암호가 맞지 않거나, 이 문서는 암호로 들어올 수 없습니다' }), true;
        }
        fails.delete(key);
        const gid = crypto.randomBytes(4).toString('hex'); const id = `g-${gid}.${d}@guest`;
        const names = readJson(peopleFile('names'), {}); names[id] = `${name} (손님)`; writeJson(peopleFile('names'), names);
        if (byLink) m.link.log = [...(m.link.log || []), { id, name, at: Date.now() }].slice(-100); else m.guest.log = [...(m.guest.log || []), { id, name, at: Date.now() }].slice(-100);
        saveMeta(d, m);
        broadcast({ kind: 'nrf', docId: d, by: id, list: true, members: true });
        return sendJson(res, 200, { ok: true, token: byLink ? guestToken(d, gid, m.link.ver, true) : guestToken(d, gid, m.guest.ver), me: { email: id, name: nameOf(id), guest: true, doc: d } }), true;
      }
      if (p === '/api/nrf/me' && !me) return sendJson(res, 200, { anon: true, email: '', name: '' }), true;
      if (!me) return sendJson(res, 401, { error: '로그인이 필요합니다', anon: true }), true;
      if (p === '/api/nrf/stream' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': ok\n\n');
        const c = { res, me }; streams.add(c); req.on('close', () => streams.delete(c));
        return true;
      }
      if (isGuest(me) && (p === '/api/nrf/people' || (p === '/api/nrf/docs' && req.method === 'POST'))) return sendJson(res, 403, { error: '손님은 할 수 없는 일입니다' }), true;
      if (p === '/api/nrf/people' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '관리자만 할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res); if (!body) return true;
        const email = String(body.email || '').trim().toLowerCase();
        if (!okEmail(email)) return sendJson(res, 400, { error: '이메일 주소를 확인해 주세요' }), true;
        if (typeof body.name === 'string') { const n = readJson(peopleFile('names'), {}); const v = body.name.replace(/[<>"\r\n]/g, ' ').trim().slice(0, 40); if (v) n[email] = v; else delete n[email]; writeJson(peopleFile('names'), n); }
        if (typeof body.color === 'string') { const c = readJson(peopleFile('colors'), {}); if (/^#[0-9a-f]{6}$/i.test(body.color)) c[email] = body.color.toLowerCase(); else delete c[email]; writeJson(peopleFile('colors'), c); }
        broadcast({ kind: 'nrf', by: me, people: true });
        return sendJson(res, 200, { ok: true, email, name: nameOf(email), color: colorOf(email) || null }), true;
      }
      if (p === '/api/nrf/me') return sendJson(res, 200, { email: me, name: nameOf(me), avatar: profileOf(me).avatar || '', admin: isAdmin(me), logoutUrl: isGuest(me) ? '' : (opts.LOGOUT_URL || ''), ...(isGuest(me) ? { guest: true, doc: guestDoc(me) } : {}) }), true;
      if (p === '/api/nrf/aitell/catalog' && req.method === 'GET') return sendJson(res, 200, { ...aitellCatalog.catalog(), settings: xpSettings(), genres: aitell.GENRES, canEdit: me === 'ana' || isAdmin(me) }), true;
      if (p === '/api/nrf/genskills/img' && req.method === 'GET') {      // 생성스킬 예시 그림(skills/<스킬>/examples/*.png 만)
        const rel = String(url.searchParams.get('p') || ''); if (!/^[a-z0-9-]+\/examples\/[A-Za-z0-9._-]+\.png$/.test(rel)) return sendJson(res, 400, { error: '그림 경로가 바르지 않습니다' }), true;
        try { const buf = fs.readFileSync(path.join(__dirname, 'skills', rel)); res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }); res.end(buf); } catch { sendJson(res, 404, { error: '그림이 없습니다' }); } return true;
      }
      if (p === '/api/nrf/genskills' && req.method === 'GET') { try { return sendJson(res, 200, JSON.parse(fs.readFileSync(path.join(__dirname, 'skills', 'doc-generate', 'skills.json'), 'utf8'))), true; } catch (e) { return sendJson(res, 500, { error: '생성스킬 목록을 읽지 못했습니다' }), true; } }
      if (p === '/api/nrf/docreview/catalog' && req.method === 'GET') return sendJson(res, 200, { ...drCatalog(), settings: drSettings(), canEdit: me === 'ana' || isAdmin(me) }), true;
      if (p === '/api/nrf/docreview/settings' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '문서검토 관리는 이 Docs 의 주인만 할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 20000); if (!body) return true;
        const cur = drSettings(); const known = new Set(drCatalog().rules.map((r) => r.id));
        if (body.set && typeof body.set === 'object') for (const [k, on] of Object.entries(body.set)) { if (!known.has(k)) continue; if (on) delete cur.off[k]; else cur.off[k] = 1; }
        if (typeof body.ai === 'boolean') cur.ai = body.ai;
        cur.at = Date.now(); cur.by = me; writeJson(drFile, cur);
        return sendJson(res, 200, { ok: true, settings: cur }), true;
      }
      if (p === '/api/nrf/aitell/settings' && req.method === 'POST') {      // 표현점검 관리(주인만): { set: {번호: true|false, …} } · { genre } · { lexicon: true|false }
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '표현점검 관리는 이 Docs 의 주인만 할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 40000); if (!body) return true;
        const cur = xpSettings(); const known = new Set([...aitellCatalog.catalog().types.map((t) => t.id), ...aitellCatalog.catalog().lexicon.map((e) => e.id)]);
        if (body.set && typeof body.set === 'object') for (const [k, on] of Object.entries(body.set)) { if (!known.has(k)) continue; if (on) delete cur.off[k]; else cur.off[k] = 1; }
        if (aitell.GENRES.includes(body.genre)) cur.genre = body.genre;
        if (typeof body.lexicon === 'boolean') cur.lexicon = body.lexicon;
        if (typeof body.ai === 'boolean') cur.ai = body.ai;
        cur.at = Date.now(); cur.by = me; writeJson(xpFile, cur);
        return sendJson(res, 200, { ok: true, settings: cur }), true;
      }      // 표현점검의 유형 목록·낱말 사전
      if (p === '/api/nrf/docs' && req.method === 'GET') return sendJson(res, 200, { docs: listDocs().filter((m) => canOpen(m, me)).map((m) => ({ ...m, guest: undefined, seen: undefined, link: { on: linkOn(m) }, opened: (m.seen || {})[me] || 0, requests: canManage(m, me) ? m.requests : [], canManage: canManage(m, me), uploaderName: nameOf(m.uploader) })), me }), true;
      if (p === '/api/nrf/docs' && req.method === 'POST') {
        // 이 Docs 의 문서함은 주인(관리자)의 것이다 — 올리기·새 문서는 주인만. 다른 사람은 받은 링크의 문서만 함께 고친다.
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '문서를 올리거나 새로 만드는 것은 이 Docs 의 주인만 할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, MAX_UPLOAD * 1.4); if (!body) return true;
        if (body.blank) { body.name = `${String(body.name || '제목 없는 문서').replace(/\.docx$/i, '')}.docx`; body.data = docx.build([{ p: '' }]).toString('base64'); }
        const name = String(body.name || '').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
        const m = /\.([a-z0-9]{2,5})$/i.exec(name);
        if (!m || !convert.EXTS.includes(m[1].toLowerCase())) return sendJson(res, 400, { error: `올릴 수 있는 문서: ${convert.EXTS.map((x) => x.toUpperCase()).join(' · ')}` }), true;
        const data = Buffer.from(String(body.data || '').replace(/^data:[^,]*,/, ''), 'base64');
        if (!data.length || data.length > MAX_UPLOAD) return sendJson(res, 413, { error: '비어 있거나 너무 큰 파일입니다(30MB 까지)' }), true;
        const format = m[1].toLowerCase();
        // 진행 기록: 단계마다 한 줄 — 올린 사람의 화면에 바로 보내고(SSE), 응답에도 통째로 싣는다
        const job = typeof body.job === 'string' && /^[a-z0-9]{4,16}$/.test(body.job) ? body.job : ''; const t0 = Date.now(); const log = [];
        const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
        const say = async (msg, pct) => { const l = { m: `${msg}`, ms: Date.now() - t0, pct }; log.push(l); console.log(`[nrf] upload ${name}: ${msg} (+${l.ms}ms)`); if (job) { sendTo(me, { kind: 'nrf', job, i: log.length, m: l.m, pct }); await new Promise((r) => setImmediate(r)); } };
        await say(`파일 받음 — ${name} (${kb(data.length)})`, 42);
        await say(`형식: ${format.toUpperCase()} — ${format === 'hwpx' || format === 'hwp' ? '한/글 문서로 읽습니다' : format === 'docx' ? 'Word 문서로 읽습니다' : 'Word(DOCX)로 바꾼 뒤 읽습니다'}`, 44);
        let work = null;      // 한/글·DOCX 가 아니면 작업용 DOCX 로 바꾼다(올릴 때 한 번)
        let pageHints = null;
        try {
          if (format === 'hwpx') hwpx.parse(data); else if (format === 'hwp') hwp5.parse(data);
          else {
            if (format !== 'docx') {
              const how = { doc: 'LibreOffice 로 DOC → DOCX 바꾸는 중…(수 초~수십 초)', odt: 'LibreOffice 로 ODT → DOCX 바꾸는 중…', rtf: 'LibreOffice 로 RTF → DOCX 바꾸는 중…', pdf: 'PDF 에서 글 뽑는 중…', pptx: '슬라이드의 글과 표 뽑는 중…', xlsx: '시트를 표로 옮기는 중…', csv: '표로 옮기는 중…', html: 'LibreOffice 로 HTML → DOCX 바꾸는 중…(스크립트는 걷어 냅니다)', htm: 'LibreOffice 로 HTML → DOCX 바꾸는 중…(스크립트는 걷어 냅니다)' }[format] || '문단으로 옮기는 중…';
              await say(how, 48); const tc = Date.now();
              work = await convert.toDocx(format, data, { profile: path.join(DATA_DIR, 'nrf', 'lo'), tmp: path.join(DATA_DIR, 'nrf') });
              await say(`바꿈 완료 — DOCX ${kb(work.length)} (${((Date.now() - tc) / 1000).toFixed(1)}초)`, 58);
            }
            const parsed = docx.parse(work || data);
            // 쪽 나눔 정보가 없는 Word 계열 문서(DOC·ODT·RTF, 다른 프로그램이 만든 DOCX): LibreOffice 로 쪽을 계산해 둔다
            const longish = parsed.sections[0].paragraphs.length > 25;
            if (!parsed.lrpb && longish && (format === 'docx' || convert.VIA_OFFICE.includes(format) || convert.HTML.includes(format))) {
              await say('이 파일에는 쪽 나눔 기록이 없습니다 — LibreOffice 로 쪽을 계산하는 중…', 59); const tp = Date.now();
              try { pageHints = await convert.pageTexts(convert.HTML.includes(format) ? 'docx' : format, convert.HTML.includes(format) ? work : data, { profile: path.join(DATA_DIR, 'nrf', 'lo'), tmp: path.join(DATA_DIR, 'nrf') }); await say(`쪽 계산 완료 — ${pageHints.length}쪽 (LibreOffice 기준, ${((Date.now() - tp) / 1000).toFixed(1)}초)`, 60); }
              catch (e) { await say(`쪽을 계산하지 못했습니다(한 장으로 이어서 보입니다): ${e.message}`); }
            }
          }
        } catch (e) { await say(`열 수 없는 파일: ${e.message}`); return sendJson(res, 400, { error: `열 수 없는 파일입니다: ${e.message}`, log }), true; }
        await say('파일 검사 통과 — 저장하는 중', 60);
        const id = crypto.randomBytes(6).toString('hex');
        fs.mkdirSync(dirOf(id), { recursive: true });
        fs.writeFileSync(path.join(dirOf(id), `original.${format}`), data);
        if (work) fs.writeFileSync(path.join(dirOf(id), 'work.docx'), work);
        if (pageHints && pageHints.length > 1) writeJson(path.join(dirOf(id), 'pages.json'), pageHints);
        const meta = { id, name, format, size: data.length, uploader: me, authors: [me], members: [me], requests: [], createdAt: Date.now(), updatedAt: Date.now(), changes: 0 };
        writeJson(path.join(dirOf(id), 'meta.json'), meta);
        await say('문서 구조 읽는 중(문단·표·그림·쪽)…', 63);
        try {
          const rec = loadDoc(id);
          await say(`구조 읽음 (${rec.ms}ms) — ${rec.stats.pages ? `${rec.stats.pages}쪽 · ` : ''}문단 ${rec.stats.paras}개 · 표 ${rec.stats.tables}개 · 그림 ${rec.stats.images}개`, 67);
          meta.preview = previewOf(id); writeJson(path.join(dirOf(id), 'meta.json'), meta);
          await say('문서함 미리보기 만듦', 69);
        } catch (e) { await say(`미리보기를 만들지 못함: ${e.message}`); }
        broadcast({ kind: 'nrf', docId: id, rev: 0, by: me, list: true }); mirrorSoon();
        await say(`서버 작업 끝 — 총 ${((Date.now() - t0) / 1000).toFixed(1)}초`, 70);
        return sendJson(res, 200, { ok: true, doc: meta, log }), true;
      }
      const m = /^\/api\/nrf\/docs\/([a-f0-9]{12})(?:\/(.*))?$/.exec(p);
      if (!m || !okId(m[1])) return sendJson(res, 404, { error: '문서를 찾을 수 없습니다' }), true;
      const id = m[1]; const sub = m[2] || '';
      const meta = metaOf(id);
      if (!canOpen(meta, me) && linkOn(meta) && !isGuest(me)) {       // 링크 공유: 링크로 온 로그인 사용자는 이 문서의 작성자가 된다(이 문서만)
        meta.members.push(me); meta.requests = meta.requests.filter((r) => r.email !== me);
        meta.link.joined = [...new Set([...(meta.link.joined || []), me])];      // 링크로 들어온 사람 — 링크 공유를 끄면 함께 빠진다
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
      }
      if (!canOpen(meta, me)) {
        if (sub === 'join' && req.method === 'POST') {
          // 구글로 로그인했지만 등록되지 않은 사람: 문서 암호를 알면 바로 작성자로 등록된다(암호가 걸린 문서만)
          const body = await core.jsonBody(req, res, 4000); if (!body) return true;
          if (typeof body.password === 'string' && !isGuest(me)) {
            const key = `${id}:${me}`; const f = fails.get(key) || { n: 0, until: 0 };
            if (f.until > Date.now()) return sendJson(res, 429, { error: `여러 번 틀렸습니다 — ${Math.ceil((f.until - Date.now()) / 60000)}분 뒤에 다시 해 주세요` }), true;
            const good = !!(meta.guest && meta.guest.on) && crypto.timingSafeEqual(Buffer.from(pwHash(body.password, meta.guest.salt)), Buffer.from(meta.guest.hash));
            if (!good) { f.n++; if (f.n >= 8) { f.until = Date.now() + 10 * 60000; f.n = 0; } fails.set(key, f); return sendJson(res, 403, { error: '암호가 맞지 않습니다' }), true; }
            fails.delete(key);
            meta.members.push(me); meta.requests = meta.requests.filter((r) => r.email !== me);
            meta.guest.log = [...(meta.guest.log || []), { id: me, name: nameOf(me), at: Date.now() }].slice(-100);
            saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
            return sendJson(res, 200, { ok: true, member: true }), true;
          }
          if (!meta.requests.some((r) => r.email === me)) { meta.requests.push({ email: me, name: nameOf(me), at: Date.now() }); saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, join: true }); }
          return sendJson(res, 200, { ok: true, requested: true }), true;
        }
        return sendJson(res, 403, { error: '이 문서의 작성자로 등록되어 있지 않습니다', need: 'member', name: meta.name, uploaderName: nameOf(meta.uploader), pw: !!(meta.guest && meta.guest.on), requested: meta.requests.some((r) => r.email === me) }), true;
      }
      if (req.method !== 'GET' && sub !== 'join' && viewOnly(meta, me)) return sendJson(res, 403, { error: '보기 전용으로 공유된 문서입니다 — 고치거나 메모를 달 수 없습니다' }), true;
      if (sub === 'members' && req.method === 'POST') {
        if (!canManage(meta, me)) return sendJson(res, 403, { error: '작성자 등록은 권한을 관리하는 사람만 할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res); if (!body) return true;
        // "이메일" 또는 "이름 이메일" — 여럿은 쉼표·줄바꿈으로. 이름을 같이 적으면 그 사람이 로그인하기 전에도 그 이름으로 보인다.
        const entries = String(body.email || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = /[^\s<>"]+@[^\s<>"]+/.exec(x); const e = m ? m[0].toLowerCase() : ''; return { email: e, name: m ? x.replace(m[0], '').replace(/[<>()"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '', raw: x }; });
        const bad = entries.filter((x) => !okEmail(x.email)).map((x) => x.raw);
        if (!entries.length || bad.length) return sendJson(res, 400, { error: `이메일 주소를 확인해 주세요${bad.length ? `: ${bad.join(', ')}` : ''}` }), true;
        const emails = entries.map((x) => x.email);
        const named = entries.filter((x) => x.name);
        if (named.length) { const f = path.join(DATA_DIR, 'nrf', 'names.json'); const n = readJson(f, {}); for (const x of named) n[x.email] = x.name; writeJson(f, n); }
        for (const e of emails) if (!meta.members.includes(e)) meta.members.push(e);
        if (['edit', 'view', 'manage'].includes(body.role)) { meta.roles = meta.roles || {}; for (const e of emails) if (e !== meta.uploader) { if (body.role === 'edit') delete meta.roles[e]; else meta.roles[e] = body.role; } }
        if (meta.link && meta.link.joined) meta.link.joined = meta.link.joined.filter((e) => !emails.includes(e));   // 직접 등록하면 링크를 꺼도 남는다
        meta.requests = meta.requests.filter((r) => !emails.includes(r.email));
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
        return sendJson(res, 200, { ok: true, members: meta.members }), true;
      }
      const mr = /^members\/([^/]+)\/role$/.exec(sub);
      if (mr && req.method === 'POST') {
        const e = decodeURIComponent(mr[1]).toLowerCase();
        if (!canManage(meta, me)) return sendJson(res, 403, { error: '권한은 권한을 관리하는 사람만 바꿀 수 있습니다' }), true;
        if (e === meta.uploader) return sendJson(res, 400, { error: '올린 사람의 권한은 바꿀 수 없습니다' }), true;
        if (!meta.members.includes(e)) return sendJson(res, 404, { error: '등록된 사람이 아닙니다' }), true;
        const body = await core.jsonBody(req, res); if (!body) return true;
        if (!['edit', 'view', 'manage'].includes(body.role)) return sendJson(res, 400, { error: 'role 은 edit · view · manage 중 하나' }), true;
        if (e === me && body.role !== 'manage' && !(me === 'ana' || isAdmin(me))) return sendJson(res, 400, { error: '자기 관리 권한은 스스로 내릴 수 없습니다 — 올린 사람에게 부탁하세요' }), true;
        meta.roles = meta.roles || {}; if (body.role === 'edit') delete meta.roles[e]; else meta.roles[e] = body.role;
        if (meta.link && meta.link.joined) meta.link.joined = meta.link.joined.filter((x) => x !== e);
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
        return sendJson(res, 200, { ok: true, roles: meta.roles }), true;
      }
      const mm = /^members\/(.+)$/.exec(sub);
      if (mm && req.method === 'DELETE') {
        const e = decodeURIComponent(mm[1]).toLowerCase();
        if (!canManage(meta, me)) return sendJson(res, 403, { error: '작성자 빼기는 권한을 관리하는 사람만 할 수 있습니다' }), true;
        if (e === meta.uploader) return sendJson(res, 400, { error: '올린 사람은 뺄 수 없습니다' }), true;
        meta.members = meta.members.filter((x) => x !== e); meta.requests = meta.requests.filter((r) => r.email !== e); if (meta.roles) delete meta.roles[e];
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
        return sendJson(res, 200, { ok: true, members: meta.members }), true;
      }
      if (sub === 'join' && req.method === 'POST') return sendJson(res, 200, { ok: true, member: true }), true;
      // ----- 링크 공유(올린 사람·관리자): 켜면 링크(/d/<id>)를 가진 사람은 누구나 이 문서를 함께 고친다 -----
      if (sub === 'link' && req.method === 'POST') {
        if (!canManage(meta, me)) return sendJson(res, 403, { error: '링크 공유는 권한을 관리하는 사람만 바꿀 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const prev = meta.link || {};
        meta.link = { on: !!body.on, role: body.role === 'view' ? 'view' : 'edit', ver: (prev.ver || 0) + (body.on ? 0 : 1), by: me, at: Date.now(), log: prev.log || [], joined: body.on ? prev.joined || [] : [] };
        if (!body.on && prev.joined && prev.joined.length) meta.members = meta.members.filter((e) => e === meta.uploader || !prev.joined.includes(e));   // 링크로만 들어온 사람은 권한이 사라진다(직접 등록한 사람은 남는다)   // 끄면 번호가 올라가, 링크로 들어와 있던 손님은 더 못 쓴다
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
        return sendJson(res, 200, { ok: true, on: meta.link.on }), true;
      }
      if (sub === 'rename' && req.method === 'POST') {
        if (!canManage(meta, me)) return sendJson(res, 403, { error: '이름은 문서 주인만 바꿀 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const ext = (/\.[a-z0-9]{2,5}$/i.exec(meta.name) || [''])[0];
        let nm = String(body.name || '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
        if (ext && nm.toLowerCase().endsWith(ext.toLowerCase())) nm = nm.slice(0, -ext.length).trim();
        if (!nm) return sendJson(res, 400, { error: '이름을 적어 주세요' }), true;
        meta.name = nm + ext; meta.updatedAt = Date.now();
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true }); mirrorSoon();
        return sendJson(res, 200, { ok: true, name: meta.name }), true;
      }
      // ----- 암호 입장 설정(관리자만) -----
      if (sub === 'guest' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '암호 설정은 관리자만 할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        if (body.off) { if (meta.guest) { meta.guest.on = false; meta.guest.ver = (meta.guest.ver || 0) + 1; } }
        else if (body.role && !body.password) { if (!meta.guest || !meta.guest.on) return sendJson(res, 400, { error: '먼저 암호를 정해 주세요' }), true; meta.guest.role = body.role === 'view' ? 'view' : 'edit'; }
        else {
          const pw = String(body.password || '');
          if (pw.length < 6 || pw.length > 100) return sendJson(res, 400, { error: '암호는 6자 이상으로 정해 주세요' }), true;
          const salt = crypto.randomBytes(16).toString('hex');
          meta.guest = { on: true, role: body.role === 'view' ? 'view' : 'edit', salt, hash: pwHash(pw, salt), ver: ((meta.guest && meta.guest.ver) || 0) + 1, by: me, at: Date.now(), log: (meta.guest && meta.guest.log) || [] };
        }
        saveMeta(id, meta); broadcast({ kind: 'nrf', docId: id, by: me, list: true, members: true });
        return sendJson(res, 200, { ok: true, on: !!(meta.guest && meta.guest.on) }), true;
      }
      // ----- 참고 폴더 -----
      if (sub === 'refs' && req.method === 'GET') return sendJson(res, 200, publicRefs(id, me)), true;
      if (sub === 'refs' && req.method === 'POST') {
        const body = await core.jsonBody(req, res, MAX_REF * 1.4); if (!body) return true;
        const name = cleanName(body.name);
        if (!name) return sendJson(res, 400, { error: '파일 이름이 없습니다' }), true;
        const data = Buffer.from(String(body.data || '').replace(/^data:[^,]*,/, ''), 'base64');
        if (!data.length || data.length > MAX_REF) return sendJson(res, 413, { error: '비어 있거나 너무 큰 파일입니다(파일 하나 20MB 까지)' }), true;
        const r = refsOf(id);
        const folder = r.folders.includes(body.folder) ? body.folder : r.folders[0];
        if (r.files.reduce((a, f) => a + f.size, 0) + data.length > MAX_REF_DOC) return sendJson(res, 413, { error: '이 문서의 참고 폴더가 가득 찼습니다(200MB 까지)' }), true;
        if (freeBytes() - data.length < MIN_FREE) return sendJson(res, 507, { error: '서버 저장 공간이 부족해 지금은 올릴 수 없습니다' }), true;
        const fid = `r${crypto.randomBytes(5).toString('hex')}`;
        const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
        fs.mkdirSync(path.join(dirOf(id), 'refs'), { recursive: true });
        fs.writeFileSync(path.join(dirOf(id), 'refs', fid + ext), data);
        const f = { id: fid, name, folder, size: data.length, by: me, at: Date.now(), file: fid + ext };
        r.files.push(f); writeJson(refsFile(id), r);
        const unz = ext === '.zip' ? unzipRef(id, f, me) : null;
        broadcast({ kind: 'nrf', docId: id, by: me, refs: true });
        return sendJson(res, 200, { ok: true, file: { id: fid, name, folder, size: f.size }, ...(unz ? { unzip: unz } : {}) }), true;
      }
      if (sub === 'refs/folders' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        const name = cleanName(body.name, 40);
        const r = refsOf(id);
        if (!name) return sendJson(res, 400, { error: '폴더 이름을 적어 주세요' }), true;
        if (r.folders.includes(name)) return sendJson(res, 400, { error: '같은 이름의 폴더가 있습니다' }), true;
        if (r.folders.length >= 30) return sendJson(res, 400, { error: '폴더는 30개까지 만들 수 있습니다' }), true;
        r.folders.push(name); writeJson(refsFile(id), r);
        broadcast({ kind: 'nrf', docId: id, by: me, refs: true });
        return sendJson(res, 200, { ok: true, folders: r.folders }), true;
      }
      const rfd = /^refs\/folders\/(.+)$/.exec(sub);
      if (rfd && req.method === 'DELETE') {
        const name = decodeURIComponent(rfd[1]); const r = refsOf(id);
        if (!r.folders.includes(name)) return sendJson(res, 404, { error: '그런 폴더가 없습니다' }), true;
        if (r.files.some((f) => f.folder === name)) return sendJson(res, 400, { error: '파일이 든 폴더는 지울 수 없습니다 — 파일을 먼저 지워 주세요' }), true;
        if (r.folders.length === 1) return sendJson(res, 400, { error: '폴더는 하나 이상 있어야 합니다' }), true;
        r.folders = r.folders.filter((x) => x !== name); writeJson(refsFile(id), r);
        broadcast({ kind: 'nrf', docId: id, by: me, refs: true });
        return sendJson(res, 200, { ok: true, folders: r.folders }), true;
      }
      const ru = /^refs\/(r[a-f0-9]{10})\/unzip$/.exec(sub);
      if (ru && req.method === 'POST') {
        const f = refsOf(id).files.find((x) => x.id === ru[1]);
        if (!f || !/\.zip$/i.test(f.file)) return sendJson(res, 404, { error: '압축 파일이 없습니다' }), true;
        const out = unzipRef(id, f, me);
        if (out.error) return sendJson(res, 400, out), true;
        broadcast({ kind: 'nrf', docId: id, by: me, refs: true });
        return sendJson(res, 200, { ok: true, ...out }), true;
      }
      const rf = /^refs\/(r[a-f0-9]{10})$/.exec(sub);
      if (rf) {
        const r = refsOf(id); const f = r.files.find((x) => x.id === rf[1]);
        if (!f) return sendJson(res, 404, { error: '그런 참고 파일이 없습니다' }), true;
        const abs = path.join(dirOf(id), 'refs', f.file);
        if (req.method === 'GET') {
          const data = fs.readFileSync(abs);
          const inline = REF_INLINE[path.extname(f.file)];
          res.writeHead(200, { 'content-type': inline || 'application/octet-stream', 'content-length': data.length, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'", 'content-disposition': `${inline && !url.searchParams.get('dl') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'private, no-store' });
          return res.end(data), true;
        }
        if (req.method === 'POST') {
          if (f.by !== me && !canManage(meta, me)) return sendJson(res, 403, { error: '올린 사람만 고칠 수 있습니다' }), true;
          const body = await core.jsonBody(req, res); if (!body) return true;
          if (typeof body.from === 'string') f.from = body.from.replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
          if (typeof body.note === 'string') f.note = body.note.replace(/\r/g, '').trim().slice(0, 4000);
          writeJson(refsFile(id), r);
          broadcast({ kind: 'nrf', docId: id, by: me, refs: true });
          return sendJson(res, 200, { ok: true, file: { id: f.id, from: f.from || '', note: f.note || '' } }), true;
        }
        if (req.method === 'DELETE') {
          if (f.by !== me && !canManage(meta, me)) return sendJson(res, 403, { error: '올린 사람만 지울 수 있습니다' }), true;
          try { fs.unlinkSync(abs); } catch {}
          r.files = r.files.filter((x) => x !== f); writeJson(refsFile(id), r);
          broadcast({ kind: 'nrf', docId: id, by: me, refs: true });
          return sendJson(res, 200, { ok: true }), true;
        }
      }
      if (!sub && req.method === 'DELETE') {
        if (!canManage(meta, me)) return sendJson(res, 403, { error: '올린 사람만 지울 수 있습니다' }), true;
        fs.rmSync(dirOf(id), { recursive: true, force: true }); cache.delete(id); states.delete(id);
        broadcast({ kind: 'nrf', docId: id, by: me, list: true, deleted: true }); mirrorSoon();
        return sendJson(res, 200, { ok: true }), true;
      }
      if (!sub && req.method === 'GET') {
        // 이 사람이 이 문서를 실제로 열어 본 때를 적어 둔다(공유 창에서 '들어왔는지' 보이게). 1분에 한 번만.
        if (me !== 'ana') { const seen = meta.seen || (meta.seen = {}); if (!seen[me] || Date.now() - seen[me] > 60000) { seen[me] = Date.now(); saveMeta(id, meta); } }
        const hit = cache.has(id); const t1 = Date.now();
        const rec = loadDoc(id);
        return sendJson(res, 200, { load: { cached: hit, parseMs: hit ? 0 : rec.ms, ms: Date.now() - t1, ...rec.stats }, doc: { ...meta, viewOnly: viewOnly(meta, me), guest: guestInfo(meta, me), link: linkInfo(meta, me), requests: canManage(meta, me) ? meta.requests : [], canManage: canManage(meta, me), uploaderName: nameOf(meta.uploader) }, view: rec.view, ...publicState(id), me: { email: me, name: nameOf(me), admin: isAdmin(me) } }), true;
      }
      if (sub === 'state' && req.method === 'GET') return sendJson(res, 200, { ...publicState(id), doc: { viewOnly: viewOnly(meta, me), guest: guestInfo(meta, me), link: linkInfo(meta, me), name: meta.name, members: meta.members, roles: meta.roles || {}, uploader: meta.uploader, requests: canManage(meta, me) ? meta.requests : [], canManage: canManage(meta, me) } }), true;
      if (sub === 'original') return sendFile(res, fs.readFileSync(path.join(dirOf(id), `original.${meta.format}`)), meta.name, 'application/octet-stream'), true;
      const stem = meta.name.replace(/\.[a-z0-9]{2,5}$/i, '');
      if (sub === 'final.txt') return sendFile(res, Buffer.from(finalTextOf(id), 'utf8'), `${stem}_최종본.txt`, 'text/plain; charset=utf-8'), true;
      // 쪽 고정(수정 가능) — 인쇄 화면의 쪽마다 그려진 자리를 그대로 옮긴다: 글은 줄 단위 글상자, 칸 바탕 · 테두리 · 그림은 도형. PDF 로 다시 바꿔 같은지 잰다
      if ((sub === 'export.docx' || sub === 'export.pptx') && (url.searchParams.get('layout') === 'exact' || sub === 'export.pptx')) {
        const kind = sub.slice('export.'.length); const job = String(url.searchParams.get('job') || ''); const okJob = /^[a-z0-9]{4,16}$/.test(job); let n = 0;
        const say = (m, pct) => { if (okJob) sendTo(me, { kind: 'nrf', job, i: ++n, m, pct }); };
        try {
          say('서버의 브라우저로 인쇄 화면을 여는 중 — PDF 와 같은 화면', 10);
          const u = `http://127.0.0.1:${process.env.PORT || 8865}/nrf.html?doc=${id}&print=1&memo=0&changes=0`;
          const r = await pdfexport.readPage(u, 'window.__layoutDoc().then((x) => JSON.stringify(x))', { onStep: (m) => say(m, 25), timeout: 180000 });
          const L = JSON.parse(r.value); L.title = meta.name;
          say(`쪽 ${L.pages.length}장의 글줄 · 칸 · 그림 자리를 ${kind === 'pptx' ? '슬라이드' : 'Word 쪽'}에 옮기는 중`, 50);
          const data = kind === 'pptx' ? fixedexport.toPptx(L) : fixedexport.toDocxFixed(L);
          let vh = 'skip';
          if (url.searchParams.get('verify') !== '0' && (kind === 'docx' || fixedexport.canOpen(kind))) {
            say('같은지 재는 중 — PDF 를 바로 뽑고, 만든 파일도 PDF 로 바꿔 쪽마다 비교', 65);
            const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fxr-'));
            try {
              const pdf = await pdfexport.renderPdf(u, {}); fs.writeFileSync(path.join(tmp, 'direct.pdf'), pdf.data); fs.writeFileSync(path.join(tmp, `out.${kind}`), data);
              const v = await fixedexport.verify(path.join(tmp, 'direct.pdf'), path.join(tmp, `out.${kind}`), { tmp });
              vh = `${v.pagesOut}/${v.pagesDirect}/${Math.round(v.text * 100)}/${Math.round(v.pixel * 100)}`;
              say(`비교 — 쪽 ${v.pagesOut}/${v.pagesDirect} · 글 ${Math.round(v.text * 100)}% · 모양 ${Math.round(v.pixel * 100)}% 같음`, 92);
            } catch (e) { vh = 'error'; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
          }
          res.setHeader('x-docs-pages', String(L.pages.length)); res.setHeader('x-docs-verify', vh);
          const mime = kind === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          return sendFile(res, data, `${stem}_최종본_쪽고정.${kind}`, mime), true;
        } catch (e) { return sendJson(res, 500, { error: `${kind.toUpperCase()} 를 만들지 못했습니다: ${e.message}` }), true; }
      }
      const officePrint = (sub === 'export.docx' || sub === 'export.hwpx') && !['editable', 'exact'].includes(url.searchParams.get('layout'));
      if (sub === 'export.pdf' || officePrint) {
        const format = sub.slice('export.'.length);
        const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', hwpx: 'application/hwp+zip' };
        const memo = url.searchParams.get('memo') === '1', changes = url.searchParams.get('changes') !== '0';
        const job = url.searchParams.get('job') || ''; let n = 0;
        const onStep = (m) => { if (/^[a-z0-9]{4,16}$/.test(job)) sendTo(me, { kind: 'nrf', job, i: ++n, m, pct: 60 }); };
        try {
          const u = `http://127.0.0.1:${process.env.PORT || 8865}/nrf.html?doc=${id}&print=1&memo=${memo ? 1 : 0}&changes=${changes ? 1 : 0}`;
          const r = officePrint ? await pdfexport.renderOffice(u, format, { onStep }) : await pdfexport.renderPdf(u, { onStep });
          res.setHeader('x-docs-pages', String(r.pages));
          return sendFile(res, r.data, `${stem}${changes ? '_수정표시' : '_최종본'}${memo ? '_메모' : ''}${officePrint ? '_인쇄용' : ''}.${format}`, mime[format]), true;
        } catch (e) { return sendJson(res, 500, { error: `${format.toUpperCase()} 내보내기에 실패했습니다: ${e.message}` }), true; }
      }
      // Word 내보내기 — PDF 로 바로 내보낸 것과 쪽 수 · 서식이 같게(인쇄 화면을 쪽마다 Word 로 옮기고, 다시 PDF 로 바꿔 쪽마다 맞는지 확인)
      if (sub === 'export.docx') {
        const job = String(url.searchParams.get('job') || ''); const okJob = /^[a-z0-9]{4,16}$/.test(job); let n = 0;
        const say = (m, pct) => { if (okJob) sendTo(me, { kind: 'nrf', job, i: ++n, m, pct }); };
        try {
          say('Word 만들 준비 — 서버의 브라우저로 인쇄 화면을 여는 중', 15);
          const u = `http://127.0.0.1:${process.env.PORT || 8865}/nrf.html?doc=${id}&print=1&memo=0&changes=0`;
          const r = await pdfexport.readPage(u, 'window.__exportDoc().then((x) => JSON.stringify(x))', { onStep: (m) => say(m, 35) });
          const ex = JSON.parse(r.value);
          const d = await docxexport.toDocx(ex, { tmp: require('node:os').tmpdir(), onStep: (m) => say(m, 70) });
          say(d.ok ? `Word 완성 — ${d.pages}쪽, PDF 와 쪽마다 맞음` : `Word 완성 — Word ${d.pages}쪽 · PDF ${d.target}쪽${d.off.length ? ` (어긋난 쪽 ${d.off.slice(0, 5).join(', ')})` : ''}`, 95);
          res.setHeader('x-docs-pages', `${d.pages}/${d.target}/${d.ok ? 1 : 0}/${Math.round(d.scale * 100)}`);
          return sendFile(res, d.data, `${stem}_최종본.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true;
        } catch (e) { return sendJson(res, 500, { error: `Word 파일을 만들지 못했습니다: ${e.message}` }), true; }
      }
      // 한/글(HWPX) 내보내기 — PDF 의 쪽마다 시작하는 문단에 쪽 나눔을 달아 한/글에서도 같은 자리에서 쪽이 넘어가게
      if (sub === 'export.hwpx') {
        if (meta.format !== 'hwpx') return sendJson(res, 400, { error: 'HWPX 로 내보내기는 한/글(HWPX) 문서만 됩니다' }), true;
        const job = String(url.searchParams.get('job') || ''); const okJob = /^[a-z0-9]{4,16}$/.test(job); let n = 0;
        const say = (m, pct) => { if (okJob) sendTo(me, { kind: 'nrf', job, i: ++n, m, pct }); };
        try {
          say('PDF 와 같은 쪽 나눔을 읽는 중 — 서버의 브라우저로 인쇄 화면을 여는 중', 20);
          const u = `http://127.0.0.1:${process.env.PORT || 8865}/nrf.html?doc=${id}&print=1&memo=0&changes=0`;
          const r = await pdfexport.readPage(u, `JSON.stringify([...document.querySelectorAll('#paper .sheet')].map((sh) => ((sh.querySelector(':scope > .sec') || sh).textContent || '').replace(/\\s+/g, '').slice(0, 24)))`, { onStep: (m) => say(m, 50) });
          const starts = JSON.parse(r.value);
          const f = finalHwpx(id); const L = docxexport.lockHwpxPages(f.data, starts);
          say(`HWPX 완성 — ${starts.length}쪽 중 ${L.set + 1}쪽 시작에 쪽 나눔${L.skipped.length ? ` (앞 쪽에서 이어지는 표 ${L.skipped.length}곳은 한/글이 나눔)` : ''}`, 95);
          res.setHeader('x-docs-pages', `${starts.length}/${L.set}/${L.skipped.join(',')}`);
          return sendFile(res, L.data, `${stem}_최종본.hwpx`, 'application/hwp+zip'), true;
        } catch (e) { return sendJson(res, 500, { error: `HWPX 를 만들지 못했습니다: ${e.message}` }), true; }
      }
      if (sub === 'final.docx') {
        if (isHwp(meta)) return sendJson(res, 400, { error: '한/글 문서의 최종본은 HWPX 로 받습니다' }), true;
        const r = finalHwpx(id);
        if (url.searchParams.get('check')) return sendJson(res, 200, { stats: r.stats, size: r.data.length }), true;
        return sendFile(res, r.data, `${stem}_최종본.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true;
      }
      if (sub === 'final.hwpx') {
        if (meta.format !== 'hwpx') return sendJson(res, 400, { error: 'HWP(바이너리) 원본은 아직 HWPX 최종본을 만들 수 없습니다 — 한/글에서 HWPX 로 저장해 올려 주세요' }), true;
        const r = finalHwpx(id);
        if (url.searchParams.get('check')) return sendJson(res, 200, { stats: r.stats, size: r.data.length }), true;
        return sendFile(res, r.data, `${stem}_최종본.hwpx`, 'application/hwp+zip'), true;
      }
      if (sub === 'image') {
        const rec = loadDoc(id); const name = url.searchParams.get('name') || '';
        const names = rec.doc.binNames || [];
        const hit = names.find((b) => b === name) || names.find((b) => path.basename(b).replace(/\.[^.]+$/, '') === name) || names.find((b) => path.basename(b) === name);
        if (!hit || !rec.doc.images) return sendJson(res, 404, { error: 'no such image' }), true;
        const data = rec.doc.images(hit);
        res.writeHead(200, { 'content-type': IMG_MIME[path.extname(hit).toLowerCase()] || 'application/octet-stream', 'content-length': data.length, 'cache-control': 'private, max-age=3600' });
        return res.end(data), true;
      }
      if (sub === 'edit' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        if (typeof body.text !== 'string' || body.text.length > MAX_PARA) return sendJson(res, 400, { error: 'text 가 없거나 너무 깁니다' }), true;
        const text = body.text.replace(/\r/g, '');
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        const r = editPara(id, String(body.key || ''), typeof body.base === 'string' ? body.base : undefined, text, who2.by);
        if (r.code === 200) markVia(id, r.cids, who2.via);
        return sendJson(res, r.code, r.code === 200 ? { ok: true, para: r.para, cids: r.cids || [], rev: stateOf(id).rev } : { error: r.error, para: r.para }), true;
      }
      if (sub === 'format' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        const r = formatOp(id, body, who2.by);
        if (r.code === 200) markVia(id, r.cids, who2.via);
        return sendJson(res, r.code, r.code === 200 ? { ok: true, cids: r.cids, rev: stateOf(id).rev } : { error: r.error }), true;
      }
      if (sub === 'table' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        if (!isHwp(meta)) return sendJson(res, 400, { error: '표 모양 바꾸기(행 추가·칸 병합)는 아직 한/글 문서에서만 됩니다 — 칸 안의 글은 고칠 수 있습니다' }), true;
        const r = tableOp(id, body, who2.by);
        if (r.code === 200) markVia(id, [r.op.cid], who2.via);
        return sendJson(res, r.code, r.code === 200 ? { ok: true, op: r.op, grid: r.grid, rev: stateOf(id).rev } : { error: r.error }), true;
      }
      if (sub === 'para' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        const text = String(body.text || '').replace(/[\r\n]+/g, ' ').slice(0, MAX_PARA);
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        if (body.del) {                                             // {del: 문단키} — 그 문단(줄)을 지운다
          const d = delPara(id, String(body.del), who2.by);
          if (d.code === 200) markVia(id, d.cids || [], who2.via);
          return sendJson(res, d.code, d.code === 200 ? { ok: true, cids: d.cids || [], rev: stateOf(id).rev } : { error: d.error, quiet: !!d.quiet }), true;
        }
        const r = addPara(id, String(body.after || ''), text, who2.by);
        if (r.code === 200) markVia(id, [r.cid], who2.via);
        return sendJson(res, r.code, r.code === 200 ? { ok: true, key: r.key, cid: r.cid, rev: stateOf(id).rev } : { error: r.error }), true;
      }
      // ----- 문서검토 -----
      if (sub === 'review' && req.method === 'POST') {
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const job = typeof body.job === 'string' && /^[a-z0-9]{4,16}$/.test(body.job) ? body.job : ''; const t0 = Date.now(); const log = [];
        const say = async (msg, pct) => { log.push({ m: msg, ms: Date.now() - t0, pct }); if (job) { sendTo(me, { kind: 'nrf', job, i: log.length, m: msg, pct }); await new Promise((r) => setImmediate(r)); } };
        const lone = Array.isArray(body.lone) ? body.lone.slice(0, 20).filter((x) => x && typeof x.k === 'string').map((x) => ({ k: x.k.slice(0, 40), page: +x.page || 0, lines: +x.lines || 0 })) : [];
        try { const review = await runReview(id, actorOf(meta, me, {}).by, say, lone); return sendJson(res, 200, { ok: true, review, log }), true; }
        catch (e) { return sendJson(res, 400, { error: `검토하지 못했습니다: ${e.message}`, log }), true; }
      }
      if (sub === 'review-ask' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: 'AI 검토는 이 Docs 의 주인 계정에서만 돕니다' }), true;
        const s = stateOf(id); if (!s.review) return sendJson(res, 400, { error: '먼저 문서검토를 돌려 주세요' }), true;
        s.review.judge = { status: 'asked', askedAt: Date.now(), log: [{ m: '에이전트에게 맡김 — 대화 창에 지시가 들어갔습니다', at: Date.now() }] }; saveState(id, me);
        const base = `http://127.0.0.1:${process.env.PORT || 8865}/api/nrf/docs/${id}`;
        const text = `[문서검토] 문서 ${id} AI 검토 — "${String(meta.name).replace(/["\n]/g, ' ').slice(0, 40)}"\n`
          + 'skills/doc-review/SKILL.md 의 절차대로 이 문서를 읽고 규칙으로 못 잡는 AI 작성 신호를 짚고(많아야 40곳), 짚은 곳과 규칙 메모 **모두**에 어떻게 바꾸면 좋을지 제안(from → to)을 달아 주세요 — 결과를 열면 제안이 이미 붙어 있어야 합니다.\n'
          + `읽기: curl -s ${base}/review-input -o <스크래치패드>/dr-${id}.json\n`
          + `진행 알리기(단계마다): POST ${base}/review-progress {"m":"지금 하는 일"}\n`
          + `등록: POST ${base}/review-judge {"add":[{"key":"문단 키","quote":"문서 글자 그대로 6~40자","level":"문단|문장|단어|조판","pattern":"12자 이내","why":"…","fix":"…","from":"바꿀 원래 글","to":"바꾼 글"}],"suggest":[{"id":"x40","from":"바꿀 원래 글","to":"바꾼 글"}],"note":"읽은 인상 한 문장"}`;
        return sendJson(res, 200, { ok: true, text }), true;
      }
      if (sub === 'review-input' && req.method === 'GET') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '주인만 볼 수 있습니다' }), true;
        const s = stateOf(id);
        return sendJson(res, 200, { id, name: meta.name, reviewer: (DR_REVIEWER.trim() + '\n' + DRO.REVIEWER_NOTE.trim()), paras: drParas(id).map((p) => ({ k: p.k, t: p.text })), rules: ((s.review && s.review.global) || []).concat((s.notes || []).filter((n) => n.tag === DR_TAG && n.src !== 'AI').map((n) => ({ id: n.id, rule: n.rule, pattern: n.label, ev: n.ev, key: n.key, quote: n.quote, fix: n.fix }))).slice(0, 200), verdict: s.review && s.review.verdict }), true;
      }
      if (sub === 'review-progress' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '에이전트(또는 주인)만 알릴 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const s = stateOf(id); const j = s.review && s.review.judge;
        if (!j || j.status !== 'asked') return sendJson(res, 409, { error: '맡겨진 AI 검토가 없습니다' }), true;
        const line = { m: String(body.m || '').slice(0, 200), at: Date.now() }; if (!line.m) return sendJson(res, 400, { error: 'm 이 비었습니다' }), true;
        j.log = [...(j.log || []), line].slice(-30); writeJson(path.join(dirOf(id), 'state.json'), s);
        broadcast({ kind: 'nrf', docId: id, rp: line });
        return sendJson(res, 200, { ok: true }), true;
      }
      if (sub === 'review-judge' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '에이전트(또는 주인)만 등록할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 1e6); if (!body) return true;
        return sendJson(res, 200, { ok: true, ...drApply(id, body) }), true;
      }
      // ----- 출처 -----
      if (sub === 'source' && req.method === 'POST') {
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const job = typeof body.job === 'string' && /^[a-z0-9]{4,16}$/.test(body.job) ? body.job : ''; const t0 = Date.now(); const log = [];
        const say = async (msg, pct) => { log.push({ m: msg, ms: Date.now() - t0, pct }); if (job) { sendTo(me, { kind: 'nrf', job, i: log.length, m: msg, pct }); await new Promise((r) => setImmediate(r)); } };
        try { const source = await runSource(id, actorOf(meta, me, {}).by, say); return sendJson(res, 200, { ok: true, source: { ...source, ai: me === 'ana' || isAdmin(me) }, log }), true; }
        catch (e) { return sendJson(res, 400, { error: `출처를 대조하지 못했습니다: ${e.message}`, log }), true; }
      }
      if (sub === 'source-ask' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: 'AI 대조는 이 Docs 의 주인 계정에서만 돕니다' }), true;
        const s = stateOf(id); if (!s.source) return sendJson(res, 400, { error: '먼저 출처 대조를 돌려 주세요' }), true;
        s.source.judge = { status: 'asked', askedAt: Date.now(), log: [{ m: '에이전트에게 맡김 — 대화 창에 지시가 들어갔습니다', at: Date.now() }] }; saveState(id, me);
        const base = `http://127.0.0.1:${process.env.PORT || 8865}/api/nrf/docs/${id}`;
        const text = `[출처] 문서 ${id} AI 대조 — "${String(meta.name).replace(/["\n]/g, ' ').slice(0, 40)}"\n`
          + 'skills/source-check/SKILL.md 의 절차대로 기획서 문장마다 참고 폴더의 어느 문서·어느 자리에서 왔는지(근거), 참고 문서와 다른지(상반), 찾을 수 없는지(없음)를 확정해 주세요. 서버가 1차로 매긴 것을 고치고 확인합니다.\n'
          + `읽기: curl -s ${base}/source-input -o <스크래치패드>/src-${id}.json  (참고 글 전체는 응답의 files[].path JSON)\n`
          + `진행 알리기(단계마다): POST ${base}/source-progress {"m":"지금 하는 일"}\n`
          + `등록: POST ${base}/source-judge {"set":[{"id":"x40","rel":"근거|상반|없음","fid":"참고 파일 id","ref":"참고 글 글자 그대로","loc":"자리","why":"한 문장"}],"note":"한 줄 총평"}`;
        return sendJson(res, 200, { ok: true, text }), true;
      }
      if (sub === 'source-input' && req.method === 'GET') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '주인만 볼 수 있습니다' }), true;
        const s = stateOf(id); if (!s.source) return sendJson(res, 400, { error: '먼저 출처 대조를 돌려 주세요' }), true;
        return sendJson(res, 200, { id, name: meta.name, files: (s.source.files || []).map((f) => ({ ...f, path: refTextFile(id, f.fid) })), units: (s.notes || []).filter((n) => n.tag === SRC_TAG).map((n) => ({ id: n.id, k: n.key, t: n.quote, rel: n.rel, score: n.score, ...(n.ref ? { ref: n.ref } : {}), why: n.reason })), stats: s.source.stats }), true;
      }
      if (sub === 'source-progress' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '에이전트(또는 주인)만 알릴 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const s = stateOf(id); const j = s.source && s.source.judge;
        if (!j || j.status !== 'asked') return sendJson(res, 409, { error: '맡겨진 AI 대조가 없습니다' }), true;
        const line = { m: String(body.m || '').slice(0, 200), at: Date.now() }; if (!line.m) return sendJson(res, 400, { error: 'm 이 비었습니다' }), true;
        j.log = [...(j.log || []), line].slice(-30); writeJson(path.join(dirOf(id), 'state.json'), s);
        broadcast({ kind: 'nrf', docId: id, sp: line });
        return sendJson(res, 200, { ok: true }), true;
      }
      if (sub === 'source-judge' && req.method === 'POST') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '에이전트(또는 주인)만 등록할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4e6); if (!body) return true;
        const r = srcApply(id, body); if (r.error) return sendJson(res, 400, r), true;
        broadcast({ kind: 'nrf', docId: id, by: me });
        return sendJson(res, 200, { ok: true, ...r }), true;
      }
      if (sub === 'source-notes' && req.method === 'DELETE') {
        const s = stateOf(id); s.notes = (s.notes || []).filter((n) => n.tag !== SRC_TAG); s.source = null; saveState(id, me);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (sub === 'review-notes' && req.method === 'DELETE') {
        const s = stateOf(id); s.notes = (s.notes || []).filter((n) => n.tag !== DR_TAG); s.review = null; s.drOff = {}; saveState(id, me);
        return sendJson(res, 200, { ok: true }), true;
      }
      // ----- 표현점검 -----
      if (sub === 'check' && req.method === 'POST') {
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const job = typeof body.job === 'string' && /^[a-z0-9]{4,16}$/.test(body.job) ? body.job : ''; const t0 = Date.now(); const log = [];
        const say = async (msg, pct) => { log.push({ m: msg, ms: Date.now() - t0, pct }); if (job) { sendTo(me, { kind: 'nrf', job, i: log.length, m: msg, pct }); await new Promise((r) => setImmediate(r)); } };
        try { const check = await runCheck(id, actorOf(meta, me, {}).by, aitell.GENRES.includes(body.genre) ? body.genre : xpSettings().genre, say); return sendJson(res, 200, { ok: true, check, log }), true; }
        catch (e) { return sendJson(res, 400, { error: `점검하지 못했습니다: ${e.message}`, log }), true; }
      }
      if (sub === 'judge-ask' && req.method === 'POST') {          // AI 판단을 에이전트에게 맡기는 지시문(화면이 에이전트 대화로 보낸다) — 주인만
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: 'AI 판단은 이 Docs 의 주인 계정에서만 돕니다' }), true;
        const s = stateOf(id); if (!s.check) return sendJson(res, 400, { error: '먼저 표현점검을 돌려 주세요' }), true;
        const ts = aiTypes(); if (!ts.length) return sendJson(res, 400, { error: 'AI 판단 항목이 모두 꺼져 있습니다' }), true;
        s.check.judge = { status: 'asked', askedAt: Date.now(), log: [{ m: '에이전트에게 맡김 — 대화 창에 지시가 들어갔습니다', at: Date.now() }] }; saveState(id, me);
        const base = `http://127.0.0.1:${process.env.PORT || 8865}/api/nrf/docs/${id}`;
        const text = `[표현점검] 문서 ${id} AI 판단 — "${String(meta.name).replace(/["\n]/g, ' ').slice(0, 40)}"\n`
          + `skills/expression-check/SKILL.md 의 절차대로 이 문서를 읽고 AI 판단 항목 ${ts.length}개(${ts.map((t) => t.id).join(' · ')})와 참고 메모의 문맥을 확인하고, 남는 메모 **모두**에 어떻게 바꾸면 좋을지 제안(from → to)을 달아 주세요 — 사람은 결과를 열면 제안이 이미 붙어 있기를 기대합니다.\n`
          + `읽기: curl -s ${base}/judge-input -o <스크래치패드>/xp-${id}.json\n`
          + `진행 알리기(단계마다): POST ${base}/judge-progress {"m":"지금 하는 일"}\n`
          + `등록: POST ${base}/judge {"add":[{"quote":"문단 글자 그대로","key":"문단 키","rule":"C-4","reason":"근거","from":"바꿀 원래 글","to":"바꾼 글"}],"confirm":[{"id":"x12","why":"…"}],"dismiss":[{"id":"x30","why":"…"}],"suggest":[{"id":"x40","from":"바꿀 원래 글","to":"바꾼 글"}],"note":"한 줄 총평"}`;
        return sendJson(res, 200, { ok: true, text }), true;
      }
      if (sub === 'judge-input' && req.method === 'GET') {
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '주인만 볼 수 있습니다' }), true;
        return sendJson(res, 200, judgeInput(id)), true;
      }
      if (sub === 'judge-progress' && req.method === 'POST') {     // 에이전트가 지금 하는 일을 알린다 — 화면의 'AI 판단 중' 표시에 바로 보인다
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '에이전트(또는 주인)만 알릴 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 4000); if (!body) return true;
        const s = stateOf(id); const j = s.check && s.check.judge;
        if (!j || j.status !== 'asked') return sendJson(res, 409, { error: '맡겨진 AI 판단이 없습니다' }), true;
        const line = { m: String(body.m || '').slice(0, 200), at: Date.now() }; if (!line.m) return sendJson(res, 400, { error: 'm 이 비었습니다' }), true;
        j.log = [...(j.log || []), line].slice(-30);
        writeJson(path.join(dirOf(id), 'state.json'), s);                 // 판 번호는 올리지 않는다(문서를 다시 받지 않게)
        broadcast({ kind: 'nrf', docId: id, jp: line });
        return sendJson(res, 200, { ok: true }), true;
      }
      if (sub === 'judge' && req.method === 'POST') {              // 에이전트가 AI 판단 결과를 등록한다
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: '에이전트(또는 주인)만 등록할 수 있습니다' }), true;
        const body = await core.jsonBody(req, res, 2e6); if (!body) return true;
        return sendJson(res, 200, { ok: true, ...judgeApply(id, body) }), true;
      }
      if (sub === 'notes' && req.method === 'DELETE') {            // 표현점검 메모 모두 지우기
        const s = stateOf(id); s.notes = (s.notes || []).filter((n) => n.tag !== XP_TAG); s.check = null; s.noteOff = {}; saveState(id, me);
        return sendJson(res, 200, { ok: true }), true;
      }
      // 직접 다는 메모: 문단의 최종 글 a~b 자리에 — { key, a, b, text? }
      if (sub === 'notes' && req.method === 'POST') {
        const body = await core.jsonBody(req, res, 20000); if (!body) return true;
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        const key = String(body.key || ''); const segs = segsOf(id, key);
        if (!segs) return sendJson(res, 404, { error: '그런 문단이 없습니다' }), true;
        const fin = track.finalText(segs); const a = Math.max(0, Math.min(fin.length, body.a | 0)); const b = Math.max(a, Math.min(fin.length, body.b | 0));
        if (b <= a) return sendJson(res, 400, { error: '메모를 달 글을 끌어서 고르세요' }), true;
        const s = stateOf(id);
        const n = { id: `x${++s.seq}`, tag: '메모', key, a, b, quote: fin.slice(a, b).slice(0, 400), text: String(body.text || '').trim().slice(0, MAX_COMMENT), by: who2.by, at: Date.now(), ...(who2.via ? { via: who2.via } : {}) };
        n.b = n.a + n.quote.length;
        (s.notes = s.notes || []).push(n); saveState(id, who2.by);
        return sendJson(res, 200, { ok: true, note: n }), true;
      }
      const sm = /^notes\/(x\d+)\/(suggest|suggest-ask|apply)$/.exec(sub);
      if (sm && req.method === 'POST') {
        const s = stateOf(id); const n = (s.notes || []).find((x) => x.id === sm[1]);
        if (!n || n.tag === '메모') return sendJson(res, 404, { error: '그런 메모가 없습니다' }), true;
        if (sm[2] === 'apply') {                                    // 제안대로 고친다 — 누른 사람 이름의 변경으로 남는다(취소선 + 밑줄)
          const body = await core.jsonBody(req, res, 4000); if (!body) return true;
          const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
          const r = applySuggest(id, n, who2.by);
          if (r.code === 200) markVia(id, r.cids, who2.via);
          return sendJson(res, r.code, r.code === 200 ? { ok: true, cids: r.cids || [], rev: s.rev } : { error: r.error }), true;
        }
        if (!(me === 'ana' || isAdmin(me))) return sendJson(res, 403, { error: 'AI 제안은 이 Docs 의 주인 계정에서만 받습니다' }), true;
        const body = await core.jsonBody(req, res, 20000); if (!body) return true;
        if (sm[2] === 'suggest') { const e = setSuggest(id, n, body.from || n.quote, body.to); if (e) return sendJson(res, 400, { error: e }), true; saveState(id, 'ana'); return sendJson(res, 200, { ok: true, sug: n.sug }), true; }
        n.sugAsk = Date.now(); saveState(id, me);                    // suggest-ask: 에이전트에게 보낼 지시문
        const base = `http://127.0.0.1:${process.env.PORT || 8865}/api/nrf/docs/${id}`;
        const para = track.finalText(segsOf(id, n.key) || []);
        const text = `[제안] 문서 ${id} 메모 ${n.id} — ${n.tag} ${n.rule || ''} "${String(n.label || '').slice(0, 40)}"\n`
          + `skills/expression-check/SKILL.md 의 "제안" 절차대로, 아래 문단에서 이 메모가 짚은 곳을 어떻게 바꾸면 좋을지 제안해 주세요(사실·수치·인용은 그대로).\n`
          + `짚은 곳: "${String(n.quote || '').slice(0, 120)}" · 이유: ${String(n.reason || '').slice(0, 200)}\n`
          + `문단(키 ${n.key}): ${para.slice(0, 1500)}\n`
          + `등록: POST ${base}/notes/${n.id}/suggest {"from":"문단 글자 그대로(바꿀 범위)","to":"바꾼 글"}`;
        return sendJson(res, 200, { ok: true, text }), true;
      }
      // 메모 댓글 · 해결: 모든 메모(직접 단 메모 · 표현점검 · 문서검토 · 출처)에 댓글을 달고, 해결/다시 열기를 한다
      const rm = /^notes\/(x\d+)\/(reply|resolve)$/.exec(sub);
      if (rm && req.method === 'POST') {
        const body = await core.jsonBody(req, res, 20000); if (!body) return true;
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        const s = stateOf(id); const n = (s.notes || []).find((x) => x.id === rm[1]);
        if (!n) return sendJson(res, 404, { error: '그런 메모가 없습니다' }), true;
        n.replies = n.replies || [];
        if (rm[2] === 'reply') {
          const text = String(body.text || '').trim().slice(0, MAX_COMMENT); if (!text) return sendJson(res, 400, { error: '댓글을 쓰세요' }), true;
          n.replies.push({ id: `r${++s.seq}`, by: who2.by, at: Date.now(), text, ...(who2.via ? { via: who2.via } : {}) });
        } else {
          const on = body.on !== false;
          if (on) n.resolved = { by: who2.by, at: Date.now() }; else delete n.resolved;
          n.replies.push({ id: `r${++s.seq}`, by: who2.by, at: Date.now(), sys: on ? 'resolve' : 'reopen' });
        }
        saveState(id, who2.by);
        return sendJson(res, 200, { ok: true, note: n }), true;
      }
      const dm = /^notes\/(x\d+)\/reply\/(r\d+)$/.exec(sub);
      if (dm && req.method === 'DELETE') {                         // 내 댓글 지우기
        const s = stateOf(id); const n = (s.notes || []).find((x) => x.id === dm[1]); const r = n && (n.replies || []).find((x) => x.id === dm[2]);
        if (!r) return sendJson(res, 404, { error: '그런 댓글이 없습니다' }), true;
        if (!(r.by === me || canManage(meta, me))) return sendJson(res, 403, { error: '댓글은 쓴 사람만 지울 수 있습니다' }), true;
        n.replies = n.replies.filter((x) => x !== r); saveState(id, me);
        return sendJson(res, 200, { ok: true }), true;
      }
      const nm = /^notes\/(x\d+)$/.exec(sub);
      if (nm && req.method === 'POST') {                           // 메모 글 고치기(쓴 사람)
        const body = await core.jsonBody(req, res, 20000); if (!body) return true;
        const s = stateOf(id); const n = (s.notes || []).find((x) => x.id === nm[1]);
        if (!n || n.tag !== '메모') return sendJson(res, 404, { error: '그런 메모가 없습니다' }), true;
        if (!(n.by === me || canManage(meta, me))) return sendJson(res, 403, { error: '메모는 쓴 사람만 고칠 수 있습니다' }), true;
        n.text = String(body.text || '').trim().slice(0, MAX_COMMENT); n.edited = Date.now(); saveState(id, me);
        return sendJson(res, 200, { ok: true, note: n }), true;
      }
      if (nm && req.method === 'DELETE') {                         // 메모 하나 지우기 — 표현점검 메모는 다시 점검해도 같은 곳에 다시 달지 않는다
        const s = stateOf(id); const n = (s.notes || []).find((x) => x.id === nm[1]);
        if (!n) return sendJson(res, 404, { error: '그런 메모가 없습니다' }), true;
        if (n.tag === '메모' && !(n.by === me || canManage(meta, me))) return sendJson(res, 403, { error: '메모는 쓴 사람이나 문서 주인만 지울 수 있습니다' }), true;
        s.notes = s.notes.filter((x) => x !== n); if (n.tag === XP_TAG) (s.noteOff = s.noteOff || {})[noteSig(n)] = 1; if (n.tag === DR_TAG) { (s.drOff = s.drOff || {})[drSig(n)] = 1; drVerdict(s); } saveState(id, me);
        return sendJson(res, 200, { ok: true }), true;
      }
      if (sub === 'revert' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        const r = revertChange(id, String(body.cid || ''), me, canManage(meta, me));
        return sendJson(res, r.code, r.code === 200 ? { ok: true, rev: stateOf(id).rev } : { error: r.error }), true;
      }
      if (sub === 'comments' && req.method === 'POST') {
        const body = await core.jsonBody(req, res); if (!body) return true;
        const text = String(body.text || '').trim().slice(0, MAX_COMMENT);
        const cid = String(body.cid || '');
        if (!text) return sendJson(res, 400, { error: '코멘트 내용이 없습니다' }), true;
        if (!changesOf(id).some((c) => c.cid === cid)) return sendJson(res, 404, { error: '그런 변경이 없습니다' }), true;
        const s = stateOf(id);
        const who2 = actorOf(meta, me, body); if (who2.error) return sendJson(res, 403, { error: who2.error }), true;
        const c = { id: `m${++s.seq}`, cid, by: who2.by, at: Date.now(), text, ...(who2.via ? { via: who2.via } : {}) };
        s.comments.push(c); saveState(id, who2.by);
        return sendJson(res, 200, { ok: true, comment: c, rev: s.rev }), true;
      }
      const cm = /^comments\/(m\d+)$/.exec(sub);
      if (cm && req.method === 'DELETE') {
        const s = stateOf(id); const c = s.comments.find((x) => x.id === cm[1]);
        if (!c) return sendJson(res, 404, { error: '그런 코멘트가 없습니다' }), true;
        if (c.by !== me && c.via !== me && !isAdmin(me)) return sendJson(res, 403, { error: '자기 코멘트만 지울 수 있습니다' }), true;
        s.comments = s.comments.filter((x) => x !== c); saveState(id, me);
        return sendJson(res, 200, { ok: true, rev: s.rev }), true;
      }
      return sendJson(res, 404, { error: 'not found' }), true;
    } catch (e) {
      console.error('[nrf]', e);
      return sendJson(res, 500, { error: e.message }), true;
    }
  }

  return { guard, extraApi, setBroadcast: (fn) => { appBroadcast = fn; }, mirror, _test: { delPara, tableOp, effTable, gridOf, editPara, addPara, revertChange, changesOf, finalTextOf, finalHwpx, stateOf, loadDoc, orderOf } };
}
module.exports = { createNrfApi };
