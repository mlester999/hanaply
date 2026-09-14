import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import type { CareerDocument } from '@hanaply/contracts';
import type { FastifyRequest } from 'fastify';
import { extractText, getDocumentProxy } from 'unpdf';

import { AppError } from './app-error.js';

export const maximumCareerDocumentBytes = 10 * 1024 * 1024;

type SupportedMimeType = CareerDocument['mimeType'];

interface FormatDescriptor {
  readonly extension: 'pdf' | 'docx' | 'rtf' | 'txt' | 'md';
  readonly mimeTypes: readonly SupportedMimeType[];
  readonly declaredFallbackMimeType: SupportedMimeType;
}

const formats = Object.freeze({
  pdf: {
    extension: 'pdf',
    mimeTypes: ['application/pdf'],
    declaredFallbackMimeType: 'application/pdf',
  },
  docx: {
    extension: 'docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    declaredFallbackMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  rtf: {
    extension: 'rtf',
    mimeTypes: ['application/rtf', 'text/rtf'],
    declaredFallbackMimeType: 'application/rtf',
  },
  txt: {
    extension: 'txt',
    mimeTypes: ['text/plain'],
    declaredFallbackMimeType: 'text/plain',
  },
  md: {
    extension: 'md',
    mimeTypes: ['text/markdown', 'text/plain'],
    declaredFallbackMimeType: 'text/markdown',
  },
} as const satisfies Record<string, FormatDescriptor>);

type FormatName = keyof typeof formats;

export interface UploadedCareerDocument {
  readonly buffer: Buffer;
  readonly declaredMimeType: string;
  readonly originalFilename: string;
}

export interface ValidatedCareerDocument {
  readonly buffer: Buffer;
  readonly mimeType: SupportedMimeType;
  readonly extension: FormatDescriptor['extension'];
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly originalFilename: string;
  readonly pageCount: number | null;
  readonly wordCount: number;
  readonly text: string;
  readonly warnings: readonly string[];
}

function invalidUpload(message: string): AppError {
  return new AppError({ code: 'VALIDATION_ERROR', status: 400, message });
}

/**
 * Detects the container format from the bytes themselves. A filename extension
 * or a client-supplied content type is never trusted on its own.
 */
function detectFormat(buffer: Buffer): FormatName | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'pdf';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  ) {
    return 'docx';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '{\\rtf') {
    return 'rtf';
  }
  if (!buffer.includes(0)) {
    const head = buffer.subarray(0, 4096).toString('utf8');
    if (/^#{1,6}\s|\n#{1,6}\s/u.test(head)) {
      return 'md';
    }
    return 'txt';
  }
  return null;
}

function filenameExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/u.exec(filename);
  return match?.[1]?.toLowerCase() ?? '';
}

function safeFilename(filename: string, extension: string): string {
  const leaf = filename.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  const withoutExtension = leaf.replace(/\.[^.]*$/u, '');
  const safeBase = withoutExtension
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^\.+/u, '')
    .trim()
    .slice(0, 110);
  return `${safeBase || 'career-document'}.${extension}`;
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (DOCX is a ZIP container; no external dependency is needed)
// ---------------------------------------------------------------------------

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

