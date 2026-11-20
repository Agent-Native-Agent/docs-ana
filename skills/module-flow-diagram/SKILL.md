---
name: module-flow-diagram
description: 모듈 흐름도 생성 스킬. 한 시스템을 가운데 두고, 안의 처리 단계(모듈)가 위에서 아래로 이어지는 흐름과 그 단계를 쓰는 사람(왼쪽) · 주고받는 바깥 시스템(오른쪽)을 화살표로 한 장에 그린다. "모듈 흐름", "처리 단계", "시스템 안 흐름" 요청에 쓴다. (예전 이름: 개념도 생성의 흐름형)
---
> 2026-11-20 주인 지시로 「개념도 생성」(지금의 이미지 기반 개념도 생성 스킬)에서 떼어 낸 스킬이다. 렌더러는 `skills/concept-map-diagram/scripts/render.mjs`(layout 없이 = 흐름형)를 함께 쓴다 — 아래 `scripts/…`는 그 폴더를 가리킨다. 사업 전체 구성(목표모델)은 「이미지 기반 개념도 생성 스킬」(concept-map-diagram)을 쓴다.

# 이미지 기반 흐름도 생성 스킬

AgentTA 홈의 **개념도**를 만든 방식을 그대로 묶은 스킬이다. 예시 `skills/doc-generate/examples/online-order-concept.json`을 그리면 AgentTA 홈의 개념도와 같은 그림이 나온다.

## 그림의 모양

```
 [사람 A] ──라벨──▶ ┌──── 시스템 ────┐                 
                   │ ① 단계          │ ──보냄──▶ [바깥 시스템 X]
 [사람 B] ──라벨──▶ │ ② 단계          │ ◀──받음── 
                   │ ③ 단계 …        │
 [사람 C] ◀─검토─▶ │ ⑥ 단계          │ ──보냄──▶ [바깥 시스템 Y]
                   │ (지키는 원칙 한 줄)│ ◀──받음──
                   └────────────────┘
```

- **가운데**: 시스템 이름·한 줄 설명, 안쪽 단계 3~7개(위에서 아래로 화살표), 맨 아래 원칙 한 줄(선택).
- **왼쪽**: 사람(역할). 상자는 그 사람이 실제로 닿는 단계의 **행 높이**에 놓는다. 여러 단계에 닿으면 상자가 그 행들을 덮는다.
- **오른쪽**: 바깥 시스템(점선 상자). 주고받는 단계와 **같은 높이**. 위 화살표 = 보내는 것, 아래 화살표 = 돌아오는 것.
- **휴대폰(640px 이하)**: 사람들을 맨 위 상자 하나로 모으고, 바깥 시스템은 오른쪽 좁은 상자에 '→ 보냄 / ← 받음' 두 줄로 바꾼 세로 그림을 보인다.

## 순서

1. **사실 모으기** — 추측해서 그리지 않는다. 코드·PRD·문서에서 단계, 역할, 바깥 연결을 확인한다. 모자란 것은 `prompts/01-interview.md`의 질문으로 묻는다.
2. **spec 쓰기** — `templates/spec.template.json`을 복사해 채운다. LLM에게 맡길 때는 `prompts/02-spec-writer.md`를 지침으로 쓴다.
3. **검사** — `node scripts/check.mjs my.json`
   - 오류(없는 행, 겹치는 상자, 상자 밖을 가리키는 화살표)는 고칠 때까지 다음으로 가지 않는다.
   - 경고(글자 넘침 어림)는 줄이거나 `tall` 줄바꿈을 직접 준다.
4. **그리기** — `node scripts/render.mjs my.json --out out/` → `out/<id>.html`, `-wide.svg`, `-tall.svg`
5. **눈으로 보기** — `node scripts/snapshot.mjs out/<id>.html` (Playwright 필요)
   - PC·휴대폰 × 밝은·어두운 화면 PNG 4장을 찍는다.
   - 가로 넘침과 그림 밖 글자도 함께 알려 준다.
   - `prompts/03-review.md` 체크리스트로 본다.
6. **넣기** — 앱에는 두 가지 방법이 있다.
   - (a) `render.mjs`를 import해 `conceptWide(spec) + conceptTall(spec)`을 HTML에 넣는다.
   - (b) 만든 SVG 두 개를 붙이고 `templates/theme.css`의 `.dg*` 규칙을 앱 CSS에 옮긴다. 앱에 색 토큰이 있으면 `:root` 블록 대신 앱 토큰을 쓴다.

