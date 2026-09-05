import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { PreparedSharedFile } from './shared-files.js';

const TEXT_LIMIT = 100_000;
/** Text extraction never executes macros, formulas, embedded scripts, or links. */
export async function extractSharedFile(input: {
  filePath: string; name: string; mimeType: string;
}): Promise<PreparedSharedFile> {
  const { filePath, name, mimeType } = input;
  const data = await fs.readFile(filePath);
  const extension = path.extname(name).toLowerCase();
  const result: PreparedSharedFile = { name, path: filePath, text: '', images: [] };
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    const { loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(data);
    if (image.width * image.height > 25_000_000) throw new Error('Image exceeds 25 megapixels');
    result.images.push(filePath);
    result.notice = 'Image supplied for visual inspection; no text extraction was performed.';
  } else if (extension === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    const document = await getDocument({
      data: new Uint8Array(data), isEvalSupported: false,
      standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))).replace(/\\/g, '/'),
    }).promise;
    try {
      const pages = Math.min(document.numPages, 20);
      for (let i = 1; i <= pages && result.text.length < TEXT_LIMIT; i++) {
        const page = await document.getPage(i);
        const content = await page.getTextContent();
        result.text += `\n[Page ${i}]\n${content.items.map((item) => 'str' in item ? item.str : '').join(' ')}\n`;
        if (i <= 4) {
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(1.5, 1400 / Math.max(natural.width, natural.height)) });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvasContext: canvas.getContext('2d') as never, viewport, canvas: canvas as never }).promise;
          const imagePath = `${filePath}.page-${i}.png`;
          await fs.writeFile(imagePath, canvas.toBuffer('image/png'), { mode: 0o600 });
          result.images.push(imagePath);
        }
        page.cleanup();
      }
      result.notice = `PDF has ${document.numPages} pages. Text: first ${pages} pages (up to ${TEXT_LIMIT} characters). Visual previews: first ${Math.min(pages, 4)} pages only. Scanned pages require visual inspection; do not infer unseen pages.`;
    } finally { await document.destroy(); }
  } else if (extension === '.docx') {
    const mammoth = await import('mammoth');
    result.text = (await mammoth.extractRawText({ buffer: data })).value;
    result.notice = 'Document text only; embedded images and layout are not extracted.';
  } else if (extension === '.xlsx') {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as never);
    for (const sheet of workbook.worksheets.slice(0, 10)) {
      result.text += `\n[Sheet ${sheet.name}]\n`;
      sheet.eachRow((row, index) => {
        if (index > 500 || result.text.length >= TEXT_LIMIT) return;
        const cells: string[] = [];
        row.eachCell((cell, col) => { if (col <= 40) cells.push(`${cell.address}: ${cell.text}`); });
        result.text += `${cells.join(' | ')}\n`;
      });
    }
    result.notice = 'Values from up to 10 sheets, 500 rows and 40 columns per sheet. Formulas are not recalculated; charts/images are not extracted.';
  } else if (mimeType.startsWith('text/') || ['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.js', '.ts', '.tsx', '.py', '.css', '.log', '.sql'].includes(extension)) {
    if (data.includes(0)) throw new Error('This file is binary, not readable text');
    result.text = data.toString('utf8');
  } else {
    throw new Error('Unsupported call format. Send text, PDF, PNG/JPEG/WebP, DOCX, or XLSX. Audio/video and legacy Office files are not decoded.');
  }
  if (result.text.length > TEXT_LIMIT) result.notice = `${result.notice ?? ''} Text truncated at ${TEXT_LIMIT} characters.`.trim();
  result.text = result.text.slice(0, TEXT_LIMIT);
  if (result.text) {
    const extracted = `${filePath}.extracted.txt`;
    await fs.writeFile(extracted, result.text, { mode: 0o600 });
    result.notice = `${result.notice ?? ''} Extracted text saved at ${extracted}.`.trim();
  }
  return result;
}

if (parentPort) {
  void extractSharedFile(workerData).then(
    (result) => parentPort!.postMessage({ result }),
    (error: unknown) => parentPort!.postMessage({ error: error instanceof Error ? error.message : 'Document could not be opened' }),
  );
}
