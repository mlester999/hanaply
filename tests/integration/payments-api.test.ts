import 'reflect-metadata';

import { permissions } from '@hanaply/auth';
import { parseApiEnvironment } from '@hanaply/config';
import { apiContract, apiErrorEnvelopeSchema } from '@hanaply/contracts';
import { completeEntitlementFixture } from '@hanaply/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../services/api/src/app-error.js';
import { createApiApplication } from '../../services/api/src/bootstrap.js';

const userId = '31000000-0000-4000-8000-000000000001';
const adminId = '31000000-0000-4000-8000-000000000002';
const methodId = '31000000-0000-4000-8000-000000000010';
const submissionId = '31000000-0000-4000-8000-000000000020';
const proofId = '31000000-0000-4000-8000-000000000030';
const subscriptionId = '31000000-0000-4000-8000-000000000040';
const now = '2026-07-28T03:00:00.000Z';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  HANAPLY_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:3100',
  API_BASE_URL: 'http://localhost:3101',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3100',
  RATE_LIMIT_STORE: 'memory',
  OPENAPI_ENABLED: 'true',
  BUILD_SHA: 'payments-api-test',
});

const paymentMethod = {
  id: methodId,
  displayName: 'Local Test GCash',
  methodType: 'gcash' as const,
  displayOrder: 10,
  currency: 'PHP' as const,
  accountHolderName: 'Hanaply Local Test',
  accountIdentifier: '0917 000 0000 TEST ONLY',
  bankName: null,
  branchDetails: null,
  publicInstructions: 'Use only fictional local payment details.',
  publicNotes: 'No real money is accepted.',
  minimumAmountMinor: 49_900,
  maximumAmountMinor: 959_900,
  effectiveStartAt: null,
  effectiveEndAt: null,
  qrCodeUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/payment-qr-codes/signed',
  qrCodeVersion: 1,
  version: 2,
};

const adminPaymentMethod = {
  ...paymentMethod,
  enabled: true,
  privateNotes: 'Fictional operations note.',
  archivedAt: null,
  createdBy: adminId,
  updatedBy: adminId,
  createdAt: now,
  updatedAt: now,
};

const proof = {
  id: proofId,
  mimeType: 'image/png' as const,
  sizeBytes: 100,
  originalFilename: 'proof.png',
  checksumSha256: 'a'.repeat(64),
  width: 24,
  height: 16,
  uploadedAt: now,
  previewUrl: null,
};

const basePayment = {
  id: submissionId,
  planCode: 'plus_monthly',
  tierCode: 'plus' as const,
  billingPeriod: 'monthly' as const,
  quotedAmountMinor: 49_900,
  currency: 'PHP' as const,
  paymentMethodId: methodId,
  paymentMethod: {
    displayName: paymentMethod.displayName,
    methodType: paymentMethod.methodType,
    currency: 'PHP' as const,
    accountHolderName: paymentMethod.accountHolderName,
    accountIdentifier: paymentMethod.accountIdentifier,
    bankName: null,
    branchDetails: null,
    publicInstructions: paymentMethod.publicInstructions,
    publicNotes: paymentMethod.publicNotes,
    version: 2,
  },
  referenceNumber: 'LOCAL-REF-123456',
  paidAt: now,
  userNote: 'Fictional API integration payment.',
  informationResponse: null,
  submittedAt: null,
  reviewStartedAt: null,
  reviewedAt: null,
  publicReviewMessage: null,
  rejectionReasonCode: null,
  subscriptionId: null as string | null,
  declarationAcceptedAt: null,
  createdAt: now,
  updatedAt: now,
  events: [],
};

const adminFields = {
  user: {
    id: userId,
    email: 'member@example.com',
    displayName: 'Payment Member',
    accountStatus: 'active' as const,
  },
  normalizedReference: 'LOCALREF123456',
  reviewerId: adminId,
  reviewLockExpiresAt: '2026-07-28T03:15:00.000Z',
  internalReviewNote: null,
  approvalTransactionId: null,
  duplicateReference: false,
  duplicateProof: false,
  flags: [],
  currentSubscription: null,
};

const subscriptionRecord = {
  planId: '31000000-0000-4000-8000-000000000041',
  detail: {
    id: subscriptionId,
    userId,
    planCode: 'plus_monthly',
    tierCode: 'plus' as const,
    billingPeriod: 'monthly' as const,
    status: 'active' as const,
    startsAt: now,
    // The subscription window must straddle the real clock: the entitlement
    // evaluator deliberately uses the current time, so a hardcoded end date
    // would silently turn this fixture into a time bomb once it passes.
    endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    source: 'manual_payment' as const,
    version: 0,
    createdAt: now,
    updatedAt: now,
    events: [
      {
        id: '31000000-0000-4000-8000-000000000042',
        eventType: 'subscription.activated',
        effectiveAt: now,
        reason: 'Approved fictional test payment.',
        createdAt: now,
      },
    ],
  },
};

