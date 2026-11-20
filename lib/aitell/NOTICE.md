# 출처와 라이선스

이 폴더(`aitell/`)의 탐지 기능은 **im-not-ai** 를 벤치마킹했다.

- 저장소: https://github.com/epoko77-ai/im-not-ai (확인한 커밋 `e39287c`, 2026-11-16)
- 라이선스: **MIT** — Copyright (c) 2026 epoko77-ai. 사본은 `third_party/im-not-ai/LICENSE`.
  MIT는 복제·수정·재배포·상용 이용을 허용하며, 조건은 저작권 표기와 라이선스 사본을 함께 두는 것이다.
- 이 ANA 자체는 AGPL-3.0이다. MIT 저작물을 AGPL 저작물 안에 포함하는 것은 허용된다(표기 유지).

## 그대로 가져온 것 (`third_party/im-not-ai/`, 수정 없음)

| 파일 | 원래 위치 | 쓰임 |
|---|---|---|
| `lexicon.json` | `skills/humanize-korean/references/lexicon.json` (v1.3) | 어색한 낱말 115개의 탐지식·제외 조건·장르 조건·예문. `detect.js`가 읽는다. |
| `diagnosis-rules.md` | `skills/humanize-korean/references/diagnosis-rules.md` | 85개 유형의 번호·이름·심각도·시그니처. 읽어서 판단하는 2차 단계(`skills/ai-tell-detect`)가 참조한다. |
| `LICENSE` | `LICENSE` | MIT 사본 |

## 따르되 새로 쓴 것

- 유형 번호(A-1 … J-4, DS-*), 이름, 심각도(S1/S2/S3), 반복 임계, 실측 수치 인용, 오탐 방지 원칙은 im-not-ai의
  `ai-tell-taxonomy.md`·`humanize-scan/SKILL.md`·`empirical-validation.md`를 따랐다.
- `rules.js`의 정규식, `detect.js`의 판정·위치 계산 코드는 이 ANA에서 새로 썼다(원본은 Python·LLM 프롬프트이고 위치를 내지 않는다).
- `BOT-1`(챗봇 응답 흔적), 길이에 따른 임계 보정, "뚜렷/참고" 구분, "낮음/보통/높음" 수준은 이 ANA가 덧붙였다. 벤치마크의 실측으로 검증된 값이 아니다.

## 가져오지 않은 것

고쳐 쓰기(윤문) 파이프라인 — 처방, 윤문 프롬프트, 검증 게이트, 복원 스크립트. 이 ANA의 범위는 탐지다.