function readZipDirectory(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 66_000); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw invalidUpload('The document archive is malformed.');

  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw invalidUpload('The document archive is malformed.');
    }
    entries.push({
      method: buffer.readUInt16LE(cursor + 10),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      name: buffer.toString('utf8', cursor + 46, cursor + 46 + buffer.readUInt16LE(cursor + 28)),
      localOffset: buffer.readUInt32LE(cursor + 42),
    });
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw invalidUpload('The document archive is malformed.');
  }
  const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
  const payload = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(payload);
  if (entry.method === 8) return inflateRawSync(payload);
  throw invalidUpload('The document uses an unsupported compression method.');
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/gu, (_match, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function docxToText(buffer: Buffer): string {
  const entries = readZipDirectory(buffer);
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml');
  if (!documentEntry) {
    throw invalidUpload('The document does not contain readable Word content.');
  }
  const xml = readZipEntry(buffer, documentEntry).toString('utf8');
  return decodeXmlEntities(
    xml
      // Paragraphs and explicit breaks become newlines before tags are stripped.
      .replace(/<w:br\b[^>]*\/?>/gu, '\n')
      .replace(/<\/w:p>/gu, '\n')
      .replace(/<\/w:tr>/gu, '\n')
      .replace(/<w:tab\b[^>]*\/?>/gu, '\t')
      .replace(/<[^>]+>/gu, ''),
  )
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n');
}

function rtfToText(buffer: Buffer): string {
  const source = buffer.toString('latin1');
  let text = '';
  let index = 0;
  let skipDepth = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      const control = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/u.exec(source.slice(index));
      if (control) {
        const word = control[1];
        index += control[0].length;
        if (word === 'par' || word === 'line' || word === 'sect') text += '\n';
        else if (word === 'tab') text += '\t';
        else if (word === 'u') text += String.fromCodePoint(Number(control[2] ?? 0));
        else if (
          word === 'fonttbl' ||
          word === 'colortbl' ||
          word === 'stylesheet' ||
          word === 'info'
        ) {
          skipDepth = 1;
        }
        continue;
      }
      const symbol = source[index + 1];
      if (symbol === '\\' || symbol === '{' || symbol === '}') {
        text += symbol;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (character === '{') {
      if (skipDepth > 0) skipDepth += 1;
      index += 1;
      continue;
    }
    if (character === '}') {
      if (skipDepth > 0) skipDepth -= 1;
      index += 1;
      continue;
    }
    if (skipDepth === 0 && character !== '\r') text += character ?? '';
    index += 1;
  }
  return text.replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n');
}

function plainText(buffer: Buffer): string {
  return buffer
    .toString('utf8')
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n');
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return matches?.length ?? 0;
}

export interface ExtractedCareerDocumentText {
  readonly text: string;
  readonly pageCount: number | null;
  readonly wordCount: number;
  readonly warnings: readonly string[];
}

export async function extractCareerDocumentText(
  buffer: Buffer,
  format: FormatName,
): Promise<ExtractedCareerDocumentText> {
  const warnings: string[] = [];
  if (format === 'pdf') {
    try {
      const document = await getDocumentProxy(new Uint8Array(buffer));
      const extracted = await extractText(document, { mergePages: true });
      const text = (Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text)
        .replace(/[ \t]+\n/gu, '\n')
        .replace(/\n{3,}/gu, '\n\n');
      const wordCount = countWords(text);
      if (wordCount < 30) {
        warnings.push(
          'Very little selectable text was found. The file may be a scan or image-only PDF, so nothing could be read reliably.',
        );
      }
      return { text, pageCount: extracted.totalPages, wordCount, warnings };
    } catch {
      throw invalidUpload(
        'The PDF could not be read. Re-export it as a text-based PDF, DOCX, or plain text file.',
      );
    }
  }

  const text =
    format === 'docx'
      ? docxToText(buffer)
      : format === 'rtf'
        ? rtfToText(buffer)
        : plainText(buffer);
  const wordCount = countWords(text);
  if (wordCount < 10) {
    warnings.push('Almost no readable text was found in this file.');
  }
  return { text, pageCount: null, wordCount, warnings };
}

export function validateCareerDocument(
  input: UploadedCareerDocument,
): Promise<ValidatedCareerDocument> {
  if (input.buffer.length === 0) throw invalidUpload('Choose a file to upload.');
  if (input.buffer.length > maximumCareerDocumentBytes) {
    throw invalidUpload('The file is larger than the 10 MB limit.');
  }

  const format = detectFormat(input.buffer);
  if (!format) {
    throw invalidUpload('Upload a PDF, DOCX, RTF, plain-text, or Markdown resume.');
  }
  const descriptor = formats[format];
  const declared = (input.declaredMimeType || '').toLowerCase().split(';')[0]?.trim() ?? '';
  const accepted: readonly string[] = descriptor.mimeTypes;
  const mimeType = accepted.includes(declared)
    ? (declared as SupportedMimeType)
    : descriptor.declaredFallbackMimeType;
  const declaredExtension = filenameExtension(input.originalFilename);
  if (declaredExtension && declaredExtension !== descriptor.extension) {
    // Tolerate the common doc/docx and markdown aliases, reject real mismatches.
    const aliases: Record<string, string[]> = {
      pdf: ['pdf'],
      docx: ['docx'],
      rtf: ['rtf'],
      txt: ['txt', 'text'],
      md: ['md', 'markdown'],
    };
    if (!(aliases[descriptor.extension] ?? []).includes(declaredExtension)) {
      throw invalidUpload('The file content does not match its filename extension.');
    }
  }

  return extractCareerDocumentText(input.buffer, format).then((extracted) => ({
    buffer: input.buffer,
    mimeType,
    extension: descriptor.extension,
    sizeBytes: input.buffer.length,
    checksumSha256: createHash('sha256').update(input.buffer).digest('hex'),
    originalFilename: safeFilename(input.originalFilename, descriptor.extension),
    pageCount: extracted.pageCount,
    wordCount: extracted.wordCount,
    text: extracted.text,
    warnings: extracted.warnings,
  }));
}

export async function readSingleCareerDocument(
  request: FastifyRequest,
): Promise<UploadedCareerDocument> {
  if (!request.isMultipart()) {
    throw invalidUpload('Upload the document as multipart form data.');
  }
  try {
    const part = await request.file({
      limits: {
        fieldSize: 1,
        fields: 0,
        files: 1,
        fileSize: maximumCareerDocumentBytes,
        parts: 1,
      },
    });
    if (part?.fieldname !== 'file') {
      throw invalidUpload('A single document field named file is required.');
    }
    const buffer = await part.toBuffer();
    if (part.file.truncated) {
      throw invalidUpload('The file is larger than the 10 MB limit.');
    }
    return {
      buffer,
      declaredMimeType: part.mimetype,
      originalFilename: part.filename,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidUpload('The document upload could not be read safely.');
  }
}

/**
 * Object paths are `<owner-uuid>/<document-uuid>/<random-uuid>.<ext>`. They are
 * never returned to a client and never written to an audit event.
 */
export function careerDocumentObjectPath(
  userId: string,
  documentId: string,
  extension: ValidatedCareerDocument['extension'],
): string {
  return `${userId}/${documentId}/${randomUUID()}.${extension}`;
}