const state = {
  status:
    'draft' as (typeof apiContract.myPaymentSubmission.response.shape.data.shape.status)['_output'],
  version: 0,
  proof: null as typeof proof | null,
  subscriptionId: null as string | null,
};

function currentPayment() {
  return {
    ...basePayment,
    status: state.status,
    version: state.version,
    proof: state.proof,
    subscriptionId: state.subscriptionId,
    submittedAt: state.status === 'draft' ? null : now,
    declarationAcceptedAt: state.status === 'draft' ? null : now,
  };
}

function currentAdminPayment() {
  return { ...currentPayment(), ...adminFields };
}

const paymentRepository = {
  listPaymentMethods: vi.fn(() => Promise.resolve([paymentMethod])),
  getMySubscriptionRecord: vi.fn(() => Promise.resolve(subscriptionRecord)),
  listMyPayments: vi.fn(
    (_token: string, _user: string, input: { page: number; pageSize: number }) =>
      Promise.resolve({
        items: [{ ...currentPayment(), events: undefined }],
        pagination: { page: input.page, pageSize: input.pageSize, total: 1, totalPages: 1 },
      }),
  ),
  getMyPayment: vi.fn(() => Promise.resolve(currentPayment())),
  createPaymentDraft: vi.fn(() => Promise.resolve(submissionId)),
  updatePaymentDraft: vi.fn(() => {
    state.version += 1;
    return Promise.resolve();
  }),
  submitPayment: vi.fn(() => {
    if (state.status === 'submitted') {
      return Promise.reject(
        new AppError({
          code: 'CONFLICT',
          status: 409,
          message: 'Payment record changed. Refresh and try again.',
        }),
      );
    }
    state.status = 'submitted';
    state.version += 1;
    return Promise.resolve();
  }),
  cancelPayment: vi.fn(() => {
    state.status = 'cancelled';
    state.version += 1;
    return Promise.resolve();
  }),
  resubmitPayment: vi.fn(() => {
    state.status = 'resubmitted';
    state.version += 1;
    return Promise.resolve();
  }),
  attachPaymentProof: vi.fn(() => {
    state.proof = proof;
    state.version += 1;
    return Promise.resolve();
  }),
  paymentProofAccess: vi.fn(() =>
    Promise.resolve({
      url: 'http://127.0.0.1:54321/storage/v1/object/sign/payment-proofs/opaque',
      expiresAt: '2026-07-28T03:05:00.000Z',
    }),
  ),
  listAdminPaymentMethods: vi.fn(() => Promise.resolve([adminPaymentMethod])),
  getAdminPaymentMethod: vi.fn(() =>
    Promise.resolve({
      ...adminPaymentMethod,
      versions: [
        {
          id: '31000000-0000-4000-8000-000000000011',
          version: 2,
          changeType: 'qr_replaced',
          changedBy: adminId,
          snapshot: {},
          createdAt: now,
        },
      ],
    }),
  ),
  createAdminPaymentMethod: vi.fn(() => Promise.resolve({ ...adminPaymentMethod, versions: [] })),
  updateAdminPaymentMethod: vi.fn(() => Promise.resolve({ ...adminPaymentMethod, versions: [] })),
  setAdminPaymentMethodState: vi.fn(() => Promise.resolve({ ...adminPaymentMethod, versions: [] })),
  attachPaymentMethodQr: vi.fn(() => Promise.resolve({ ...adminPaymentMethod, versions: [] })),
  listAdminPayments: vi.fn((_actor: string, input: { page: number; pageSize: number }) => {
    const item = { ...currentAdminPayment() };
    Reflect.deleteProperty(item, 'events');
    Reflect.deleteProperty(item, 'flags');
    return Promise.resolve({
      items: [item],
      pagination: { page: input.page, pageSize: input.pageSize, total: 1, totalPages: 1 },
    });
  }),
  getAdminPayment: vi.fn(() => Promise.resolve(currentAdminPayment())),
  startReview: vi.fn(() => Promise.resolve({ ...currentAdminPayment(), status: 'under_review' })),
  requestInformation: vi.fn(() =>
    Promise.resolve({ ...currentAdminPayment(), status: 'needs_information' }),
  ),
  approvePayment: vi.fn(() =>
    Promise.resolve({
      ...currentAdminPayment(),
      status: 'approved',
      subscriptionId,
      approvalTransactionId: '31000000-0000-4000-8000-000000000043',
    }),
  ),
  rejectPayment: vi.fn(() => Promise.resolve({ ...currentAdminPayment(), status: 'rejected' })),
  recordRefund: vi.fn(() => Promise.resolve({ ...currentAdminPayment(), status: 'refunded' })),
  reverseApproval: vi.fn(() => Promise.resolve({ ...currentAdminPayment(), status: 'reversed' })),
  listAdminSubscriptions: vi.fn((_actor: string, input: { page: number; pageSize: number }) => {
    const item = { ...subscriptionRecord.detail };
    Reflect.deleteProperty(item, 'events');
    return Promise.resolve({
      items: [item],
      pagination: { page: input.page, pageSize: input.pageSize, total: 1, totalPages: 1 },
    });
  }),
  getAdminSubscriptionRecord: vi.fn(() => Promise.resolve(subscriptionRecord)),
  correctSubscription: vi.fn(() => Promise.resolve()),
};

