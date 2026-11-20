---
name: concept-map-diagram
description: 개념도 생성 스킬. 공공 정보화 문서의 「목표모델 · 구성도」 결로 사업 전체를 한 장에 그린다 — 남색 제목 띠 패널 · 모듈 카드와 기능 칸 · 왼쪽 제공/오른쪽 사용자 열 · 연계 막대 · 데이터베이스 · 인프라 층 · 굵은 화살표 · 선 아이콘. "개념도", "목표모델", "구성도", "시스템 구성", "아키텍처" 요청에 쓴다.
---

# 이미지 기반 개념도 생성 스킬

spec 에 `"layout": "board"`를 주고 그린다(아래 「v2.0 — 목표모델형」). 시스템 안 모듈 사이의 흐름만 그릴 때는 「이미지 기반 흐름도 생성 스킬」(skills/module-flow-diagram — 예전 이 스킬의 흐름형)을 쓴다. 렌더러 `scripts/render.mjs`는 두 모양을 다 그린다(layout 없으면 흐름형).

## v2.0 — 목표모델형(layout: "board") · 기본

공공 정보화 사업 문서의 「목표 모델 / 구성도」 결로 그린다(2026-11-20 주인 지시: 참고 이미지와 같은 룩앤필). 예전 흐름형(core · modules · actors · externals)은 그대로 쓸 수 있고, `layout`이 `"board"`일 때 이 모양이 된다.

```
┌데이터 제공┐ ┃연┃ ┌■ 직원용 서비스  행정망 · 검색 ─────────────┐ ┌이용자┐
│ 부서 시스템 │ ┃계┃▶│ [데이터 검색] [데이터 목록] [분석 지원] … │▶│ (사람) │
│ [메타 데이터]│ ┃ ┃ │   ▭ 통합 검색   ▭ 메타 관리   ▭ 분석 요청   │ │  직원  │
│ [원천 데이터]│ ┃수┃▶├■ 시민용 서비스 ──────────────────────────┤▶│ (사람) │
│ 공공기관 …  │ ┃집┃ │ [데이터 개방] [시각화] [참여·소통]        │ │  시민  │
└───────┘ ┗━┛ ├■ 데이터베이스 │ ⛁ 원천  ⛁ 정제  ⛁ 메타 ───┤ └────┘
                      └■ 인프라      │ (클라우드) (저장) (보안) ─┘
```

- **아이콘**: `icon`(패널 · 모듈 · 옆 열 위 · 인프라 칸) · `iconInline`(옆 열 이름 앞, 높이를 늘리지 않음). 이름: person · people · building · server · db · monitor · doc · pen · check · chart · search · shield · lock · cloud · gear · plug · ai · flask · network · mobile · refresh · flow · car · dna · flame · pill · mic · scale · box.
- **left / right**: `{ title, items: [{ title, lines, chips: ["메타 데이터", {"t":"문서·지식", "tone":"g"}], icon: "person" }] }` — 남색 머리 열. chips 파랑(기본) · 회색(tone g, 또는 '원천·원본').
- **bridgeLeft / bridgeRight**: 세로 연계 막대의 글(예: 「연계 · 통합 수집」).
- **panels**: 위에서 아래로 줄. 한 줄에 여러 패널이면 배열로(`share`로 폭 비율). 패널 = `{ title, sub, modules: [{ title, items: [...], hl }], cols, fromLeft, toRight, tone: "alt" }` — 남색 제목 띠, 모듈은 옅은 파랑 머리 + 흰 기능 칸. `hl`은 옅은 황토 강조(한 곳만).
- **links**: 패널 사이 세로 굵은 화살표 `{ from: 패널 번호, to: 패널 번호, label, dx }`.
- **layers**: 아래 층 `{ title, kind: "db" | "tags", items: [...] }` — DB는 원통, tags는 둥근 칸. `colsToBottom: true`면 옆 열이 층까지 내려온다.
- **절제** — 남색 계열 하나 + 강조 1곳 + 황토 화살표. 그림자 · 그라데이션 · 사진 아이콘 · 이모지 없음. 상세(모듈 · 기능 칸)는 줄이지 않는다.
- **문서에 넣기** — 폭 1180px 그림을 2배로 찍어 문서 폭에 넣는다. `check.mjs --scale 1.1`로 칸 넘침을 먼저 본다.

예시: `skills/doc-generate/examples/city-data-board.json`(도시 데이터 통합 플랫폼 목표모델).
