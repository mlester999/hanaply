import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { AppError } from '../../services/api/src/app-error.js';
import {
  paymentMethodQrObjectPath,
  paymentProofObjectPath,
  validateAndSanitizePaymentImage,
} from '../../services/api/src/payment-files.js';

const options = { maximumBytes: 8 * 1024 * 1024, maximumPixels: 40_000_000 };

async function image(format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const source = sharp({
    create: { width: 24, height: 16, channels: 3, background: '#3157E8' },
  });
  if (format === 'jpeg') return source.jpeg().withMetadata({ orientation: 6 }).toBuffer();
  if (format === 'png') return source.png().toBuffer();
  return source.webp().toBuffer();
}

describe('payment image security', () => {
  it.each([
    ['jpeg', 'image/jpeg', 'proof.jpeg', 'jpg', 16, 24],
    ['png', 'image/png', 'proof.png', 'png', 24, 16],
    ['webp', 'image/webp', 'proof.webp', 'webp', 24, 16],
  ] as const)(
    'accepts and sanitizes a real %s image',
    async (format, mimeType, filename, extension, width, height) => {
      const result = await validateAndSanitizePaymentImage(
        {
          buffer: await image(format),
          declaredMimeType: mimeType,
          originalFilename: `../../Unsafe <name> ${filename}`,
        },
        options,
      );

      expect(result).toMatchObject({ mimeType, extension, width, height });
      expect(result.originalFilename).not.toMatch(/[<>/\\]/u);
      expect(result.checksumSha256).toBe(createHash('sha256').update(result.buffer).digest('hex'));
      expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
    },
  );

  it('rejects MIME spoofing and extension spoofing', async () => {
    const png = await image('png');
    await expect(
      validateAndSanitizePaymentImage(
        { buffer: png, declaredMimeType: 'image/jpeg', originalFilename: 'proof.png' },
        options,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 } satisfies Partial<AppError>);
    await expect(
      validateAndSanitizePaymentImage(
        { buffer: png, declaredMimeType: 'image/png', originalFilename: 'proof.jpg' },
        options,
      ),
    ).rejects.toThrow(/filename extension/u);
  });

  it('rejects an executable renamed as an image and a corrupted image', async () => {
    await expect(
      validateAndSanitizePaymentImage(
        {
          buffer: Buffer.from('MZ fake executable payload'),
          declaredMimeType: 'image/png',
          originalFilename: 'malware.png',
        },
        options,
      ),
    ).rejects.toThrow(/valid JPEG, PNG, or WebP/u);

    await expect(
      validateAndSanitizePaymentImage(
        {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
          declaredMimeType: 'image/png',
          originalFilename: 'corrupted.png',
        },
        options,
      ),
    ).rejects.toThrow(/corrupted or unsafe/u);
  });

  it('rejects oversized files and excessive decoded pixels before storage', async () => {
    await expect(
      validateAndSanitizePaymentImage(
        {
          buffer: Buffer.alloc(101),
          declaredMimeType: 'image/png',
          originalFilename: 'too-large.png',
        },
        { maximumBytes: 100, maximumPixels: 1_000_000 },
      ),
    ).rejects.toThrow(/larger/u);

    await expect(
      validateAndSanitizePaymentImage(
        {
          buffer: await image('png'),
          declaredMimeType: 'image/png',
          originalFilename: 'too-many-pixels.png',
        },
        { maximumBytes: 1_000_000, maximumPixels: 100 },
      ),
    ).rejects.toThrow(/corrupted or unsafe/u);
  });

  it('creates opaque randomized paths under fixed owner and method prefixes', () => {
    const proofA = paymentProofObjectPath('user-id', 'submission-id', 'png');
    const proofB = paymentProofObjectPath('user-id', 'submission-id', 'png');
    const qr = paymentMethodQrObjectPath('method-id', 'webp');
    expect(proofA).toMatch(/^user-id\/submission-id\/[0-9a-f]{8}-[0-9a-f-]{27}\.png$/u);
    expect(proofA).not.toBe(proofB);
    expect(qr).toMatch(/^methods\/method-id\/[0-9a-f]{8}-[0-9a-f-]{27}\.webp$/u);
  });
});
