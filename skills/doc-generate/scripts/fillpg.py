import re,sys,json,html,os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secedit import edit
O=json.loads(sys.argv[1]); n=[0]; miss=[]
TAB='<hp:tab width="4000" leader="3" type="2"/>'
def fn(s):
    def p(m):
        t=m.group(1); key=None; x=html.unescape(t)
        if (r:=re.match(r'^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])\s',x)): key=r.group(1)
        elif (r:=re.match(r'^(\d+\.\d+\.)\s',x)): key=r.group(1)
        elif (r:=re.match(r'^(붙임|첨부)\s*(\d?)',x)): key=r.group(1)+r.group(2)
        elif (r:=re.match(r'^<\s*표\s*(\d+)\s*>',x)): key='표'+r.group(1)
        elif (r:=re.match(r'^\[(그림|첨부|붙임)\s*(\d+)\]',x)): key=r.group(1)+r.group(2)
        if key not in O: miss.append(x[:20]); return m.group(0)
        n[0]+=1; return f'<hp:t>{t}{m.group(2)}{O[key]}</hp:t>'
    return re.sub(r'<hp:t>([^<]*)(<hp:tab [^>]*/>)\d+</hp:t>',p,s)
edit(fn,tag='toc-pages2'); print('filled',n[0],'miss',miss)
