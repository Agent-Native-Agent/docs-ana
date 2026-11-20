"""Package a Chromium print PDF as one lossless, page-sized picture per sheet."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED
import os
import re
import subprocess
from string import Template
import sys

OPC = 'http://schemas.openxmlformats.org/package/2006'
OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
HWP = 'http://www.hancom.co.kr/hwpml/2011'
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'


def page_dimensions(pdf):
    env = dict(os.environ, LC_ALL='C')
    def info(*args):
        return subprocess.check_output(['pdfinfo', *args, pdf], env=env, text=True)
    count = int(re.search(r'^Pages:\s+(\d+)', info(), re.M)[1])
    sizes = re.findall(r'^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts', info('-f', '1', '-l', str(count)), re.M)
    if len(sizes) != count or not count:
        raise ValueError('PDF 용지 크기를 읽지 못했습니다')
    return [(float(w), float(h)) for w, h in sizes]


def word_package(out, sizes):
    out.writestr('[Content_Types].xml', XML + f'<Types xmlns="{OPC}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    def rels(name, entries):
        out.writestr(name, XML + f'<Relationships xmlns="{OPC}/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{OFFICE}/{kind}" Target="{target}"/>' for i, kind, target in entries) + '</Relationships>')
    rels('_rels/.rels', [(1, 'officeDocument', 'word/document.xml')])
    rels('word/_rels/document.xml.rels', [(i, 'image', f'media/page{i}.png') for i in range(1, len(sizes)+1)])
    parts = []
    for i, (w, h) in enumerate(sizes, 1):
        cx, cy = round(w * 12700), round(h * 12700)
        section = f'<w:sectPr><w:pgSz w:w="{round(w*20)}" w:h="{round(h*20)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
        # A next-page section per picture fixes its paper dimensions independently.
        props = '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
        if i < len(sizes):
            props += section
        parts.append(f'''<w:p><w:pPr>{props}</w:pPr><w:r><w:drawing>
<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="0" allowOverlap="1">
<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
<wp:extent cx="{cx}" cy="{cy}"/><wp:wrapNone/><wp:docPr id="{i}" name="Page {i}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="{i}" name="Page {i}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId{i}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>''')
    out.writestr('word/document.xml', XML + f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="{OFFICE}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + ''.join(parts) + section + '</w:body></w:document>')


def hangul_package(out, sizes):
    out.writestr('mimetype', 'application/hwp+zip', compress_type=ZIP_STORED)
    out.writestr('version.xml', XML + f'<hv:HCFVersion xmlns:hv="{HWP}/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Docs" appVersion="1"/>')
    out.writestr('META-INF/container.xml', XML + '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>')
    out.writestr('META-INF/manifest.xml', XML + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>')
    header = Path(__file__).with_name('header.xml').read_text()
    out.writestr('Contents/header.xml', re.sub(r'secCnt="\d+"', f'secCnt="{len(sizes)}"', header, count=1))
    items = ['<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>']
    out.writestr('settings.xml', XML + f'<ha:HWPApplicationSetting xmlns:ha="{HWP}/app"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>')
    items.append('<opf:item id="settings" href="settings.xml" media-type="application/xml"/>')
    spine = ['<opf:itemref idref="header"/>']
    sec_template = Template(Path(__file__).with_name('section-properties.xml').read_text())
    for i, (width, height) in enumerate(sizes):
        w, h = round(width*100), round(height*100)
        name = f'Contents/section{i}.xml'
        items.append(f'<opf:item id="section{i}" href="{name}" media-type="application/xml"/><opf:item id="page{i+1}" href="BinData/page{i+1}.png" media-type="image/png" isEmbeded="1"/>')
        spine.append(f'<opf:itemref idref="section{i}"/>')
        zero = 'left="0" right="0" top="0" bottom="0"'
        out.writestr(name, XML + f'''<hs:sec xmlns:hs="{HWP}/section" xmlns:hp="{HWP}/paragraph" xmlns:hc="{HWP}/core"><hp:p id="{i}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">
{sec_template.substitute(width=w, height=h)}
<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>
<hp:pic id="{1000+i}" instid="{1000+i}" zOrder="0" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="1" dropcapstyle="None" href="" groupLevel="0" reverse="0">
<hp:offset x="0" y="0"/><hp:orgSz width="{w}" height="{h}"/><hp:curSz width="{w}" height="{h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="{w//2}" centerY="{h//2}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>
<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{w}" y="0"/><hc:pt2 x="{w}" y="{h}"/><hc:pt3 x="0" y="{h}"/></hp:imgRect><hp:imgClip left="0" right="{w}" top="0" bottom="{h}"/><hp:inMargin {zero}/><hp:imgDim dimwidth="{w}" dimheight="{h}"/><hc:img binaryItemIDRef="page{i+1}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>
<hp:sz width="{w}" height="{h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="1"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin {zero}/></hp:pic><hp:t/></hp:run></hp:p></hs:sec>''')
    out.writestr('Contents/content.hpf', XML + '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id=""><opf:metadata><opf:language>ko</opf:language></opf:metadata><opf:manifest>' + ''.join(items) + '</opf:manifest><opf:spine>' + ''.join(spine) + '</opf:spine></opf:package>')


def export(pdf, target):
    sizes = page_dimensions(pdf)
    word = target.suffix == '.docx'
    with TemporaryDirectory(dir=target.parent) as tmp, ZipFile(target, 'w', ZIP_DEFLATED) as out:
        (word_package if word else hangul_package)(out, sizes)
        prefix = str(Path(tmp) / 'page')
        for i, (w, h) in enumerate(sizes, 1):
            # Keep only one lossless raster on disk while building the package.
            dpi = min(240, 6000 * 72 / max(w, h))
            subprocess.run(['pdftocairo', '-png', '-singlefile', '-f', str(i), '-l', str(i), '-r', str(dpi), pdf, prefix], check=True)
            part = 'word/media' if word else 'BinData'
            out.write(prefix+'.png', f'{part}/page{i}.png', compress_type=ZIP_STORED)
            os.remove(prefix+'.png')
    print(len(sizes))


if __name__ == '__main__':
    export(Path(sys.argv[1]), Path(sys.argv[2]))
