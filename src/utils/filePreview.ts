// ══════════════════════════════════════════════════════════════════════
// Secure File Preview & Download Utilities
// Safe MIME classification, header sanitization, spreadsheet/DOCX/ZIP preview
// ══════════════════════════════════════════════════════════════════════

import path from 'path';
import zlib from 'zlib';
import * as XLSX from 'xlsx';

export type PreviewKind = 'pdf' | 'image' | 'spreadsheet' | 'docx' | 'text' | 'zip' | 'unsupported';

export interface FileClassification {
  kind: PreviewKind;
  extension: string;
  safeContentType: string;
  isSvg: boolean;
}

export interface SpreadsheetSheetPreview {
  name: string;
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export interface ZipEntryPreview {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

export interface PreviewPayload {
  kind: PreviewKind;
  fileName: string;
  mimeType: string;
  fileSize: number;
  isSvg?: boolean;
  text?: string;
  truncated?: boolean;
  sheets?: SpreadsheetSheetPreview[];
  paragraphs?: string[];
  entries?: ZipEntryPreview[];
  message?: string;
}

const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;
const MAX_SPREADSHEET_ROWS = 300;
const MAX_SPREADSHEET_COLS = 40;
const MAX_SPREADSHEET_SHEETS = 10;
const MAX_ZIP_ENTRIES = 200;
const MAX_DOCX_COMPRESSED_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.log', '.yml', '.yaml', '.ini']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

/**
 * Strip path traversal and control characters from a filename for Content-Disposition.
 */
export function sanitizeDownloadFilename(rawName: string | null | undefined, fallback = 'document'): string {
  const base = path.posix.basename((rawName || '').replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[\x00-\x1f\x7f"\\;]/g, '_')
    .trim();
  return cleaned || fallback;
}

/**
 * Build a safe Content-Disposition header value.
 */
export function buildContentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const safeName = sanitizeDownloadFilename(filename);
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Extract normalized lowercase extension from filename or URL path.
 */
export function extractNormalizedExtension(name?: string | null, urlOrKey?: string | null): string {
  const tryExt = (val?: string | null): string => {
    if (!val) return '';
    const withoutQuery = val.split('?')[0].split('#')[0];
    return path.posix.extname(withoutQuery.replace(/\\/g, '/')).toLowerCase();
  };

  return tryExt(name) || tryExt(urlOrKey);
}

/**
 * Classify a project document strictly by allow-listed extension and MIME type.
 */
export function classifyFile(
  name?: string | null,
  mimeType?: string | null,
  urlOrKey?: string | null
): FileClassification {
  const ext = extractNormalizedExtension(name, urlOrKey);
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();

  if (ext === '.pdf' || mime === 'application/pdf') {
    return { kind: 'pdf', extension: ext || '.pdf', safeContentType: 'application/pdf', isSvg: false };
  }

  if (ext in IMAGE_EXT_TO_MIME || mime.startsWith('image/')) {
    const resolvedMime = IMAGE_EXT_TO_MIME[ext] || (Object.values(IMAGE_EXT_TO_MIME).includes(mime) ? mime : '');
    if (resolvedMime) {
      return {
        kind: 'image',
        extension: ext,
        safeContentType: resolvedMime,
        isSvg: resolvedMime === 'image/svg+xml',
      };
    }
  }

  if (
    SPREADSHEET_EXTENSIONS.has(ext) ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    const safeType = ext === '.csv' || mime === 'text/csv'
      ? 'text/plain; charset=utf-8'
      : 'application/octet-stream';
    return { kind: 'spreadsheet', extension: ext || '.xlsx', safeContentType: safeType, isSvg: false };
  }

  if (
    ext === '.docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return { kind: 'docx', extension: '.docx', safeContentType: 'application/octet-stream', isSvg: false };
  }

  if (TEXT_EXTENSIONS.has(ext) || mime === 'text/plain') {
    return { kind: 'text', extension: ext || '.txt', safeContentType: 'text/plain; charset=utf-8', isSvg: false };
  }

  if (ext === '.zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') {
    return { kind: 'zip', extension: '.zip', safeContentType: 'application/octet-stream', isSvg: false };
  }

  return { kind: 'unsupported', extension: ext, safeContentType: 'application/octet-stream', isSvg: false };
}

/**
 * Verify magic bytes for inline-served binary types (PDF and raster images).
 */
export function matchesExpectedSignature(buffer: Buffer, classification: FileClassification): boolean {
  if (!buffer || buffer.length === 0) return false;

  if (classification.kind === 'pdf') {
    return buffer.subarray(0, 1024).includes('%PDF-');
  }

  if (classification.kind === 'image') {
    if (classification.isSvg) {
      const head = buffer.subarray(0, 2048).toString('utf8').toLowerCase();
      return head.includes('<svg');
    }
    if (classification.safeContentType === 'image/png') {
      return buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
        buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
    }
    if (classification.safeContentType === 'image/jpeg') {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (classification.safeContentType === 'image/webp') {
      return buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (classification.safeContentType === 'image/gif') {
      const sig = buffer.subarray(0, 6).toString('ascii');
      return sig === 'GIF87a' || sig === 'GIF89a';
    }
  }

  return true;
}

/**
 * Decode UTF-8 text preview with size cap.
 */
export function extractTextPreview(buffer: Buffer): { text: string; truncated: boolean } {
  const truncated = buffer.length > MAX_TEXT_PREVIEW_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_TEXT_PREVIEW_BYTES) : buffer;
  return {
    text: slice.toString('utf8'),
    truncated,
  };
}

/**
 * Parse CSV/XLS/XLSX into bounded 2D string tables for safe client-side rendering.
 */
export function extractSpreadsheetPreview(buffer: Buffer, isCsv: boolean): SpreadsheetSheetPreview[] {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: isCsv ? false : undefined,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    sheetRows: MAX_SPREADSHEET_ROWS + 1,
  });

  const sheetNames = workbook.SheetNames.slice(0, MAX_SPREADSHEET_SHEETS);
  return sheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return { name: sheetName, rows: [], totalRows: 0, truncated: false };
    }
    const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    const truncated = rawRows.length > MAX_SPREADSHEET_ROWS;
    const cappedRows = rawRows.slice(0, MAX_SPREADSHEET_ROWS).map((row) =>
      Array.isArray(row)
        ? row.slice(0, MAX_SPREADSHEET_COLS).map((cell) => (cell == null ? '' : String(cell)))
        : []
    );

    return {
      name: sheetName,
      rows: cappedRows,
      totalRows: rawRows.length,
      truncated,
    };
  });
}

