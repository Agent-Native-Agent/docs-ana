# 문서 검토 (doc-review)

한국어 문서에서 **AI가 쓴 것 같은 신호**와 어색한 패턴을 문단 · 문장 · 단어 · 조판 네 갈래로 찾아 줍니다.
AI Workplace의 "문서 검토" 기능을 다른 서비스에 넣을 수 있게 떼어 낸 패키지입니다. 서비스와 같은 문서를 넣으면 규칙 점검 결과가 똑같이 나옵니다.

> 결과는 **판정이 아니라 신호**입니다. 사람이 쓴 글에도 같은 패턴이 나오고, 신호가 적다고 사람이 썼다는 뜻도 아닙니다.
> 화면과 보고서에 이 문구를 꼭 남겨 주세요.

## 들어 있는 것

| 파일 | 하는 일 |
|---|---|
| `index.js` | 진입점: `reviewFile` · `reviewText` · `writeReport` |
| `lib/rules.js` | 규칙 점검(코드가 셈, 모델 호출 없음)과 종합 판단 `verdictOf` |
| `lib/ai.js` | AI 검토: 모델 프롬프트 전문, 인용 확인 |
| `lib/llm.js` | OpenAI 호환 Chat Completions 호출(환경변수로 설정) |
| `lib/read.js` | 문서 → 글(kordoc), 표 모양 마크다운, 글자 그대로(rawtext.py) |
| `lib/rawtext.py` | HWPX · DOCX · PPTX · PDF에 글자로 적힌 그대로 꺼내기(서식 없이) |
| `lib/hwpx.js` | 검토 결과 → HWPX 보고서(kordoc) |
| `server.js` | 예시 HTTP 서버(의존 패키지 없음) |
| `web/` | 결과 화면: `review-view.js` + `review-view.css`(프레임워크 없음), `index.html`(올리기 → 진행 → 결과) |
| `cli.js` | 명령줄 실행 |
| `test.js` | 모델 없이 도는 시험 7개 |
| `examples/` | 시험용 예시 문서 2개(가상 내용) |

## 필요한 것

- Node.js 20 이상, `npm install`(kordoc 4.24.20 하나)
- python3(표준 라이브러리만 씀)
- 있으면 좋은 것: `pdftotext`(poppler-utils). kordoc이 PDF를 못 읽을 때 대신 읽습니다.
- AI 검토를 하려면 OpenAI 호환 모델 하나. 없으면 `ai: false`로 규칙 점검만 할 수 있습니다.

```bash
npm install        # 네트워크가 막힌 곳이면 ONNXRUNTIME_NODE_INSTALL=skip npm install
npm test
node cli.js examples/"AI 문체 예시.hwpx" --no-ai
node cli.js 문서.hwpx --json 결과.json --hwpx 보고서.hwpx
PORT=8790 node server.js   # http://127.0.0.1:8790
```

## 모델 설정(AI 검토)

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `REVIEW_LLM_URL` | `http://127.0.0.1:8096/v1` | `/chat/completions`를 붙여 부릅니다 |
| `REVIEW_LLM_MODEL` | `gpt-chat-latest` | Azure는 배포 이름 |
| `REVIEW_LLM_KEY` | (없음) | 없으면 키 없이 부릅니다(키를 붙여 주는 중계용) |
| `REVIEW_LLM_KEY_HEADER` | `authorization` | Azure 키를 바로 쓰면 `api-key` |
| `REVIEW_LLM_QUERY` | (없음) | 예: `api-version=2024-10-21` |

Azure OpenAI에 바로 붙이는 예:
```bash
REVIEW_LLM_URL=https://<리소스>.openai.azure.com/openai/deployments/<배포>  \
REVIEW_LLM_QUERY=api-version=2024-10-21 REVIEW_LLM_KEY_HEADER=api-key REVIEW_LLM_KEY=... node server.js
```
키는 환경변수로만 넘기고 코드 · 로그에 넣지 마세요. 다른 SDK를 쓰면 `chat` 함수를 직접 넘기면 됩니다(아래).

## 코드에서 쓰기

```js
const { reviewFile, reviewText, writeReport } = require('./doc-review');

const d = await reviewFile('/path/문서.hwpx', {
  name: '문서',            // 화면 · 보고서에 쓸 이름(기본: 파일 이름)
  ai: true,                // false면 규칙 점검만(같은 문서는 늘 같은 결과)
  chat,                    // (선택) async (messages, {json, maxTokens, signal}) => json ? 객체 : 문자열
  system,                  // (선택) 시스템 프롬프트 앞머리. 기관 이름 등을 넣을 때
  signal,                  // (선택) AbortSignal
  onProgress: (step, msg) => {},   // 0 문서 읽기 · 1 규칙 점검 · 2 AI 검토 · 3 정리
});
await writeReport(d, '/path/보고서.hwpx', { org: '작성 부서' });

const t = await reviewText(markdownText, { format: 'md' });   // 'txt'면 글자에 남은 ** 도 흔적으로 봅니다
```

검토 대상: HWP · HWPX · PDF · DOCX · PPTX · TXT · MD. 문단은 앞 600개까지 봅니다.

## 결과 객체

