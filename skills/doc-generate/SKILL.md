---
name: doc-generate
description: Docs 문서(HWPX) 안에 표 · 다이어그램(단계 흐름 · 판단 흐름 · 체계도) · 그림 · 목차를 한/글에서 고칠 수 있는 형태로 만드는 방법. 사람이 「생성스킬」 화면에서 고른 스킬(이름은 「표 기반 ○○ 생성 스킬」 · 「이미지 기반 ○○ 생성 스킬」 · 「문서 목차 생성 스킬」 꼴)이나 「~를 다이어그램으로/표로/목차로」 요청을 받으면 쓴다.
---
# 생성스킬

스킬 목록과 각 스킬의 순서·규칙은 `skills.json` 한 곳에 있다(화면 Work › 생성스킬 도 이 파일을 읽는다 — 고치면 화면도 바뀐다).

## 공통
- 원본 `~/.local/share/ana/docs-ana/nrf/docs/<문서>/original.hwpx` 를 직접 고친다. 고치기 전에 `scripts/secedit.py` 의 `edit(fn, header_fn, tag)` 를 쓰면 백업(original.before-<tag>.hwpx · state.before-<tag>.json)과 문단 키 재조정이 함께 된다(`DOC=<문서 id>` 환경변수).
- 새 문단은 nrfxi 표시가 없어야 하고, 원래 문단의 nrfxi 를 지우면 그 문단의 수정·메모가 빠진다.
- 고친 뒤 header.xml · section0.xml 을 XML 파서로 검사하고, 서버를 다시 시작해 화면(헤드리스)으로 확인한다.
- 쪽이 바뀌면 `scripts/pg.js` 로 쪽을 세고 `scripts/fillpg.py '<json>'` 로 목차 쪽 번호를 채운다.
- 다이어그램은 `scripts/diagram.py` 의 box · ar · nb · dec · yes · dn 칸으로 스펙을 짜서 만든다(칸 간격 1mm, 연한 바탕).

## 그림(SVG)으로 그리는 스킬
**먼저 표로 할 수 있는지 본다.** 표 다이어그램은 한/글에서 고칠 수 있어 그대로 두는 것이 기본이다(2026-11-20 주인 지시: 「모두 바꾸지 말고, 표로는 품질이 너무 떨어지는 것만」). 그림으로 바꾸는 것은 꺾인 선 · 되돌아가는 흐름 · 관계 수처럼 표로 그릴 수 없을 때뿐이고, 문서 폭에서 그림 속 글자가 8pt 아래로 작아지면 그림으로 넣지 않는다. 표 다이어그램이 엉성하면 먼저 표 안에서 고친다(칸 폭 · 글자 꺾임 · 색).

선이 꺾여 이어지거나 관계 수(1:n)를 적어야 하는 그림은 표로 그릴 수 없다. 이때는 따로 둔 두 스킬을 쓴다 — 각 폴더의 SKILL.md 를 따른다.
- `skills/flowchart-diagram` — 이미지 기반 순서도 생성 스킬(판단 · 되돌아감 · 합류 · 구성도, ER 관계도)
- `skills/concept-map-diagram` — 이미지 기반 개념도 생성 스킬(목표모델형: 패널 · 모듈 카드 · 제공/사용자 열 · 연계 막대 · DB · 인프라 · 선 아이콘)
- `skills/module-flow-diagram` — 이미지 기반 흐름도 생성 스킬(한 시스템 안 단계 흐름 · 역할 · 바깥 시스템 — 예전 개념도의 흐름형)
render.mjs · check.mjs 는 이 서버의 Node 로 바로 돈다. snapshot.mjs(Playwright)는 설치돼 있지 않으니 Docs 헤드리스 화면(cdp)으로 PNG를 찍는다. 문서에는 PNG를 그림으로 넣고 아래에 「[그림 n] 제목」을 단다(한/글에서 글은 고칠 수 없다는 점을 사람에게 알린다).

## 예시 그림
생성스킬 화면의 예시는 `examples/<스킬 ID>.png`. 공개해도 되는 일반 내용(민원 처리 · 도서 대출 · 온라인 주문 등)으로만 그린다 — 특정 기관·사업 문서를 쓰지 않는다.
- HWPX 표 스킬: `examples/make-examples.py` 에 HTML 을 더하고 헤드리스로 찍어 여백을 잘라 PNG 로.
- 순서도·개념도: `examples/*.json` spec 을 render.mjs 로 그린 HTML 을 찍는다.
새 스킬을 skills.json 에 넣을 때 예시 PNG 도 함께 만든다.

## SVG 그림을 문서에 넣을 때
- 문서 폭(170mm)에 맞추면 글자가 작아지니, 찍을 때 `.dg-sub 13.2px · .dg-lbl 13px · .dg-t 15px · .dg-note 13px · .dg-zt 13.5px` 로 키운다(약 1.15배).
- 키운 글자로 넘치지 않는지 `check.mjs spec.json --scale 1.15` 로 먼저 검사한다(시작·끝 둥근 상자는 쓸 폭이 더 좁다).
- 그림이 다음 쪽으로 통째로 넘어가 앞 쪽이 비면 그림 폭을 줄여 맞춘다.
