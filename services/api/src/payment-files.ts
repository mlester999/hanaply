import { createHash, randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';

import { AppError } from './app-error.js';

const maximumDimension = 12_000;
const acceptedFormats = Object.freeze({
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
} as const);

type AcceptedFormat = keyof typeof acceptedFormats;

export interface UploadedImageInput {
  buffer: Buffer;
  declaredMimeType: string;
  originalFilename: string;
}

export interface ValidatedPaymentImage {
  buffer: Buffer;
  checksumSha256: string;
  extension: 'jpg' | 'png' | 'webp';
  height: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  originalFilename: string;
  sizeBytes: number;
  width: number;
}

function invalidUpload(message: string): AppError {
  return new AppError({ code: 'VALIDATION_ERROR', status: 400, message });
}

function detectFormat(buffer: Buffer): AcceptedFormat | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function filenameExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/u.exec(filename);
  return match?.[1]?.toLowerCase() ?? '';
}

function extensionMatches(format: AcceptedFormat, extension: string): boolean {
  if (format === 'jpeg') return extension === 'jpg' || extension === 'jpeg';
  return acceptedFormats[format].extension === extension;
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
  return `${safeBase || 'payment-proof'}.${extension}`;
}

export async function validateAndSanitizePaymentImage(
  input: UploadedImageInput,
  options: { maximumBytes: number; maximumPixels: number },
): Promise<ValidatedPaymentImage> {
  if (input.buffer.length === 0) throw invalidUpload('Choose an image to upload.');
  if (input.buffer.length > options.maximumBytes) {
    throw invalidUpload('The image is larger than the allowed upload size.');
  }

  const format = detectFormat(input.buffer);
  if (!format) throw invalidUpload('Upload a valid JPEG, PNG, or WebP image.');
  const expected = acceptedFormats[format];
  if (input.declaredMimeType !== expected.mimeType) {
    throw invalidUpload('The image content does not match its declared file type.');
  }
  const inputExtension = filenameExtension(input.originalFilename);
  if (!extensionMatches(format, inputExtension)) {
    throw invalidUpload('The image content does not match its filename extension.');
  }

  try {
    const image = sharp(input.buffer, {
      failOn: 'warning',
      limitInputChannels: 5,
      limitInputPixels: options.maximumPixels,
      pages: 1,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) {
      throw invalidUpload('The uploaded image could not be validated.');
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw invalidUpload('Animated or multi-page images are not supported.');
    }
    if (metadata.width > maximumDimension || metadata.height > maximumDimension) {
      throw invalidUpload('The image dimensions are too large.');
    }

    const oriented = sharp(input.buffer, {
      failOn: 'warning',
      limitInputChannels: 5,
      limitInputPixels: options.maximumPixels,
      pages: 1,
      sequentialRead: true,
    })
      .rotate()
      .toColourspace('srgb');
    const encoded =
      format === 'jpeg'
        ? oriented.jpeg({ quality: 90, mozjpeg: true })
        : format === 'png'
          ? oriented.png({ compressionLevel: 9 })
          : oriented.webp({ quality: 90 });
    const output = await encoded.toBuffer({ resolveWithObject: true });
    if (output.data.length > options.maximumBytes) {
      throw invalidUpload('The validated image is larger than the allowed upload size.');
    }
    if (
      output.info.width < 1 ||
      output.info.height < 1 ||
      output.info.width > maximumDimension ||
      output.info.height > maximumDimension ||
      output.info.width * output.info.height > options.maximumPixels
    ) {
      throw invalidUpload('The image dimensions are not supported.');
    }
    return {
      buffer: output.data,
      checksumSha256: createHash('sha256').update(output.data).digest('hex'),
      extension: expected.extension,
      height: output.info.height,
      mimeType: expected.mimeType,
      originalFilename: safeFilename(input.originalFilename, expected.extension),
      sizeBytes: output.data.length,
      width: output.info.width,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidUpload('The uploaded image is corrupted or unsafe.');
  }
}

export async function readSinglePaymentImage(
  request: FastifyRequest,
  maximumBytes: number,
): Promise<UploadedImageInput> {
  if (!request.isMultipart()) {
    throw invalidUpload('Upload the image as multipart form data.');
  }
  try {
    const part = await request.file({
      limits: { fieldSize: 1, fields: 0, files: 1, fileSize: maximumBytes, parts: 1 },
    });
    if (part?.fieldname !== 'file') {
      throw invalidUpload('A single image field named file is required.');
    }
    const buffer = await part.toBuffer();
    if (part.file.truncated) {
      throw invalidUpload('The image is larger than the allowed upload size.');
    }
    return {
      buffer,
      declaredMimeType: part.mimetype,
      originalFilename: part.filename,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidUpload('The image upload could not be read safely.');
  }
}

export function paymentProofObjectPath(
  userId: string,
  submissionId: string,
  extension: ValidatedPaymentImage['extension'],
): string {
  return `${userId}/${submissionId}/${randomUUID()}.${extension}`;
}

export function paymentMethodQrObjectPath(
  paymentMethodId: string,
  extension: ValidatedPaymentImage['extension'],
): string {
  return `methods/${paymentMethodId}/${randomUUID()}.${extension}`;
}