interface InternalZipRecord {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

/**
 * Parse ZIP Central Directory without writing or unpacking files to disk.
 */
function parseZipCentralDirectory(buffer: Buffer): InternalZipRecord[] {
  if (buffer.length < 22) return [];

  const minSearchOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= minSearchOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return [];

  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buffer.length) return [];

  const records: InternalZipRecord[] = [];
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (cursor + 46 <= cdEnd && records.length < MAX_ZIP_ENTRIES) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > cdEnd) break;

    const rawName = buffer.subarray(nameStart, nameEnd).toString('utf8');
    // Normalize display path and flag/neutralize traversal components
    const safeDisplayName = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
    const isDirectory = safeDisplayName.endsWith('/');

    records.push({
      name: safeDisplayName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory,
    });

    cursor = nameEnd + extraLen + commentLen;
  }

  return records;
}

/**
 * List entries inside a ZIP archive safely from Central Directory metadata only.
 */
export function extractZipEntries(buffer: Buffer): ZipEntryPreview[] {
  return parseZipCentralDirectory(buffer).map((rec) => ({
    name: rec.name,
    compressedSize: rec.compressedSize,
    uncompressedSize: rec.uncompressedSize,
    isDirectory: rec.isDirectory,
  }));
}

function decodeBasicXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

/**
 * Safely extract readable paragraphs from a DOCX archive's word/document.xml
 * without DTD/XXE/network XML parsing and with strict zip-bomb bounds.
 */
export function extractDocxParagraphs(buffer: Buffer): string[] {
  const entries = parseZipCentralDirectory(buffer);
  const docEntry = entries.find((e) => e.name === 'word/document.xml');
  if (!docEntry) {
    throw new Error('Document XML stream not found in DOCX archive.');
  }

  if (
    docEntry.compressedSize > MAX_DOCX_COMPRESSED_BYTES ||
    docEntry.uncompressedSize > MAX_DOCX_UNCOMPRESSED_BYTES
  ) {
    throw new Error('Document exceeds safe preview size limit.');
  }

  const lh = docEntry.localHeaderOffset;
  if (lh + 30 > buffer.length || buffer.readUInt32LE(lh) !== 0x04034b50) {
    throw new Error('Invalid DOCX local file header.');
  }

  const lhNameLen = buffer.readUInt16LE(lh + 26);
  const lhExtraLen = buffer.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + lhNameLen + lhExtraLen;
  const dataEnd = dataStart + docEntry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new Error('Corrupted DOCX entry bounds.');
  }

  const compressedSlice = buffer.subarray(dataStart, dataEnd);
  let xmlBuffer: Buffer;

  if (docEntry.compressionMethod === 0) {
    xmlBuffer = compressedSlice;
  } else if (docEntry.compressionMethod === 8) {
    xmlBuffer = zlib.inflateRawSync(compressedSlice, { maxOutputLength: MAX_DOCX_UNCOMPRESSED_BYTES });
  } else {
    throw new Error('Unsupported DOCX compression method.');
  }

  const xml = xmlBuffer.toString('utf8');
  const paragraphBlocks = xml.split(/<\/w:p>/i);
  const paragraphs: string[] = [];

  for (const block of paragraphBlocks) {
    // Convert tabs and explicit line breaks inside a paragraph
    const normalized = block
      .replace(/<w:tab\s*\/?>/gi, '\t')
      .replace(/<w:br[^>]*\/?>/gi, '\n');

    const textMatches = normalized.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi);
    let paragraphText = '';
    for (const match of textMatches) {
      paragraphText += decodeBasicXmlEntities(match[1]);
    }

    const trimmed = paragraphText.trim();
    if (trimmed) {
      paragraphs.push(trimmed);
    }
  }

  return paragraphs;
}