```js
{
  file: { name, ext },
  verdict: { level: '높음'|'보통'|'낮음', score, summary, by: {문단, 문장, 단어, 조판}, kinds, strong, direct },
  findings: [{ id, src: '규칙'|'AI', rule, level: '문단'|'문장'|'단어'|'조판', pattern, why, fix, count,
               ev: '직접'|'강함'|'보통'|'약함', weight, spots: [{ p: 문단번호, quote: '문서에 있는 문구' }] }],
  metrics: [{ key, label, value, note?, flag }],    // 세어 본 값(문장 길이 들쭉날쭉한 정도 등)
  paras: [{ i, page, text, heading }],             // 화면에서 본문 표시 · 찾은 곳 강조에 씀
  stats: { chars, paras, sents },
  notes: ['AI 검토가 남긴 인상 한 문장'],
  aiFailed?: '모델 오류 메시지', aiSkipped?: true, truncated, layoutRead, rawRead
}
```

## 판단 방법

1. **문서 읽기**: kordoc으로 글을 읽고 줄 단위 문단으로 나눕니다. 표 · 그림 줄은 뺍니다. 표 모양을 지킨 마크다운을 한 번 더 읽고(굵은 글씨 · 목록), `rawtext.py`로 글자 그대로를 읽습니다(글자로 남은 `**` · `##`).
2. **규칙 점검**(`lib/rules.js`, 모델 없음)
   - 단어 · 구 37가지(`WORD_RULES`): 대화형 AI 말투, 빈 자리표시, 번역투, 상투구, 은유, 정도 부사 등. 긴 문서는 횟수가 아니라 **1,000자당 빈도**(`DENSITY`)로 봅니다.
   - 문장: 길이가 고른지(들쭉날쭉한 정도 0.34 미만), 같은 종결어미 5번 연속, 연결어미 뒤 쉼표, "A가 아니라 B" 대구, 셋씩 묶은 나열, 접속어로 시작하는 문장 비율.
   - 문단: 길이가 고른지, 당위 · 전망으로 맺는 문단, 3~4문장 문단 비율, "먼저 – 또한 – 마지막으로" 틀, 끝부분의 "향후 · 앞으로".
   - 조판: 글자로 남은 마크다운 기호, 이모지, 줄표, "주제: 부제" 제목, 따옴표 강조, "굵은 머리말: 설명" 목록, 줄 수가 같은 목록.
   - **개조식 문서**(□ · ㅇ · - 로 시작하거나 "~함 · ~임"으로 끝나는 줄이 35% 이상)는 문장 길이 · 홑문장 점검을 하지 않습니다.
   - 근거 세기: 직접(붙여 넣은 흔적) 6 · 강함 3 · 보통 1.5 · 약함 0.6.
3. **AI 검토**(`lib/ai.js`): 9,000자씩 최대 4부분을 모델에 보내 규칙으로 못 잡는 것(뜬 문장, 내용 없는 일반론, 문단 사이 반복 등)을 짚게 합니다. 모델이 옮긴 인용이 **문서에 실제로 있을 때만** 받습니다. 최대 40개. 맞춤법 · 오타 · 개조식 · 법령 문체는 짚지 않게 지시합니다. 프롬프트 전문은 `lib/ai.js`의 `REVIEWER`입니다.
4. **종합**(`verdictOf`): 지표 하나만으로는 올리지 않습니다.
   - 직접 증거(대화 말투 · 글자로 남은 기호 · 빈 자리표시)가 있으면 **높음**
   - 밀도 9 이상, 강함 신호 2가지 이상, 서로 다른 신호 5가지 이상, 3갈래 이상이면 **높음**
   - 밀도 4 이상, 서로 다른 신호 3가지 이상, 2갈래 이상이면 **보통**
   - 그 밖은 **낮음**. AI 검토가 짚은 것은 많아도 두 가지로만 칩니다.

## 서비스에 넣을 때

- **화면**: `web/review-view.js` · `review-view.css`를 넣고 `DocReviewView.render(요소, 결과, { reportUrl })`를 부릅니다. 색은 `.rvwrap`의 CSS 변수만 바꾸면 됩니다. 900px 아래에서는 한 줄로 쌓입니다.
- **API**: `server.js`의 세 경로(올리기 → 상태 조회 → 보고서)를 그 서비스 라우터로 옮깁니다. 예시 서버는 인증이 없고 결과를 메모리에 1시간만 둡니다. 로그인 · 사용자 구분 · 저장은 그 서비스 방식에 맞춰 붙여 주세요.
- **문서가 모델로 갑니다**: AI 검토를 켜면 문서 글이 설정한 모델로 전송됩니다. 비공개 문서는 `ai: false`로 돌리거나 내부 모델만 쓰세요.
- **시스템 프롬프트**: 원래 서비스는 기관 이름이 든 한 줄을 앞에 붙였습니다. 기본값은 기관 이름 없는 문장입니다. `system` 옵션으로 바꿀 수 있습니다.

## 출처

규칙의 분류(번역투 · 관용구 · 구조 · 리듬 · 완곡 · 접속사 · 시각 장식)와 일부 항목 번호(A-15, D-5 등)는 공개 자료
[epoko77-ai/im-not-ai](https://github.com/epoko77-ai/im-not-ai)(MIT License)를 참고해 이 서비스에 맞게 다시 썼습니다. 코드를 그대로 옮긴 것은 아닙니다.
