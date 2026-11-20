# 문서에 다이어그램(편집 가능한 한/글 표) 넣기 — 칸 간격 1mm, 연한 바탕, ▶ 화살표 칸은 테두리 없음
# 사용: DOC=<문서 id> python3 diagram.py <spec.json> "<바꿀 그림의 캡션 글자>"
#   spec.json = {"cols":[열 폭 비율…], "fs": 글자 크기(1/100pt), "rows": [[칸…]…]} — 칸 = {"t":글, "fill":"#RRGGBB", "b":1, "nb":1(테두리 없음), "cs":열 합침, "rs":행 합침, "color":"#…", "a":"L"}
import re,sys,math,html,zipfile,json
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secedit import edit,D
hd0=zipfile.ZipFile(D+'original.hwpx').read('Contents/header.xml').decode()
N='#1F3864';LB='#EDF1F9';LB2='#DCE3F0';G='#F2F2F2';Y='#FFF2CC';W='#FFFFFF'
def nb(t="",**k): d={"t":t,"nb":1}; d.update(k); return d
def box(t,f=LB,**k): d={"t":t,"fill":f}; d.update(k); return d
ar=lambda **k: nb("▶",color=N,**k)

dn=lambda t="아니오",**k: nb("▼ "+t,color=N,fs=820,**k)
yes=lambda **k: nb("예 ▶",color=N,fs=820,**k)
dec=lambda t: box("◇ "+t,Y,b=1)
H=lambda t: nb(t,b=1,color=N,fs=850)
add={'bf':[],'cp':[],'pp':[]}
bf_ids=[int(x) for x in re.findall(r'<hh:borderFill id="(\d+)"',hd0)]; cp_ids=[int(x) for x in re.findall(r'<hh:charPr id="(\d+)"',hd0)]; pp_ids=[int(x) for x in re.findall(r'<hh:paraPr id="(\d+)"',hd0)]
bfc={}
def border_fill(fill,nbd):
    k=(fill or '',bool(nbd))
    if k in bfc: return bfc[k]
    i=max(bf_ids)+1; bf_ids.append(i)
    side=lambda n:('<hh:%s type="NONE" width="0.1 mm" color="#000000"/>'%n) if nbd else ('<hh:%s type="SOLID" width="0.12 mm" color="#A6B0C3"/>'%n)
    add['bf'].append(f'<hh:borderFill id="{i}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'+side('leftBorder')+side('rightBorder')+side('topBorder')+side('bottomBorder')+'<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>'+(f'<hc:fillBrush><hc:winBrush faceColor="{fill}" hatchColor="#000000" alpha="0"/></hc:fillBrush>' if fill else '')+'</hh:borderFill>')
    bfc[k]=i; return i
BASE_CP=os.environ.get('BASE_CP','0'); base_cp=re.search(r'<hh:charPr id="%s".*?</hh:charPr>'%BASE_CP,hd0,re.S).group(0).replace('id="%s"'%BASE_CP,'id="104"',1); cpc={}
def char_pr(fs,b,color):
    k=(fs,bool(b),color or '#000000')
    if k in cpc: return cpc[k]
    i=max(cp_ids)+1; cp_ids.append(i)
    x=re.sub(r'<hh:charPr id="104" height="\d+" textColor="[^"]*"',f'<hh:charPr id="{i}" height="{fs}" textColor="{k[2]}"',base_cp,1); x=re.sub(r'<hh:bold\s*/>','',x)
    if b: x=x.replace('</hh:charPr>','<hh:bold/></hh:charPr>')
    add['cp'].append(x); cpc[k]=i; return i
base_pp=re.search(r'<hh:paraPr id="16".*?</hh:paraPr>',hd0,re.S).group(0)
def para_pr(align,ls,prev=0,nxt=0):
    i=max(pp_ids)+1; pp_ids.append(i)
    x=re.sub(r'<hh:paraPr id="16"',f'<hh:paraPr id="{i}"',base_pp,1); x=re.sub(r'(<hh:align horizontal=")\w+',r'\g<1>'+align,x)
    x=re.sub(r'<hh:lineSpacing [^>]*/>',f'<hh:lineSpacing type="PERCENT" value="{ls}" />',x)
    x=re.sub(r'(<hc:prev value=")-?\d+',lambda m:m.group(1)+str(prev),x); x=re.sub(r'(<hc:next value=")-?\d+',lambda m:m.group(1)+str(nxt),x)
    add['pp'].append(x); return i
PC=para_pr('CENTER',130); PL=para_pr('LEFT',130); PHOST=para_pr('CENTER',100,400,0); PCAP=para_pr('CENTER',130,150,400)
CAPCP=char_pr(1050,1,None)
pid=[7797000]
def para_xml(t,a,cp):
    pid[0]+=1; return f'<hp:p id="{pid[0]}" paraPrIDRef="{PL if a=="L" else PC}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="{cp}">'+(f'<hp:t>{html.escape(t,quote=False)}</hp:t>' if t else '<hp:t/>')+'</hp:run></hp:p>'
