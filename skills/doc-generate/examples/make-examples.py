# 생성스킬 예시 화면(HWPX 결과 모양)을 HTML로 만든다 — 헤드리스로 찍어 <slug>.png 로 쓴다. 내용은 공개해도 되는 일반 예시.
import os, html
D = os.path.dirname(os.path.abspath(__file__))
N='#1F3864'; LB='#EDF1F9'; LB2='#DCE3F0'; G='#F2F2F2'; Y='#FFF2CC'
CSS = f"""body{{margin:0;background:#fff;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#111}}
.pg{{width:700px;padding:28px 34px;box-sizing:border-box}} .cap{{text-align:center;font-weight:700;font-size:14px;margin:6px 0 8px}}
table.t{{border-collapse:collapse;width:100%;font-size:13px}} table.t td,table.t th{{border:1px solid #333;padding:6px 8px;line-height:1.5}} table.t th{{background:{LB2};font-weight:700}}
table.t td.h{{font-weight:700;text-align:center;background:#fafafa}} .gap td{{border:0;height:8px}}
table.d{{border-collapse:separate;border-spacing:4px;width:100%;font-size:12.5px}} table.d td{{text-align:center;padding:7px 6px;line-height:1.45;border:1px solid #A6B0C3}}
table.d td.nb{{border:0;color:{N};font-weight:700;padding:2px}} .b{{font-weight:700}} .s{{font-size:11.5px}}
.h1{{font-size:17px;font-weight:700;margin:0 0 6px}} .p{{font-size:14px;line-height:1.75;margin:2px 0}} .p.i{{padding-left:18px;text-indent:-18px}}
.toc div{{display:flex;font-size:14px;line-height:2}} .toc .f{{flex:1;border-bottom:1.5px dotted #555;margin:0 4px 9px}} .toc .c{{font-weight:700}} .toc .s1{{padding-left:22px}}
.ttl{{display:inline-block;background:{N};color:#fff;font-weight:700;font-size:19px;padding:3px 14px}} .ttlline{{border-bottom:1px solid #333;margin-bottom:8px}}
.memo{{border-left:3px solid #3182F6;background:#F4F8FF;border-radius:6px;padding:6px 10px;font-size:12.5px;margin:6px 0}}
.pair{{display:flex;gap:16px;align-items:stretch}} .pair>div{{flex:1}} .lab{{font-size:12px;font-weight:700;color:#555;margin-bottom:4px}}
.img{{background:repeating-linear-gradient(45deg,#f3f3f3 0 8px,#ececec 8px 16px);border:1px solid #bbb;border-radius:4px;padding:10px;filter:blur(.3px)}}
.logo{{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#444}} .logo i{{display:inline-block;width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1e3a8a)}}
.logo.r i{{border-radius:5px;background:linear-gradient(135deg,#f59e0b,#ea580c)}} del{{color:#c0392b}} ins{{color:#1b64da;text-decoration:underline}}"""
def cell(t, f=None, cls='', **k):
    st = f'background:{f};' if f else ''
    if k.get('color'): st += f"color:{k['color']};"
    a = ''.join(f' {x}="{v}"' for x, v in (('rowspan', k.get('rs')), ('colspan', k.get('cs'))) if v)
    return f'<td class="{cls}" style="{st}"{a}>{t}</td>'