## 지킬 것(AgentTA에서 겪고 정한 것)

- **좌표는 격자 상수에서만 계산**한다(행 시작·행 간격·열 위치). 상자·화살표·라벨이 같은 기준선을 써서 어긋나지 않는다. 손으로 x, y를 박지 않는다.
- **화살표는 상자 변의 가운데**에 닿는다. 사람·바깥 시스템은 닿는 단계의 행 가운데에 맞춘다.
- **그림마다 marker ID가 달라야** 한다. 렌더러는 `<id>-wide-head`, `<id>-tall-head`를 쓴다. 같은 ID를 쓰면 숨겨진 그림(display:none)의 marker를 참조해 화살촉이 사라진다. 한 페이지에 개념도를 둘 넣으면 spec `id`를 다르게 준다.
- **색은 클래스와 토큰으로만** 준다. 밝은·어두운 화면은 토큰만 바꿔 맞춘다. 화살표 라벨은 바탕색 테두리(halo)를 둘러 선 위에서도 읽힌다.
- **넓은 그림과 세로 그림을 둘 다** 낸다. 390px 폭에서 넓은 그림을 줄이면 글자가 6px 아래로 작아져 못 읽는다.
- **aria-label**에 그림 전체를 한 문장으로 쓴다(spec `aria`). 비우면 단계·사람·바깥 시스템으로 자동으로 만든다.
- **말은 짧고 쉽게** 쓴다. 단계 제목은 2~8자에 번호(①…)를 붙이고, 설명은 ' · '로 이은 한 줄로 쓴다. 화살표 라벨은 동사구 2~6자(작성·가져오기, 연결 설정)로 쓴다.
- 실제 사람 이름·계정·키·내부 주소는 그림에 넣지 않는다. 역할 이름만 쓴다.

## 파일

| 파일 | 내용 |
|---|---|
| `scripts/render.mjs` | spec → 넓은·세로 SVG, HTML 페이지, 단독 SVG 파일(스타일 포함). 의존성 없음 |
| `scripts/check.mjs` | spec 검사: 참조·겹침·화살표 범위·글자 폭 어림 |
| `scripts/snapshot.mjs` | PC·휴대폰 × 밝은·어두운 PNG와 넘침 검사(Playwright) |
| `templates/spec.template.json` | 빈 spec(필드 설명 포함) |
| `templates/theme.css` | 색 토큰(밝은·어두운)과 `.dg*` 그림 규칙 |
| `templates/page.html` | 그림을 담는 단독 페이지 틀 |
| `prompts/01-interview.md` | 사용자에게 물을 것 |
| `prompts/02-spec-writer.md` | 설명·코드 → spec JSON을 쓰게 하는 지침(LLM용) |
| `prompts/03-review.md` | 그린 뒤 확인할 것 |
| `skills/doc-generate/examples/online-order-concept.*` | 온라인 주문 시스템 흐름도 spec과 결과 |

## spec 요약

```jsonc
{
  "id": "my-system",                 // marker ID 접두사 — 한 페이지에서 겹치지 않게
  "title": "개념도", "desc": "한 줄 부제", "aria": "(선택) 그림 전체 설명",
  "core": { "name": "시스템", "sub": "한 줄 설명", "note": "맨 아래 원칙 한 줄(선택)" },
  "modules": [ { "title": "① 단계", "sub": "설명 · 설명", "tall": ["세로판 1줄", "2줄"] } ],
  "actors": [ { "title": "역할", "lines": ["하는 일"], "rows": [0, 1],
                "links": [ { "row": 0, "label": "보냄" }, { "row": 1, "label": "검토", "back": "보고서" } ] } ],
  "externals": [ { "row": 2, "title": "바깥 시스템", "lines": ["2줄까지"], "out": "보내는 것", "back": "받는 것",
                   "tall": { "sub": "짧게", "out": "→ 짧게", "back": "← 짧게" } } ],
  "tall": { "header": { "title": "사용하는 사람", "sub": "역할 · 역할", "label": "등록 · 실행" }, "coreSub": "…", "note": ["1줄", "2줄"] },
  "chain": true,                      // 단계 사이 화살표(기본 켬)
  "layout": { "wide": { … }, "tall": { … } }   // (드물게) 크기 바꾸기 — render.mjs LAYOUT 참고
}
```

- `links[].dir`: `out`(사람 → 단계, 기본), `in`(단계 → 사람), `both`(`back`이 있으면 자동)
- `externals`는 한 행 이상 떨어뜨린다(상자 높이 80 > 행 간격 76).