tid=[1997000]
def table_xml(spec,W=48190):
    cols=spec['cols']; tot=sum(cols); SP=283; ncol=len(cols)
    inner=W-SP*(ncol+1); cw=[round(inner*c/tot) for c in cols]; cw[-1]+=inner-sum(cw)
    fs0=spec['fs']; nrow=len(spec['rows']); occ=[[False]*ncol for _ in range(nrow)]; cells=[]
    for r,row in enumerate(spec['rows']):
        c=0
        for cell in row:
            while c<ncol and occ[r][c]: c+=1
            cs,rs=cell.get('cs',1),cell.get('rs',1)
            for rr in range(r,r+rs):
                for cc in range(c,c+cs): occ[rr][cc]=True
            cells.append((r,c,cs,rs,cell)); c+=cs
    rh=[0]*nrow
    for r,c,cs,rs,cell in cells:
        fs=cell.get('fs',fs0); w=sum(cw[c:c+cs])+SP*(cs-1)-600; cpl=max(1,int(w/(fs*0.95)))
        lines=sum(max(1,math.ceil(len(p)/cpl)) for p in str(cell.get('t','')).split('\n'))
        need=int(lines*fs*1.3+400)
        for rr in range(r,r+rs): rh[rr]=max(rh[rr],int(need/rs))
    rh=[max(h,int(fs0*2)) for h in rh]
    tid[0]+=1
    out=[f'<hp:tbl id="{tid[0]}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="NONE" repeatHeader="0" rowCnt="{nrow}" colCnt="{ncol}" cellSpacing="{SP}" borderFillIDRef="{border_fill(None,True)}" noShading="0"><hp:sz width="{W}" widthRelTo="ABSOLUTE" height="{sum(rh)+SP*(nrow+1)}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>']
    for r in range(nrow):
        out.append('<hp:tr>')
        for (rr,c,cs,rs,cell) in [x for x in cells if x[0]==r]:
            fs=cell.get('fs',fs0); cp=char_pr(fs,cell.get('b'),cell.get('color'))
            ps=''.join(para_xml(l,cell.get('a','C'),cp) for l in str(cell.get('t','')).split('\n'))
            out.append(f'<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="{border_fill(cell.get("fill"),cell.get("nb"))}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">{ps}</hp:subList><hp:cellAddr colAddr="{c}" rowAddr="{r}"/><hp:cellSpan colSpan="{cs}" rowSpan="{rs}"/><hp:cellSz width="{sum(cw[c:c+cs])+SP*(cs-1)}" height="{sum(rh[r:r+rs])+SP*(rs-1)}"/><hp:cellMargin left="{60 if cell.get("nb") else 300}" right="{60 if cell.get("nb") else 300}" top="170" bottom="170"/></hp:tc>')
        out.append('</hp:tr>')
    out.append('</hp:tbl>'); return ''.join(out)

TAB='<hp:tab width="4000" leader="3" type="2"/>'
def tblend(s,a):
    d=0
    for m in re.finditer(r'<hp:tbl |</hp:tbl>',s[a:]):
        d+=1 if m.group(0).startswith('<hp:tbl') else -1
        if d==0: return a+m.end()
def hostp(x,cap_open):
    global pid
    pid[0]+=1; return f'<hp:p id="{pid[0]}" paraPrIDRef="{PHOST}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="22">{x}<hp:t/></hp:run></hp:p>'
def capp(t):
    pid[0]+=1; return f'<hp:p id="{pid[0]}" paraPrIDRef="{PCAP}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="{CAPCP}"><hp:t>{html.escape(t,quote=False)}</hp:t></hp:run></hp:p>'
SPEC=json.load(open(sys.argv[1],encoding='utf-8')); CAP=sys.argv[2]
def fn(s):
    c=s.index(CAP)
    hp0=s.rfind('<hp:p ',0,s.rfind('<hp:tbl',0,c)); a=s.index('<hp:tbl',hp0); b=tblend(s,a)
    return s[:a]+table_xml(SPEC)+s[b:]
def hfn(hd):
    for tag,end,k in (('borderFills','</hh:borderFills>','bf'),('charProperties','</hh:charProperties>','cp'),('paraProperties','</hh:paraProperties>','pp')):
        i=hd.index(end); hd=hd[:i]+''.join(add[k])+hd[i:]
        m=re.search(r'<hh:%s itemCnt="(\d+)">'%tag,hd); hd=hd[:m.start()]+'<hh:%s itemCnt="%d">'%(tag,int(m.group(1))+len(add[k]))+hd[m.end():]
    return hd
edit(fn,header_fn=hfn,tag='diagram')
