# Docs ANA

한/글(HWP · HWPX) · Word 문서를 여러 사람이 함께 고치고 검토하는 ANA(Agent-Native Agent)입니다. [agent-native-agent](https://github.com/tykimos/agent-native-agent) 위에 문서 화면(`nrf.html`, `nrf-api.js`, `lib/`)과 스킬(`skills/`)을 더했습니다.

## 하는 일
- 문서를 올리고 문서 안에서 바로 고치기 — 고친 곳은 사람마다 색으로 표시(변경 추적), 최종본 보기
- 메모 · 댓글 · 해결, 링크 · 암호 공유(보기 전용 · 편집 · 관리 권한)
- 표현점검(AI 작성 신호) · 문서검토 · 출처확인(참고 문서 대조) — 규칙 + 에이전트 판단
- 생성스킬: 표 기반 다이어그램(한/글 표) · 이미지 기반 순서도 · 흐름도 · 개념도(목표모델) · 목차 · 메모 전환
- 내보내기: PDF · 한/글(HWPX) · Word(DOCX) · PowerPoint(PPTX) — Word · PowerPoint 는 PDF 와 같은 쪽 · 같은 자리(글 고칠 수 있음)

## 바로 띄우기(브라우저)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Agent-Native-Agent/docs-ana?ref=main)

Codespace 가 만들어지면 Ports → **Docs ANA (8809)** → Open in Browser. 포트는 Private 로 두세요 — 로그인 화면 없이 Codespace 주인(관리자)으로 바로 들어갑니다(포트를 Public 으로 바꾸면 누구나 주인으로 들어오니 바꾸지 마세요). 조직 저장소라 조직이 Codespaces 를 허용해야 만들 수 있습니다(조직 설정 → Codespaces).

## 실행(내 서버)
```bash
npm install          # 의존성은 최소(기본 ANA 와 같음)
PORT=8865 node server.js
```
필요한 것: Node 18+, Chromium(PDF · 쪽 고정 내보내기), LibreOffice Writer(Word 비교 · 변환), poppler-utils(pdfinfo · pdftotext · pdftoppm). PowerPoint 를 다시 PDF 로 바꿔 비교하려면 LibreOffice Impress 도 있어야 합니다.

## 환경 변수
| 이름 | 뜻 |
|---|---|
| `PORT` | 서버 포트(기본 8865) |
| `ANA_DATA_DIR` | 문서 · 상태 저장 폴더(기본 `~/.local/share/ana/docs-ana`) — 저장소에는 넣지 않습니다 |
| `ANA_IDENTITY_HEADER` | 로그인 게이트웨이가 사용자 이메일을 넘기는 헤더 이름 |
| `NRF_ADMINS` | 관리자 이메일(쉼표로 여럿). 비우면 관리자 없음 |
| `NRF_LOCAL_USER` | 로그인 게이트웨이 없이 혼자 쓰는 자리에서 들어온 사람(이메일 꼴, 관리자). Codespace 안에서는 정하지 않아도 `<GitHub 아이디>@codespace` 로 잡힌다 — Codespace 포트는 Private 라 주인만 들어온다 |

## 이 저장소에 넣지 않은 것
개인정보 · 계정 · 키 · 서버 설정, 올린 문서와 그 내용(문서 · 상태 · 메모 · 참고 파일), 대화 기록(`.ana/`), 특정 문서에만 쓴 작업 스크립트. 예시 그림과 예시 spec 은 공개해도 되는 일반 내용(민원 · 도서 대출 · 온라인 주문 · 도시 데이터 등)으로만 만들었습니다.

## 라이선스
기본 ANA 와 같습니다(`LICENSE`, `COMMERCIAL.md`). `lib/aitell/` 의 탐지 사전은 MIT(`lib/aitell/NOTICE.md`).
