# img2tbl.py — 한/글(HWPX) 문서의 그림 하나를 같은 내용의 한/글 표로 바꾼다. 문단 번호(xi)가 밀린 만큼 Docs 상태(state.json)의 키도 옮긴다.
# 사용: python3 img2tbl.py spec1.json [spec2.json …]
# spec = {"img":"image2","cols":[상대 너비…],"fs":1000,"rows":[[{"t":"글\n둘째 줄","cs":1,"rs":1,"fill":"#1F3864","color":"#FFFFFF","b":1,"a":"C|L|R","fs":900,"nb":1}, …], …]}
import zipfile, re, os, sys, json, math, html

D = os.path.join(os.environ.get('ANA_DATA_DIR', os.path.expanduser('~/.local/share/ana/docs-ana')), 'nrf', 'docs', os.environ['DOC']) + '/'
SRC = D + 'original.hwpx'
specs = [json.load(open(p)) for p in sys.argv[1:]]
z = zipfile.ZipFile(SRC)
sec = z.read('Contents/section0.xml').decode('utf-8')
hd = z.read('Contents/header.xml').decode('utf-8')
old_ps = [m.start() for m in re.finditer(r'<hp:p[\s>]', sec)]

def bump(tag, n):
    global hd
    m = re.search(r'<hh:%s itemCnt="(\d+)">' % tag, hd)
    hd = hd[:m.start()] + '<hh:%s itemCnt="%d">' % (tag, int(m.group(1)) + n) + hd[m.end():]

# 테두리·배경
bf_ids = [int(x) for x in re.findall(r'<hh:borderFill id="(\d+)"', hd)]
bf_cache = {}
def border_fill(fill, nb):
    key = (fill or '', bool(nb))
    if key in bf_cache: return bf_cache[key]
    nid = max(bf_ids) + 1; bf_ids.append(nid)
    side = lambda n: '<hh:%s type="NONE" width="0.1 mm" color="#000000"/>' % n if nb else '<hh:%s type="SOLID" width="0.12 mm" color="#7F7F7F"/>' % n
    x = ('<hh:borderFill id="%d" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' % nid
         + side('leftBorder') + side('rightBorder') + side('topBorder') + side('bottomBorder') + '<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>'
         + ('<hc:fillBrush><hc:winBrush faceColor="%s" hatchColor="#000000" alpha="0"/></hc:fillBrush>' % fill if fill else '') + '</hh:borderFill>')
    global hd
    i = hd.index('</hh:borderFills>'); hd = hd[:i] + x + hd[i:]; bump('borderFills', 1)
    bf_cache[key] = nid; return nid

# 글자 모양: 28번(12pt 보통)을 본떠 크기·굵기·색만 바꾼다
base_cp = re.search(r'<hh:charPr id="28".*?</hh:charPr>', hd, re.S).group(0)
cp_ids = [int(x) for x in re.findall(r'<hh:charPr id="(\d+)"', hd)]
cp_cache = {}
def char_pr(fs, b, color):
    key = (fs, bool(b), color or '#000000')
    if key in cp_cache: return cp_cache[key]
    nid = max(cp_ids) + 1; cp_ids.append(nid)
    x = re.sub(r'id="28" height="1200" textColor="#000000"', 'id="%d" height="%d" textColor="%s"' % (nid, fs, key[2]), base_cp)
    if b: x = x.replace('</hh:charPr>', '<hh:bold/></hh:charPr>')
    global hd
    i = hd.index('</hh:charProperties>'); hd = hd[:i] + x + hd[i:]; bump('charProperties', 1)
    cp_cache[key] = nid; return nid

PARA = {'L': 10, 'C': 9, 'R': 9}      # 9: 가운데 130% · 10: 왼쪽 130%
pid = [max([7700000] + [int(x) for x in re.findall(r'<hp:p id="(77\d{5})"', sec)])]
new_ids = set()
def para_xml(text, a, cp):
    pid[0] += 1; new_ids.add(str(pid[0]))
    return '<hp:p id="%d" paraPrIDRef="%d" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="%d">%s</hp:run></hp:p>' % (pid[0], PARA.get(a, 9), cp, '<hp:t>%s</hp:t>' % html.escape(text, quote=False) if text else '')

