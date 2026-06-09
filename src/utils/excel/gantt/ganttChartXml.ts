// Чистые билдеры OOXML-частей для нативных графиков Excel.
// Без SheetJS/DOM — только строки. Всё динамическое экранируется.

import type { ChartBlock } from './ganttChartData';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const FAKT_COLOR = 'ED7D31'; // оранжевый = факт
const PLAN_COLOR = '4472C4'; // синий = план

const NS_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_DRAWING_MAIN = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_SS_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS_C14 = 'http://schemas.microsoft.com/office/drawing/2007/8/2/chart';

const FONT = 'Georgia';
// Дефолтные текстовые свойства графика (шрифт Georgia для текста и чисел).
const TXPR =
  '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>' +
  `<a:defRPr><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:defRPr>` +
  '</a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr>';

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Снять базовые сущности из значения атрибута (для сравнения имени листа). */
export function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function strCacheInner(values: string[]): string {
  const pts = values
    .map((v, k) => `<c:pt idx="${k}"><c:v>${xmlEscape(v)}</c:v></c:pt>`)
    .join('');
  return `<c:ptCount val="${values.length}"/>${pts}`;
}

function numCacheInner(values: (number | null)[]): string {
  // Точки только для присутствующих значений — пропуск = нет столбца.
  const pts = values
    .map((v, k) => (v === null ? '' : `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`))
    .join('');
  return `<c:formatCode>#,##0</c:formatCode><c:ptCount val="${values.length}"/>${pts}`;
}

interface SeriesArgs {
  idx: number;
  order: number;
  name: string;
  nameRef: string;
  color: string;
  catRef: string;
  catLabels: string[];
  valRef: string;
  vals: (number | null)[];
}

function seriesXml(a: SeriesArgs): string {
  return (
    '<c:ser>' +
    `<c:idx val="${a.idx}"/><c:order val="${a.order}"/>` +
    '<c:tx><c:strRef>' +
    `<c:f>${xmlEscape(a.nameRef)}</c:f>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(a.name)}</c:v></c:pt></c:strCache>` +
    '</c:strRef></c:tx>' +
    `<c:spPr><a:solidFill><a:srgbClr val="${a.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` +
    '<c:cat><c:strRef>' +
    `<c:f>${xmlEscape(a.catRef)}</c:f>` +
    `<c:strCache>${strCacheInner(a.catLabels)}</c:strCache>` +
    '</c:strRef></c:cat>' +
    '<c:val><c:numRef>' +
    `<c:f>${xmlEscape(a.valRef)}</c:f>` +
    `<c:numCache>${numCacheInner(a.vals)}</c:numCache>` +
    '</c:numRef></c:val>' +
    '</c:ser>'
  );
}

/** Полный chartN.xml: кластерный столбчатый график, серии Факт/План. */
export function buildChartXml(block: ChartBlock, i: number): string {
  const catId = 100000000 + i * 10;
  const valId = catId + 1;

  // План — слева (order 0), Факт — справа (order 1); легенда в том же порядке.
  const plan = seriesXml({
    idx: 0,
    order: 0,
    name: block.planName,
    nameRef: `ChartData!$A$${block.startRow + 2}`,
    color: PLAN_COLOR,
    catRef: block.catRef,
    catLabels: block.catLabels,
    valRef: block.planRef,
    vals: block.planPts,
  });
  const fakt = seriesXml({
    idx: 1,
    order: 1,
    name: block.faktName,
    nameRef: `ChartData!$A$${block.startRow + 1}`,
    color: FAKT_COLOR,
    catRef: block.catRef,
    catLabels: block.catLabels,
    valRef: block.faktRef,
    vals: block.faktPts,
  });

  return (
    XML_DECL +
    `<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWING_MAIN}" xmlns:r="${NS_REL}" xmlns:mc="${NS_MC}">` +
    // Встроенный стиль диаграммы 8 (Конструктор → Стили диаграмм)
    `<mc:AlternateContent><mc:Choice xmlns:c14="${NS_C14}" Requires="c14"><c14:style val="108"/></mc:Choice>` +
    '<mc:Fallback><c:style val="8"/></mc:Fallback></mc:AlternateContent>' +
    '<c:chart>' +
    '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>' +
    `<a:rPr lang="ru-RU"><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr>` +
    `<a:t>${xmlEscape(block.title)}</a:t>` +
    '</a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
    '<c:autoTitleDeleted val="0"/>' +
    '<c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
    plan +
    fakt +
    '<c:gapWidth val="150"/>' +
    `<c:axId val="${catId}"/><c:axId val="${valId}"/>` +
    '</c:barChart>' +
    `<c:catAx><c:axId val="${catId}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="b"/>${TXPR}<c:crossAx val="${valId}"/></c:catAx>` +
    `<c:valAx><c:axId val="${valId}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="#,##0" sourceLinked="0"/>${TXPR}` +
    `<c:crossAx val="${catId}"/></c:valAx>` +
    '</c:plotArea>' +
    `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${TXPR}</c:legend>` +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
    '</c:chart>' +
    TXPR +
    '</c:chartSpace>'
  );
}

/** drawing1.xml: по одному twoCellAnchor на график, стек под сеткой. */
export function buildDrawingXml(count: number, gridRows: number): string {
  let anchors = '';
  for (let i = 0; i < count; i++) {
    const fromRow = gridRows + 2 + i * 16; // 0-based; stride 16 > height 15 → без перекрытий
    const toRow = fromRow + 15;
    const frameId = i + 2; // id ≥ 2
    const relId = `rId${i + 1}`;
    anchors +=
      '<xdr:twoCellAnchor editAs="oneCell">' +
      `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      '<xdr:graphicFrame macro="">' +
      `<xdr:nvGraphicFramePr><xdr:cNvPr id="${frameId}" name="Chart ${frameId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
      `<a:graphic><a:graphicData uri="${NS_CHART}">` +
      `<c:chart xmlns:c="${NS_CHART}" r:id="${relId}"/>` +
      '</a:graphicData></a:graphic>' +
      '</xdr:graphicFrame><xdr:clientData/>' +
      '</xdr:twoCellAnchor>';
  }
  return (
    XML_DECL +
    `<xdr:wsDr xmlns:xdr="${NS_SS_DRAWING}" xmlns:a="${NS_DRAWING_MAIN}" xmlns:r="${NS_REL}" xmlns:c="${NS_CHART}">` +
    anchors +
    '</xdr:wsDr>'
  );
}

/** drawing1.xml.rels: graphicFrame rId → chart part. */
export function buildDrawingRels(count: number): string {
  let rels = '';
  for (let i = 0; i < count; i++) {
    rels += `<Relationship Id="rId${i + 1}" Type="${NS_REL}/chart" Target="../charts/chart${i + 1}.xml"/>`;
  }
  return `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`;
}

/** Новый файл рельсов листа с единственным relationship на drawing. */
export function buildSheetRelsNew(drawingRelId: string): string {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="${drawingRelId}" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/>` +
    '</Relationships>'
  );
}

/** Один relationship drawing для дописывания в существующий файл рельсов листа. */
export function drawingRelEntry(drawingRelId: string): string {
  return `<Relationship Id="${drawingRelId}" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/>`;
}

/** Override-записи для [Content_Types].xml. */
export function buildContentTypeOverrides(count: number): string {
  let s =
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
  for (let i = 0; i < count; i++) {
    s += `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
  }
  return s;
}
