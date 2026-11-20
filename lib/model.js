'use strict';
// model.js — hwp5.js(.hwp)와 hwpx.js(.hwpx)가 공통으로 만들어 내는 문서 모델.
// 단위는 모두 HWPUNIT(1/7200 inch = 1/100 pt). A4 = 59528 × 84186.
//
// doc      { format, version, meta, fonts[], charShapes[], paraShapes[], styles[], sections[], warnings[] }
// section  { index, page{width,height,left,right,top,bottom,header,footer,gutter,landscape}, paragraphs[] }
// paragraph{ text, paraShapeId, styleId, charShapeId, pageBreak, columnBreak,
//            lines[{textpos,vertpos,vertsize,textheight,baseline,spacing,horzpos,horzsize,flags}],
//            controls[{type:'table'|'shape'|..., ...}], depth }
//   · lines = 한/글이 저장 시 계산해 둔 줄 배치(PARA_LINE_SEG / hp:lineseg). vertpos는 문단이 속한
//     영역(본문 = 쪽 본문 영역 상단, 셀 = 셀 상단) 기준 세로 오프셋이다.

function newDoc(format) {
  return {
    format, version: '', meta: {}, fonts: [], charShapes: [], paraShapes: [], styles: [], binData: [],
    sections: [], warnings: [],
  };
}
function newSection(index) {
  return {
    index, pageStartNo: 0,
    page: { width: 59528, height: 84186, left: 8504, right: 8504, top: 5668, bottom: 4252, header: 4252, footer: 4252, gutter: 0, landscape: false },
    paragraphs: [],
  };
}
function newParagraph() {
  return { text: '', paraShapeId: 0, styleId: 0, charShapeId: 0, charShapes: [], lines: [], controls: [], pageBreak: false, columnBreak: false, depth: 0 };
}
module.exports = { newDoc, newSection, newParagraph };