tbl_id = [1990000]
def table_xml(spec, W):
    cols = spec['cols']; tot = sum(cols); cw = [round(W * c / tot) for c in cols]; cw[-1] += W - sum(cw)
    fs0 = spec.get('fs', 1000)
    nrow = len(spec['rows']); ncol = len(cols)
    occ = [[False] * ncol for _ in range(nrow)]; cells = []
    for r, row in enumerate(spec['rows']):
        c = 0
        for cell in row:
            while c < ncol and occ[r][c]: c += 1
            if c >= ncol: raise SystemExit('too many cells in row %d of %s' % (r, spec['img']))
            cs, rs = cell.get('cs', 1), cell.get('rs', 1)
            for rr in range(r, r + rs):
                for cc in range(c, c + cs): occ[rr][cc] = True
            cells.append((r, c, cs, rs, cell)); c += cs
    # 행 높이: 글 줄 수로 어림
    rh = [0] * nrow
    for r, c, cs, rs, cell in cells:
        fs = cell.get('fs', fs0); w = sum(cw[c:c + cs]) - 1020
        cpl = max(1, int(w / (fs * 0.92)))
        lines = sum(max(1, math.ceil(len(part) / cpl)) for part in str(cell.get('t', '')).split('\n'))
        need = int(lines * fs * 1.3 + 282 + fs * 0.3)
        per = need / rs
        for rr in range(r, r + rs): rh[rr] = max(rh[rr], int(per))
    rh = [max(h, int(fs0 * 1.9)) for h in rh]
    tbl_id[0] += 1
    out = ['<hp:tbl id="%d" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="%d" colCnt="%d" cellSpacing="0" borderFillIDRef="%d" noShading="0">' % (tbl_id[0], nrow, ncol, border_fill(None, True))
           + '<hp:sz width="%d" widthRelTo="ABSOLUTE" height="%d" heightRelTo="ABSOLUTE" protect="0"/>' % (W, sum(rh))
           + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
           + '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>']
    for r in range(nrow):
        out.append('<hp:tr>')
        for (rr, c, cs, rs, cell) in [x for x in cells if x[0] == r]:
            fs = cell.get('fs', fs0); cp = char_pr(fs, cell.get('b'), cell.get('color'))
            a = cell.get('a', 'C')
            ps = ''.join(para_xml(line, a, cp) for line in str(cell.get('t', '')).split('\n'))
            out.append('<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="%d">' % border_fill(cell.get('fill'), cell.get('nb'))
                       + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="%s" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' % cell.get('va', 'CENTER')
                       + ps + '</hp:subList><hp:cellAddr colAddr="%d" rowAddr="%d"/><hp:cellSpan colSpan="%d" rowSpan="%d"/>' % (c, r, cs, rs)
                       + '<hp:cellSz width="%d" height="%d"/><hp:cellMargin left="425" right="425" top="170" bottom="170"/></hp:tc>' % (sum(cw[c:c + cs]), sum(rh[r:r + rs])))
        out.append('</hp:tr>')
    out.append('</hp:tbl>')
    return ''.join(out)

for spec in specs:
    m = re.search(r'<hp:pic [^>]*>(?:(?!</hp:pic>).)*binaryItemIDRef="%s"(?:(?!</hp:pic>).)*</hp:pic>' % spec['img'], sec, re.S)
    if not m: raise SystemExit('no pic for ' + spec['img'])
    sec = sec[:m.start()] + table_xml(spec, spec.get('w', 48190)) + sec[m.end():]
    print('replaced', spec['img'])

# 문단 번호 옮기기: 새로 넣은 문단(id 77…)을 빼고 원래 문단의 새 순번
new_ps = list(re.finditer(r'<hp:p[\s>][^>]*', sec))
mapping = {}; k = 0
for i, mm in enumerate(new_ps):
    mi = re.search(r'\bid="(\d+)"', mm.group(0))
    if mi and mi.group(1) in new_ids: continue
    mapping[k] = i; k += 1
assert k == len(old_ps), (k, len(old_ps))

def sh(key):
    m = re.match(r'^0\.(\d+)(.*)$', key)
    return f"0.{mapping[int(m.group(1))]}{m.group(2)}" if m else key

st = json.load(open(D + 'state.json'))
json.dump(st, open(D + 'state.before-img2tbl.json', 'w'), ensure_ascii=False)
st['paras'] = {sh(a): v for a, v in st['paras'].items()}
for v in st['paras'].values():
    if isinstance(v, dict) and v.get('added') and v['added'].get('after'): v['added']['after'] = sh(v['added']['after'])
for n in st.get('notes', []):
    if n.get('key'): n['key'] = sh(n['key'])
nd = {}
for a, v in st.get('drOff', {}).items():
    p = a.split('|');
    if len(p) >= 2: p[1] = sh(p[1])
    nd['|'.join(p)] = v
st['drOff'] = nd
for t in ('tables', 'noteOff'):
    if isinstance(st.get(t), dict): st[t] = {sh(a): b for a, b in st[t].items()}

out = D + 'original.new.hwpx'
zo = zipfile.ZipFile(out, 'w')
for it in z.infolist():
    data = z.read(it.filename)
    if it.filename == 'Contents/section0.xml': data = sec.encode('utf-8')
    if it.filename == 'Contents/header.xml': data = hd.encode('utf-8')
    zo.writestr(it, data, compress_type=zipfile.ZIP_STORED if it.filename == 'mimetype' else zipfile.ZIP_DEFLATED)
zo.close()
os.replace(out, SRC)
open(D + 'state.json', 'w').write(json.dumps(st, ensure_ascii=False))
m = json.load(open(D + 'meta.json')); m['size'] = os.path.getsize(SRC); json.dump(m, open(D + 'meta.json', 'w'), ensure_ascii=False)
print('paragraphs', len(old_ps), '->', len(new_ps))
