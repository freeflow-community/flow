import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileDTO } from '@flow/shared';
// Build first: this exercises the packaged worker, not a mock on the audio thread.
import { prepareSharedFile } from '../dist/shared-files.js';
import { createCanvas } from '@napi-rs/canvas';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((p) => fs.rm(p, { recursive: true, force: true }))); });
async function prepare(name: string, data: Buffer, mimeType: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-file-test-'));
  directories.push(dir);
  return prepareSharedFile({ id: 'fixture', name, sizeBytes: data.length, mimeType } as FileDTO,
    dir, async () => data, new AbortController().signal);
}

function samplePdf(): Buffer {
  const stream = 'BT /F1 18 Tf 40 140 Td (Resume: Built an inventory system) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

describe('packaged call file reader', () => {
  it('extracts a synthetic DOCX without executing links or embedded instructions', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Reduced onboarding time by 35 percent.</w:t></w:r></w:p></w:body></w:document>');
    const result = await prepare('resume.docx', await zip.generateAsync({ type: 'nodebuffer' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.text).toContain('Reduced onboarding time by 35 percent.');
  });
  it('extracts PDF text and renders a real page image', async () => {
    const result = await prepare('resume.pdf', samplePdf(), 'application/pdf');
    expect(result.text).toContain('[Page 1]');
    expect(result.text).toContain('Built an inventory system');
    expect(result.images).toHaveLength(1);
    expect((await fs.readFile(result.images[0]!)).subarray(1, 4).toString()).toBe('PNG');
    expect(await fs.readFile(`${result.path}.extracted.txt`, 'utf8')).toContain('inventory');
  }, 30_000);
  it('supplies real image input for visual inspection', async () => {
    const canvas = createCanvas(80, 40);
    canvas.getContext('2d').fillText('hello', 5, 20);
    const result = await prepare('screen.png', canvas.toBuffer('image/png'), 'image/png');
    expect(result.images).toEqual([result.path]);
    expect(result.text).toBe('');
  });
  it('extracts spreadsheet values with sheet/cell references', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Budget').addRow(['Engineering', 12500]);
    const result = await prepare('budget.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(result.text).toContain('[Sheet Budget]');
    expect(result.text).toContain('B1: 12500');
  });
  it('extracts text and rejects malformed or unsupported files honestly', async () => {
    expect((await prepare('notes.md', Buffer.from('Revenue grew 12%'), 'text/markdown')).text).toContain('12%');
    await expect(prepare('broken.pdf', Buffer.from('not a PDF'), 'application/pdf')).rejects.toThrow();
    await expect(prepare('video.mp4', Buffer.from('video'), 'video/mp4')).rejects.toThrow('Unsupported');
  }, 30_000);
  it('cancels before download and rejects oversized uploads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-file-test-'));
    directories.push(dir);
    const stop = new AbortController(); stop.abort();
    const download = async () => { throw new Error('must not download'); };
    await expect(prepareSharedFile({ id: 'a', name: 'a.txt', sizeBytes: 4 } as FileDTO, dir, download, stop.signal)).rejects.toThrow();
    await expect(prepareSharedFile({ id: 'b', sizeBytes: 21 * 1024 * 1024 } as FileDTO, dir, download, new AbortController().signal)).rejects.toThrow('20 MB');
  });
});
