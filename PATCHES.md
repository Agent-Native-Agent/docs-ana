# 원본 ANA 패치 (ANA 0.22.0 위)
2026-11-11: 한/글(HWP·HWPX) 문서 공동 수정 기능을 얹었다.
- 추가 파일: `nrf-api.js`(API) · `nrf.html`(화면) · `lib/`(hwp-ana 에서 복사한 파서 cfb·hwp5·hwpx·model·xml·zip + 새로 쓴 track·zipw·hwpx-edit) · `samples/`
- `lib/hwpx.js` 는 복사본에 두 줄을 더했다: 문단에 `xi`(구역 XML 의 hp:p 순서 번호)와 `runIds`.
- server.js 4곳(원본 `server.js.orig-0.22.0`): require nrf-api · SERVABLE 에 nrf.html · extraApi 앞에 nrf.extraApi · nrf.setBroadcast(app.broadcast)
- dashboard.html 2곳: `#workArea` 안에 nrf.html iframe · `</style>` 앞 `.nrf-*` 스타일
- work-ontology.js: `Doc`(list `docs`) 종류와 `UPLOADED_ON` 관계
- ANA 를 업데이트하면 위 자리만 다시 넣는다. channel-core.js 는 건드리지 않았다.
- 2026-11-12 셸: dashboard.html 끝의 `nrf 셸` 스크립트 + `#nrfMenu` + `body.nrf-shell` CSS — 문서 화면이 메인, ANA 탭은 로고 ☰ 메뉴. setMode() 에 한 줄(칩 모드를 iframe 에 알림), selectTab() 에 한 줄(`on-work`). 관리자는 nrf-api 의 NRF_ADMINS(기본 (관리자 이메일)).
- 2026-11-12 공유: 문서마다 members(등록된 작성자)·requests(등록 요청). 공유 주소 `/?doc=<id>` — nrf.html 이 바깥 주소창(parent)의 ?doc 을 읽고 고친다. ☰ 표시 없앰, Chip·프로필은 ANA 기본 스타일 복제.
- 2026-11-15 참고 폴더: 문서마다 refs.json + refs/ (nrf-api.js /refs 라우트, nrf.html #refBtn·#refPop). 파일 20MB·문서당 200MB·디스크 여유 150MB 미만이면 거절.
- 2026-11-15 표: 행 추가·칸 병합(state.tables[표키].ops, nrf-api.js effTable/tableOp, lib/hwpx-edit.js mapTables/rewriteTable, lib/hwpx.js 표 번호 xt, nrf.html tableEl/#cellBar). 참고 파일 from/note. nrf/names.json(로그인 전 작성자 이름).
- 2026-11-15 암호 입장: nrf-api.js 손님 토큰(HMAC, nrf/secret)·guard()·/api/nrf/stream. **server.js 1곳 추가**: app.server 의 request 리스너 앞에 nrf.guard 를 끼운다(로그인 안 한 사람·손님은 /nrf.html·/api/nrf/ 만). nrf.html 은 이제 /api/stream 이 아니라 /api/nrf/stream 을 듣는다.
- 2026-11-15 대신 입력(as)·사람별 이름/색(nrf/names.json·colors.json)·카드 접기·작성자 접속 표시(meta.seen).
- 2026-11-15 게이트웨이(~/Projects/auth/agent-native-agent, 사용자 승인): gw-multi.js 에 경로표 public 지원(로그인 없는 요청을 그 경로만 통과), gw-routes.json nrf 에 public=[/nrf.html, /ana-logo.png, /api/nrf/]. 백업 gw-multi.js.bak-nrfpublic-* · gw-routes.json.bak-nrfpublic-*. 되돌리려면 백업을 덮어쓰고 demo-gw 재시작.

## 2026-11-16 — ANA 대화·대시보드는 관리자만 (서버에서 막음)
- `nrf-api.js` `guard()`: 관리자(`NRF_ADMINS`)와 서버 안의 ANA 만 통과. 로그인한 일반 사용자도 손님처럼 `/nrf.html`, `/ana-logo.png`, `/api/nrf/…` 만 쓸 수 있고 `/` 는 `/nrf.html` 로 넘긴다. 그 밖(`/api/chat`, `/api/feed`, `/api/stream`, `/api/prd` …)은 403.
- `nrf.html` `syncAdded()`: 새 문단을 서버 순서(`S.order`) 대로 놓는다(같은 기준 문단 아래 여러 개일 때 화면 순서가 뒤집히던 것).

## 2026-11-16 — 칸 나누기 · 문단(줄) 삭제 · 보기 설정
- `nrf-api.js`: 표 연산 `split`(여러 행에 걸친 칸을 행 경계에서 나눔, `cuts:[{row, paras}]` 로 원래 문단을 조각에 배치; 없으면 행마다) — `effTable`/`tableOp`/`rowOpOf`/`orderOf`/`changesOf`/`revertChange`/`finalHwpx`. 문단 삭제 `delPara`(`POST …/para {del}`), 상태 `paras[key].gone`, `removed()` 규칙 확장(지운 표시 · 글이 모두 지워진 새 문단도 최종본에서 뺌).
- `lib/hwpx-edit.js`: 새 칸 XML 을 `cellXml` 로 통일(옮겨 온 원래 문단 `{xi}` 는 XML 째로 이동), 원본 행 안의 새 칸 삽입, `remove`(지운 빈 문단) 처리.
- `nrf.html`: 칸 도구 [행마다 나누기], 빈 줄에서 Backspace/Delete → 줄 삭제, "지운 줄" 표시·카드, [보기] 메뉴(폭 맞춤·쪽 맞춤·+/−·100%, 메모 오른쪽/팝업 — localStorage `nrf-view`).

## 2026-11-17 — 서식 편집(굵게·기울임·밑줄·크기·색·정렬)
- `lib/track.js`: 조각에 `f {b,i,u,sz,c: [값, cid]}`; `applyFormat`/`revertFormat`/`formatsOf`/`hasMarks`. 서식이 걸린 자리에 친 글은 그 서식을 이어받는다.
- `nrf-api.js`: `formatOp`(`POST …/format {items:[{key,a,b}], set|clear|align}`), `state.fmt[cid]`, 문단 정렬 `paras[key].pf.align`, 변경 카드(`fmt`), 되돌리기, 최종본 계획(`aligns`, 새 문단·새 칸의 서식).
- `lib/hwpx-edit.js`: `headerEditor`(header.xml 에 글자모양·문단모양을 본떠 덧붙임), `runsXml`, 서식 문단의 run 다시 짜기(글·글자 요소만 있는 문단), 정렬 반영.
- `nrf.html`: 문서 위 서식 막대(`#fmtBar`), Ctrl+B/I/U, 서식 표시(`.fm`)와 "서식" 카드.

## 2026-11-19 — 대화 기록 읽기: 오류에도 멈추지 않음 · 감시 · 로딩 카드 상세 로그 (ANA 기본 파일 수정)
- `agent-log.js` `loadInBackground`/`runLoad`/`watchLoad`: 긴 기록을 나눠 읽다 오류가 나면 멈추지 않고 기록(`loading.errors/err/log`)한 뒤 2초 뒤 다시 읽는다. 12초 동안 진척이 없으면 `read()` 가 읽기를 다시 시작한다(`gen` 으로 겹친 루프 방지). `read()` 의 `loading` 에 `errors · err · log(최근 12줄)` 를 싣는다.
- `dashboard.html`: 로딩 카드(`#swLoad`)를 채팅 맨 위에 고정(`position: sticky`), 단계마다 한 줄씩 상세 로그(`swLog` — 단계 시작/완료/실패, 서버 읽기 기록, 읽기 실패·재시작). 읽기 감시: 15초(불러오는 중이면 12초) 동안 성공한 읽기가 없으면 멈춘 요청을 버리고 다시 읽는다. 기록 요청에 10초 시한.
- ANA 를 업데이트하면 이 두 파일의 위 자리를 다시 넣는다(백업은 이 작업 세션 스크래치패드).
- 2026-11-19 셸 메뉴: dashboard.html 의 nrf 셸 ITEMS 에 ['work:gen', '생성스킬'] 한 줄, sub 매핑에 'work:gen' → 'gen'(nrf.html 의 setWorkView('gen') 이 생성스킬 화면을 연다).