const repository = {
  getPlanEntitlementSnapshot: () =>
    Promise.resolve({
      code: 'plus_monthly',
      entitlements: completeEntitlementFixture({ careerProfileLimit: 1, emailAlerts: true }),
    }),
};

interface TestRequest {
  headers: { authorization?: string };
  auth?: {
    userId: string;
    accessToken: string;
    accountStatus: 'active';
    roles?: readonly string[];
    permissions?: ReadonlySet<string>;
  };
}

const authService = {
  authenticate(request: TestRequest): Promise<void> {
    const token = request.headers.authorization?.replace(/^Bearer /u, '');
    if (token === 'suspended-token') {
      return Promise.reject(
        new AppError({
          code: 'ACCOUNT_SUSPENDED',
          status: 403,
          message: 'This account is suspended',
        }),
      );
    }
    if (!token || !['user-token', 'admin-token', 'reader-token'].includes(token)) {
      return Promise.reject(
        new AppError({
          code: 'AUTHENTICATION_REQUIRED',
          status: 401,
          message: 'Authentication is required',
        }),
      );
    }
    request.auth = {
      userId: token === 'user-token' ? userId : adminId,
      accessToken: token,
      accountStatus: 'active',
    };
    return Promise.resolve();
  },
  authorizeAdmin(
    request: TestRequest,
    requirement: { mode: 'all' | 'any'; permissions: readonly string[] },
  ): Promise<void> {
    if (!request.auth || request.auth.accessToken === 'user-token') {
      return Promise.reject(
        new AppError({
          code: 'FORBIDDEN',
          status: 403,
          message: 'Administrator membership is required',
        }),
      );
    }
    const granted =
      request.auth.accessToken === 'reader-token'
        ? new Set(['payments.read', 'subscriptions.read', 'payment_methods.read'])
        : new Set<string>(permissions);
    const allowed =
      requirement.mode === 'any'
        ? requirement.permissions.some((permission) => granted.has(permission))
        : requirement.permissions.every((permission) => granted.has(permission));
    if (!allowed) {
      return Promise.reject(
        new AppError({ code: 'FORBIDDEN', status: 403, message: 'Required permission is missing' }),
      );
    }
    request.auth = {
      ...request.auth,
      roles: request.auth.accessToken === 'reader-token' ? ['read_only_analyst'] : ['super_admin'],
      permissions: granted,
    };
    return Promise.resolve();
  },
};

