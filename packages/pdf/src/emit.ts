import PDFDocument from 'pdfkit';
import type { PdfFonts } from './fonts.js';
import {
  layoutPrintModel,
  type FontKey,
  type Layout,
  type LayoutOptions,
  type Measurer,
  type Op,
  type StructNode,
} from './layout.js';
import type { PrintModel } from './model.js';

type Doc = InstanceType<typeof PDFDocument>;
type StructElement = ReturnType<Doc['struct']>;

export interface EmitOptions extends LayoutOptions {
  /** Creation date (and footer print date); fixed in tests for reproducible output. */
  now?: Date | undefined;
}

/**
 * No ligatures: fi/fl ligature glyphs extract as a single letter ("confdential"), which breaks
 * copy/paste and screen readers. Measuring and drawing use the same features.
 */
const FEATURES = { liga: false, clig: false, dlig: false } as never;

/** Measures with the embedded fonts and replaces characters they cannot draw with '?'. */
function measurerFor(doc: Doc): Measurer {
  const glyphs = (font: FontKey) => {
    doc.font(font);
    const f = (
      doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?(cp: number): boolean } } }
    )._font?.font;
    return f?.hasGlyphForCodePoint?.bind(f);
  };
  const has = { regular: glyphs('regular'), bold: glyphs('bold') };
  return {
    width: (text, font, size) =>
      doc.font(font).fontSize(size).widthOfString(text, { features: FEATURES }),
    sanitize: (text, font) => {
      const check = has[font];
      const nfc = text.normalize('NFC');
      if (!check) return nfc;
      return [...nfc].map((ch) => (ch === '\n' || check(ch.codePointAt(0)!) ? ch : '?')).join('');
    },
  };
}

function draw(doc: Doc, op: Exclude<Op, { kind: 'bookmark' }>) {
  switch (op.kind) {
    case 'text':
      doc
        .font(op.font)
        .fontSize(op.size)
        .fillColor(op.color)
        .text(op.text, op.x, op.y, { lineBreak: false, features: FEATURES });
      break;
    case 'line':
      doc
        .save()
        .lineWidth(op.width)
        .strokeColor(op.color)
        .moveTo(op.x1, op.y1)
        .lineTo(op.x2, op.y2)
        .stroke()
        .restore();
      break;
    case 'rect':
      doc
        .save()
        .lineWidth(op.width)
        .strokeColor(op.color)
        .rect(op.x, op.y, op.w, op.h)
        .stroke()
        .restore();
      break;
    case 'circle':
      doc.save();
      if (op.fill) doc.fillColor(op.color).circle(op.cx, op.cy, op.r).fill();
      else doc.lineWidth(op.width).strokeColor(op.color).circle(op.cx, op.cy, op.r).stroke();
      doc.restore();
      break;
    case 'tick': {
      const s = op.size;
      doc
        .save()
        .lineWidth(Math.max(1.4, s / 9))
        .strokeColor('#000000')
        .moveTo(op.x + s * 0.2, op.y + s * 0.55)
        .lineTo(op.x + s * 0.42, op.y + s * 0.78)
        .lineTo(op.x + s * 0.82, op.y + s * 0.24)
        .stroke()
        .restore();
      break;
    }
  }
}

/**
 * Renders a print model with PDFKit as a tagged PDF (PDF/UA mode): document title displayed,
 * language set, fonts embedded, every drawing either inside a structure element or marked as an
 * Artifact (answer-space rules, page furniture), and a bookmark per top-level section (plan §8.1).
 */
export async function renderPdf(
  model: PrintModel,
  fonts: PdfFonts,
  opts: EmitOptions = {},
): Promise<{ bytes: Uint8Array; layout: Layout }> {
  const now = opts.now ?? new Date();
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    tagged: true,
    // @types/pdfkit predates PDFKit's PDF/UA mode.
    subset: 'PDF/UA' as never,
    pdfVersion: '1.7',
    lang: model.lang ?? 'en',
    displayTitle: true,
    info: { Title: model.title, Creator: 'qb', CreationDate: now, ModDate: now },
  });
  doc.registerFont('regular', fonts.regular as unknown as ArrayBuffer);
  doc.registerFont('bold', fonts.bold as unknown as ArrayBuffer);
  const chunks: Uint8Array[] = [];
  doc.on('data', (c: Uint8Array) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });

  const layout = layoutPrintModel(model, measurerFor(doc), opts);

  // Structure tree in logical (document) order, before any content is drawn.
  const elements = new Map<number, StructElement>();
  const build = (node: StructNode): StructElement => {
    const options: Record<string, string> = {};
    if (node.actual) options.actual = node.actual;
    const el = doc.struct(node.role as never, options as never);
    if (node.scope)
      (el as unknown as { dictionary: { data: Record<string, unknown> } }).dictionary.data.A = {
        O: 'Table',
        Scope: node.scope,
      };
    elements.set(node.id, el);
    for (const child of node.children) el.add(build(child));
    return el;
  };
  const rootEl = doc.struct('Document');
  doc.addStructure(rootEl);
  elements.set(layout.root.id, rootEl);
  for (const child of layout.root.children) rootEl.add(build(child));

  for (const page of layout.pages) {
    doc.addPage({ size: [layout.page.width, layout.page.height], margin: 0 });
    for (const op of page.ops) {
      if (op.kind === 'bookmark') {
        doc.outline.addItem(op.title);
        continue;
      }
      const el = op.struct ? elements.get(op.struct.id) : undefined;
      if (el && op.struct) {
        el.add(doc.markStructureContent(op.struct.role as never));
        draw(doc, op);
        doc.endMarkedContent();
      } else {
        doc.markContent('Artifact', {
          type: op.kind === 'text' && op.artifact ? 'Pagination' : 'Layout',
        } as never);
        draw(doc, op);
        doc.endMarkedContent();
      }
    }
  }

  // End elements children-first so PDFKit can flush the tree.
  const end = (node: StructNode) => {
    node.children.forEach(end);
    elements.get(node.id)?.end();
  };
  end(layout.root);
  doc.end();
  await finished;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, layout };
}