ar = lambda rs=None: cell('▶', cls='nb', rs=rs)
PAGES = {}
PAGES['hwpx-table'] = f"""<div class="cap">&lt; 표 1 &gt; 사업 단계별 주요 일정</div>
<table class="t"><tr><th style="width:18%">단계</th><th style="width:20%">기간</th><th>주요 내용</th><th style="width:16%">담당</th></tr>
<tr><td class="h">준비</td><td>1월~2월</td><td>- 추진 계획 수립<br>- 예산 확보·사업 공고</td><td>기획팀</td></tr>
<tr><td class="h">구축</td><td>3월~8월</td><td>- 시스템 설계·개발<br>- 시범 운영(2개 기관)</td><td>운영팀</td></tr>
<tr><td class="h">확산</td><td>9월~12월</td><td>- 전 기관 적용<br>- 성과 점검·개선 과제 도출</td><td>기획팀</td></tr>
<tr class="gap"><td colspan="4"></td></tr></table><div class="p s" style="font-size:12px">※ 기간은 사업 여건에 따라 바뀔 수 있음</div>"""
st=[('① 접수','민원 신청서 접수<br>담당 부서 지정','당일'),('② 검토','서류 확인<br>현장 확인(필요 시)','3일 이내'),('③ 처리','처리 방안 결정<br>결재','7일 이내'),('④ 통보','결과 문자·우편 통보<br>만족도 조사','처리 즉시')]
r1=''.join(cell(a,LB2,'b',color=N)+(ar(3) if i<3 else '') for i,(a,b,c) in enumerate(st)); r2=''.join(cell(b,'#fff') for a,b,c in st); r3=''.join(cell(c,G,'s') for a,b,c in st)
PAGES['hwpx-step-flow'] = f'<table class="d"><tr>{r1}</tr><tr>{r2}</tr><tr>{r3}</tr></table><div class="cap">[그림 1] 민원 처리 흐름</div>'
dec=lambda t: cell('◇ '+t,Y,'b'); yes=cell('예 ▶',cls='nb'); dn=lambda: cell('▼ 아니오',cls='nb')+cell('',cls='nb')*4
PAGES['hwpx-decision-flow'] = f"""<table class="d"><tr>{cell('판단',cls='nb')}{cell('',cls='nb')}{cell('결과',cls='nb')}{cell('',cls='nb')}{cell('처리',cls='nb')}</tr>
<tr>{dec('신청 서류가 모두 갖춰졌는가?')}{yes}{cell('서류 심사 진행',LB2,'b')}{ar()}{cell('심사 결과 통보',  '#fff')}</tr><tr>{dn()}</tr>
<tr>{dec('보완 기한 안에 냈는가?')}{yes}{cell('보완 서류 접수',LB2,'b')}{ar()}{cell('서류 심사로 다시',  '#fff')}</tr><tr>{dn()}</tr>
<tr>{cell('신청 반려 · 사유 안내',G,cs=5)}</tr></table><div class="cap">[그림 2] 지원 신청 자격 확인 흐름</div>"""
yrs=['1년차','2년차','3년차']
PAGES['hwpx-matrix'] = f"""<table class="d"><tr>{cell('',cls='nb')}{''.join(cell(y,c,'b',color=N) for y,c in zip(yrs,['#DCE3F0','#C9D5EA','#B7C7E3']))}</tr>
<tr>{cell('서비스',LB2,'b',color=N,rs=2)}{cell('온라인 예약',LB)}{cell('모바일 앱 출시',LB)}{cell('맞춤 추천',LB)}</tr>
<tr>{cell('대면 창구 개선','#fff')}{cell('무인 대출기 확대','#fff',cs=2)}</tr>
<tr>{cell('기반',LB2,'b',color=N)}{cell('데이터 표준 마련',LB)}{cell('통합 DB 구축',LB)}{cell('외부 기관 연계',LB)}</tr>
<tr>{cell('운영',LB2,'b',color=N)}{cell('담당 인력 교육','#fff')}{cell('이용자 만족도 조사','#fff',cs=2)}</tr></table>
<div class="p s" style="font-size:12px">※ 연차 계획은 예산 확정 후 조정</div><div class="cap">[그림 3] 영역별 3개년 추진 로드맵</div>"""
PAGES['hwpx-img2table'] = f"""<div class="pair"><div><div class="lab">바꾸기 전 — 그림(글을 고칠 수 없음)</div><div class="img"><table class="t" style="font-size:12px;opacity:.85"><tr><th>구분</th><th>내용</th></tr><tr><td class="h">목표</td><td>이용자 만족도 90%</td></tr><tr><td class="h">방법</td><td>예약 · 알림 서비스</td></tr></table></div></div>
<div><div class="lab">바꾼 뒤 — 한/글 표(바로 고침)</div><table class="t" style="font-size:12px"><tr><th>구분</th><th>내용</th></tr><tr><td class="h">목표</td><td>이용자 만족도 <del>90%</del> <ins>92%</ins></td></tr><tr><td class="h">방법</td><td>예약 · 알림 서비스</td></tr></table></div></div>"""
PAGES['hwpx-image'] = f"""<div style="display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:14px"><span class="logo"><i></i>기관 로고</span><span class="logo r"><i></i>협력 기관 로고</span></div>
<div style="height:150px;border-radius:6px;background:linear-gradient(135deg,#dbeafe,#e0f2fe 60%,#f0f9ff);display:flex;align-items:center;justify-content:center;color:#475569;font-size:13px">사진 · 화면 캡처</div>
<div class="cap">[그림 4] 무인 대출기 설치 모습</div><div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-top:10px"><span></span><span>- 3 -</span><span>2027년 사업 계획서</span></div>"""
PAGES['hwpx-toc'] = """<div class="ttl">목차</div><div class="ttlline"></div><div class="toc">
<div class="c">Ⅰ  사업 개요<span class="f"></span>1</div><div class="s1">1.1. 추진 배경<span class="f"></span>1</div><div class="s1">1.2. 추진 목표<span class="f"></span>2</div>
<div class="c">Ⅱ  추진 계획<span class="f"></span>3</div><div class="s1">2.1. 단계별 일정<span class="f"></span>3</div><div class="s1">2.2. 추진 체계<span class="f"></span>5</div>
<div class="c">붙임 1. 세부 예산<span class="f"></span>7</div></div>
<div style="margin-top:14px" class="ttl">표 목차</div><div class="ttlline"></div><div class="toc"><div>&lt; 표 1 &gt; 사업 단계별 주요 일정<span class="f"></span>3</div><div>&lt; 표 2 &gt; 기관별 예산 배분<span class="f"></span>7</div></div>"""
PAGES['hwpx-pending-memo'] = f"""<div class="pair"><div><div class="lab">바꾸기 전</div><div class="p i">○ 신청 기간은 3월 중 2주로 운영함. 세부 일정 <b style="color:#c0392b;white-space:nowrap">[확정 필요]</b></div><div class="p i">○ 심사위원은 5명 내외로 구성함</div></div>
<div><div class="lab">바꾼 뒤 — 본문은 깨끗하게, 정할 것은 메모로</div><div class="p i">○ <span style="background:#e7f0ff">신청 기간은 3월 중 2주로 운영함</span>.</div><div class="memo"><b>메모</b> · 세부 일정 확정 필요</div><div class="p i">○ 심사위원은 5명 내외로 구성함</div></div></div>"""
for slug, body in PAGES.items():
    open(os.path.join(D, f'{slug}.html'), 'w').write(f'<!doctype html><meta charset="utf-8"><style>{CSS}</style><div class="pg" id="pg">{body}</div>')
print(list(PAGES))