function multipartBody(buffer: Buffer, mimeType: string, filename: string) {
  const boundary = 'hanaply-payment-test-boundary';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('Phase 2 payment API integration', () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;

  beforeAll(async () => {
    app = await createApiApplication(environment, { repository, paymentRepository, authService });
  });

  beforeEach(() => {
    state.status = 'draft';
    state.version = 0;
    state.proof = null;
    state.subscriptionId = null;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns enabled methods, current subscription, and paginated payment history', async () => {
    const headers = { authorization: 'Bearer user-token' };
    const methods = await app.inject({ method: 'GET', url: '/v1/payment-methods', headers });
    expect(apiContract.paymentMethods.response.parse(methods.json()).data[0]?.id).toBe(methodId);

    const subscription = await app.inject({ method: 'GET', url: '/v1/me/subscription', headers });
    expect(apiContract.mySubscription.response.parse(subscription.json()).data).toMatchObject({
      id: subscriptionId,
      status: 'active',
    });

    const history = await app.inject({
      method: 'GET',
      url: '/v1/me/payment-submissions?page=2&pageSize=5',
      headers,
    });
    const body = apiContract.myPaymentSubmissions.response.parse(history.json());
    expect(body.data.pagination).toMatchObject({ page: 2, pageSize: 5, total: 1 });
    expect(history.headers['x-request-id']).toBe(body.meta.requestId);
  });

  it('validates draft data and exposes safe optimistic conflicts', async () => {
    const headers = { authorization: 'Bearer user-token' };
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/me/payment-submissions',
      headers,
      payload: { planCode: 'invented', paymentMethodId: methodId },
    });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorEnvelopeSchema.parse(invalid.json()).error.code).toBe('VALIDATION_ERROR');

    const created = await app.inject({
      method: 'POST',
      url: '/v1/me/payment-submissions',
      headers,
      payload: {
        planCode: 'plus_monthly',
        paymentMethodId: methodId,
        referenceNumber: 'LOCAL-REF-123456',
        paidAt: now,
        userNote: 'Fictional test payment.',
      },
    });
    expect(apiContract.createPaymentSubmission.response.parse(created.json()).data.status).toBe(
      'draft',
    );

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/me/payment-submissions/${submissionId}/submit`,
      headers,
      payload: { expectedVersion: 0, declarationAccepted: true },
    });
    expect(apiContract.submitPaymentSubmission.response.parse(submitted.json()).data.status).toBe(
      'submitted',
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/me/payment-submissions/${submissionId}/submit`,
      headers,
      payload: { expectedVersion: 1, declarationAccepted: true },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(apiErrorEnvelopeSchema.parse(duplicate.json()).error.code).toBe('CONFLICT');
  });

  it('accepts a real image upload and rejects MIME spoofing before repository storage', async () => {
    const png = await sharp({
      create: { width: 24, height: 16, channels: 3, background: '#3157E8' },
    })
      .png()
      .toBuffer();
    const validMultipart = multipartBody(png, 'image/png', 'proof.png');
    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/me/payment-submissions/${submissionId}/proof`,
      headers: { authorization: 'Bearer user-token', ...validMultipart.headers },
      payload: validMultipart.payload,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(apiContract.uploadPaymentProof.response.parse(uploaded.json()).data.mimeType).toBe(
      'image/png',
    );
    const attachCall = paymentRepository.attachPaymentProof.mock.calls[0] as
      readonly unknown[] | undefined;
    expect(attachCall?.[0]).toBe(userId);
    expect(attachCall?.[1]).toBe(submissionId);
    expect(attachCall?.[2]).toEqual(
      expect.stringMatching(new RegExp(`^${userId}/${submissionId}/[0-9a-f-]+\\.png$`, 'u')),
    );
    const attachedImage = attachCall?.[3];
    expect(attachedImage).not.toBeNull();
    if (!attachedImage || typeof attachedImage !== 'object' || Array.isArray(attachedImage)) {
      throw new Error('The payment proof image was not passed to the repository.');
    }
    const attachedImageRecord = attachedImage as Record<string, unknown>;
    expect(attachedImageRecord.mimeType).toBe('image/png');
    expect(typeof attachedImageRecord.checksumSha256).toBe('string');
    expect(typeof attachCall?.[4]).toBe('string');

    state.proof = null;
    const spoofedMultipart = multipartBody(png, 'image/jpeg', 'proof.jpg');
    const spoofed = await app.inject({
      method: 'POST',
      url: `/v1/me/payment-submissions/${submissionId}/proof`,
      headers: { authorization: 'Bearer user-token', ...spoofedMultipart.headers },
      payload: spoofedMultipart.payload,
    });
    expect(spoofed.statusCode).toBe(400);
    expect(paymentRepository.attachPaymentProof).toHaveBeenCalledTimes(1);
  });

  it('returns short-lived proof access without exposing a storage path field', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/me/payment-submissions/${submissionId}/proof-access`,
      headers: { authorization: 'Bearer user-token' },
    });
    const body = apiContract.myPaymentProofAccess.response.parse(response.json());
    expect(body.data.url).toContain('/object/sign/');
    expect(body.data).not.toHaveProperty('objectPath');
  });

  it('enforces administrator permissions for method management and proof review', async () => {
    const readerHeaders = { authorization: 'Bearer reader-token' };
    const methods = await app.inject({
      method: 'GET',
      url: '/v1/admin/payment-methods',
      headers: readerHeaders,
    });
    expect(methods.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: 'POST',
      url: `/v1/admin/payment-methods/${methodId}/disable`,
      headers: readerHeaders,
      payload: { expectedVersion: 2, reason: 'Fictional administrative test reason.' },
    });
    expect(deniedMutation.statusCode).toBe(403);

    const queue = await app.inject({
      method: 'GET',
      url: '/v1/admin/payment-submissions?page=1&pageSize=10',
      headers: readerHeaders,
    });
    expect(
      apiContract.adminPaymentSubmissions.response.parse(queue.json()).data.items,
    ).toHaveLength(1);
    const deniedProof = await app.inject({
      method: 'GET',
      url: `/v1/admin/payment-submissions/${submissionId}/proof-access`,
      headers: readerHeaders,
    });
    expect(deniedProof.statusCode).toBe(403);
  });

  it('routes every controlled review outcome through the typed service boundary', async () => {
    const headers = { authorization: 'Bearer admin-token' };
    const actions = [
      {
        url: `/v1/admin/payment-submissions/${submissionId}/start-review`,
        payload: { expectedVersion: 0 },
        contract: apiContract.startPaymentReview,
      },
      {
        url: `/v1/admin/payment-submissions/${submissionId}/request-information`,
        payload: {
          expectedVersion: 0,
          reason: 'The proof needs a clearer review fixture.',
          reasonCategory: 'proof_unclear',
          publicMessage: 'Please upload a clearer payment proof image.',
          internalNote: null,
        },
        contract: apiContract.requestPaymentInformation,
      },
      {
        url: `/v1/admin/payment-submissions/${submissionId}/reject`,
        payload: {
          expectedVersion: 0,
          reason: 'The fictional payment could not be verified.',
          rejectionReasonCode: 'payment_not_found',
          publicMessage: 'We could not verify this fictional payment.',
          internalNote: null,
        },
        contract: apiContract.rejectPaymentSubmission,
      },
      {
        url: `/v1/admin/payment-submissions/${submissionId}/record-refund`,
        payload: {
          expectedVersion: 0,
          reason: 'A fictional external refund was confirmed.',
          refundedAmountMinor: 49_900,
          externalReference: 'REFUND-TEST-123',
          refundedAt: now,
          subscriptionImpact: 'none',
          internalNote: null,
        },
        contract: apiContract.recordPaymentRefund,
      },
      {
        url: `/v1/admin/payment-submissions/${submissionId}/reverse`,
        payload: {
          expectedVersion: 0,
          reason: 'The fictional approval was entered in error.',
          subscriptionImpact: 'end_access_now',
          internalNote: null,
        },
        contract: apiContract.reversePaymentApproval,
      },
    ];
    for (const action of actions) {
      const response = await app.inject({
        method: 'POST',
        url: action.url,
        headers,
        payload: action.payload,
      });
      expect(response.statusCode, action.url).toBe(200);
      action.contract.response.parse(response.json());
    }

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/admin/payment-submissions/${submissionId}/approve`,
      headers,
      payload: {
        expectedVersion: 0,
        reason: 'The fictional local payment was verified.',
        internalNote: null,
      },
    });
    const approval = apiContract.approvePaymentSubmission.response.parse(approved.json());
    expect(approval.data.subscription.status).toBe('active');
    expect(approval.data.subscription.entitlements.entitlements.careerProfileLimit).toBe(1);
  });

  it('serves and corrects subscription records with validation and permission checks', async () => {
    const headers = { authorization: 'Bearer admin-token' };
    const list = await app.inject({
      method: 'GET',
      url: '/v1/admin/subscriptions?status=active&page=1&pageSize=25',
      headers,
    });
    expect(apiContract.adminSubscriptions.response.parse(list.json()).data.pagination.total).toBe(
      1,
    );

    const corrected = await app.inject({
      method: 'POST',
      url: `/v1/admin/subscriptions/${subscriptionId}/correct`,
      headers,
      payload: {
        expectedVersion: 0,
        startsAt: now,
        endsAt: '2026-09-28T03:00:00.000Z',
        reason: 'Corrected a fictional local subscription date.',
        internalNote: null,
        restoreReversed: false,
      },
    });
    expect(apiContract.correctAdminSubscription.response.parse(corrected.json()).data.id).toBe(
      subscriptionId,
    );

    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/admin/subscriptions?status=invented',
      headers,
    });
    expect(invalid.statusCode).toBe(400);
  });

  it.each([
    ['Bearer suspended-token', 403, 'ACCOUNT_SUSPENDED'],
    ['Bearer user-token', 403, 'FORBIDDEN'],
  ])('denies protected payment administration for %s', async (authorization, status, code) => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/payment-submissions',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(status);
    expect(apiErrorEnvelopeSchema.parse(response.json()).error.code).toBe(code);
  });
});
