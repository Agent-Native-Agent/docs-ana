# secedit.py — 한/글(HWPX) 구역 XML 을 고치고, 원래 문단이 몇 번째로 옮겨졌는지 따라가 Docs 상태(state.json)의 문단 키를 다시 맞춘다.
# 사용: from secedit import edit;  edit(lambda sec: new_sec)   — 고치는 함수는 원래 문단에 붙은 nrfxi="k" 표시를 지우지 말 것(지운 문단은 상태에서도 빠진다)
import zipfile, re, os, json

D = os.path.join(os.environ.get('ANA_DATA_DIR', os.path.expanduser('~/.local/share/ana/docs-ana')), 'nrf', 'docs', os.environ['DOC']) + '/'

def edit(fn, header_fn=None, tag='edit'):
    src = D + 'original.hwpx'
    z = zipfile.ZipFile(src)
    sec = z.read('Contents/section0.xml').decode('utf-8'); hd = z.read('Contents/header.xml').decode('utf-8')
    k = [0]
    def mark(m): s = m.group(0) + f' nrfxi="{k[0]}"'; k[0] += 1; return s
    tagged = re.sub(r'<hp:p(?=[\s>])', mark, sec)
    n_old = k[0]
    out = fn(tagged)
    if header_fn: hd = header_fn(hd)
    mapping = {}; i = 0
    for m in re.finditer(r'<hp:p(?=[\s>])[^>]*', out):
        t = re.search(r' nrfxi="(\d+)"', m.group(0))
        if t: mapping[int(t.group(1))] = i
        i += 1
    out = re.sub(r' nrfxi="\d+"', '', out)
    def sh(key):
        m = re.match(r'^0\.(\d+)(.*)$', key)
        if not m: return key
        x = int(m.group(1)); return f"0.{mapping[x]}{m.group(2)}" if x in mapping else None
    st = json.load(open(D + 'state.json'))
    open(D + f'state.before-{tag}.json', 'w').write(json.dumps(st, ensure_ascii=False))
    st['paras'] = {sh(a): v for a, v in st['paras'].items() if sh(a)}
    for v in st['paras'].values():
        if isinstance(v, dict) and v.get('added') and v['added'].get('after'): v['added']['after'] = sh(v['added']['after']) or v['added']['after']
    st['notes'] = [n for n in st.get('notes', []) if not n.get('key') or sh(n['key'])]
    for n in st['notes']:
        if n.get('key'): n['key'] = sh(n['key'])
    nd = {}
    for a, v in st.get('drOff', {}).items():
        p = a.split('|')
        if len(p) >= 2 and sh(p[1]): p[1] = sh(p[1])
        nd['|'.join(p)] = v
    st['drOff'] = nd
    for t in ('tables', 'noteOff'):
        if isinstance(st.get(t), dict): st[t] = {sh(a) or a: b for a, b in st[t].items()}
    import shutil; shutil.copy(src, D + f'original.before-{tag}.hwpx')
    tmp = D + 'original.new.hwpx'; zo = zipfile.ZipFile(tmp, 'w')
    for it in z.infolist():
        data = z.read(it.filename)
        if it.filename == 'Contents/section0.xml': data = out.encode('utf-8')
        if it.filename == 'Contents/header.xml': data = hd.encode('utf-8')
        zo.writestr(it, data, compress_type=zipfile.ZIP_STORED if it.filename == 'mimetype' else zipfile.ZIP_DEFLATED)
    zo.close(); os.replace(tmp, src)
    open(D + 'state.json', 'w').write(json.dumps(st, ensure_ascii=False))
    m = json.load(open(D + 'meta.json')); m['size'] = os.path.getsize(src); json.dump(m, open(D + 'meta.json', 'w'), ensure_ascii=False)
    print('paragraphs', n_old, '->', i, 'kept', len(mapping))
