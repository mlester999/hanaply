import type { z } from 'zod';

import { type ApiContractRoute, apiContract } from './api-contract.js';
import { type ApiErrorEnvelope, apiErrorEnvelopeSchema } from './errors.js';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
  fetch?: FetchLike;
}

export class HanaplyApiError extends Error {
  readonly status: number;
  readonly envelope: ApiErrorEnvelope;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = 'HanaplyApiError';
    this.status = status;
    this.envelope = envelope;
  }
}

type ParsedRouteResponse<TRoute extends ApiContractRoute> = z.output<TRoute['response']>;

function addQuery(url: URL, query: Record<string, unknown> | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`Unsupported query value for ${key}`);
    }
    url.searchParams.set(key, String(value));
  }
}

function addParams(path: string, params: Record<string, string> | undefined): string {
  if (!params) return path;
  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, encodeURIComponent(value)),
    path,
  );
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;

  async function request<TRoute extends ApiContractRoute>(
    route: TRoute,
    requestOptions: {
      query?: Record<string, unknown>;
      params?: Record<string, string>;
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<ParsedRouteResponse<TRoute>> {
    const path = addParams(route.path, requestOptions.params);
    if (path.includes('{')) throw new TypeError(`Missing path parameter for ${route.path}`);
    const url = new URL(path.replace(/^\//u, ''), baseUrl);
    addQuery(url, requestOptions.query);
    const token = await options.getAccessToken?.();
    const headers = new Headers({ Accept: 'application/json' });
    if (requestOptions.body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetchImplementation(url, {
      method: route.method,
      headers,
      ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new HanaplyApiError(response.status, apiErrorEnvelopeSchema.parse(body));
    }
    return route.response.parse(body) as ParsedRouteResponse<TRoute>;
  }

  async function upload<TRoute extends ApiContractRoute>(
    route: TRoute,
    file: Blob,
    uploadOptions: {
      params: Record<string, string>;
      filename: string;
      query?: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ): Promise<ParsedRouteResponse<TRoute>> {
    const path = addParams(route.path, uploadOptions.params);
    if (path.includes('{')) throw new TypeError(`Missing path parameter for ${route.path}`);
    const url = new URL(path.replace(/^\//u, ''), baseUrl);
    addQuery(url, uploadOptions.query);
    const token = await options.getAccessToken?.();
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const form = new FormData();
    form.set('file', file, uploadOptions.filename);
    const response = await fetchImplementation(url, {
      method: route.method,
      headers,
      body: form,
      ...(uploadOptions.signal ? { signal: uploadOptions.signal } : {}),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new HanaplyApiError(response.status, apiErrorEnvelopeSchema.parse(body));
    }
    return route.response.parse(body) as ParsedRouteResponse<TRoute>;
  }

  return Object.freeze({
    request,
    health: () => request(apiContract.health),
    ready: () => request(apiContract.ready),
    version: () => request(apiContract.version),
    meta: (query?: z.input<typeof apiContract.meta.query>) =>
      query ? request(apiContract.meta, { query: { ...query } }) : request(apiContract.meta),
    plans: () => request(apiContract.plans),
    paymentMethods: () => request(apiContract.paymentMethods),
    me: () => request(apiContract.me),
    updateMe: (body: z.input<typeof apiContract.updateMe.body>) =>
      request(apiContract.updateMe, { body }),
    preferences: () => request(apiContract.preferences),
    updatePreferences: (body: z.input<typeof apiContract.updatePreferences.body>) =>
      request(apiContract.updatePreferences, { body }),
    sessions: () => request(apiContract.sessions),
    revokeOtherSessions: () => request(apiContract.revokeOtherSessions),
    entitlements: () => request(apiContract.entitlements),
    mySubscription: () => request(apiContract.mySubscription),
    myPaymentSubmissions: (query?: z.input<typeof apiContract.myPaymentSubmissions.query>) =>
      query
        ? request(apiContract.myPaymentSubmissions, { query: { ...query } })
        : request(apiContract.myPaymentSubmissions),
    createPaymentSubmission: (body: z.input<typeof apiContract.createPaymentSubmission.body>) =>
      request(apiContract.createPaymentSubmission, { body }),
    myPaymentSubmission: (submissionId: string) =>
      request(apiContract.myPaymentSubmission, { params: { submissionId } }),
    updatePaymentSubmission: (
      submissionId: string,
      body: z.input<typeof apiContract.updatePaymentSubmission.body>,
    ) => request(apiContract.updatePaymentSubmission, { params: { submissionId }, body }),
    deletePaymentDraft: (
      submissionId: string,
      body: z.input<typeof apiContract.deletePaymentDraft.body>,
    ) => request(apiContract.deletePaymentDraft, { params: { submissionId }, body }),
    uploadPaymentProof: (submissionId: string, file: Blob, filename: string) =>
      upload(apiContract.uploadPaymentProof, file, { params: { submissionId }, filename }),
    myPaymentProofAccess: (submissionId: string) =>
      request(apiContract.myPaymentProofAccess, { params: { submissionId } }),
    submitPaymentSubmission: (
      submissionId: string,
      body: z.input<typeof apiContract.submitPaymentSubmission.body>,
    ) => request(apiContract.submitPaymentSubmission, { params: { submissionId }, body }),
    cancelPaymentSubmission: (
      submissionId: string,
      body: z.input<typeof apiContract.cancelPaymentSubmission.body>,
    ) => request(apiContract.cancelPaymentSubmission, { params: { submissionId }, body }),
    resubmitPaymentSubmission: (
      submissionId: string,
      body: z.input<typeof apiContract.resubmitPaymentSubmission.body>,
    ) => request(apiContract.resubmitPaymentSubmission, { params: { submissionId }, body }),
    adminMe: () => request(apiContract.adminMe),
    adminOverview: () => request(apiContract.adminOverview),
    adminUsers: (query?: z.input<typeof apiContract.adminUsers.query>) =>
      query
        ? request(apiContract.adminUsers, { query: { ...query } })
        : request(apiContract.adminUsers),
    adminUser: (userId: string) => request(apiContract.adminUser, { params: { userId } }),
    suspendAdminUser: (userId: string, body: z.input<typeof apiContract.adminSuspendUser.body>) =>
      request(apiContract.adminSuspendUser, { params: { userId }, body }),
    restoreAdminUser: (userId: string, body: z.input<typeof apiContract.adminRestoreUser.body>) =>
      request(apiContract.adminRestoreUser, { params: { userId }, body }),
    revokeAdminUserSessions: (
      userId: string,
      body: z.input<typeof apiContract.adminRevokeUserSessions.body>,
    ) => request(apiContract.adminRevokeUserSessions, { params: { userId }, body }),
    adminAudit: (query?: z.input<typeof apiContract.adminAudit.query>) =>
      query
        ? request(apiContract.adminAudit, { query: { ...query } })
        : request(apiContract.adminAudit),
    adminPaymentMethods: () => request(apiContract.adminPaymentMethods),
    createAdminPaymentMethod: (body: z.input<typeof apiContract.createAdminPaymentMethod.body>) =>
      request(apiContract.createAdminPaymentMethod, { body }),
    adminPaymentMethod: (paymentMethodId: string) =>
      request(apiContract.adminPaymentMethod, { params: { paymentMethodId } }),
    updateAdminPaymentMethod: (
      paymentMethodId: string,
      body: z.input<typeof apiContract.updateAdminPaymentMethod.body>,
    ) => request(apiContract.updateAdminPaymentMethod, { params: { paymentMethodId }, body }),
    enableAdminPaymentMethod: (
      paymentMethodId: string,
      body: z.input<typeof apiContract.enableAdminPaymentMethod.body>,
    ) => request(apiContract.enableAdminPaymentMethod, { params: { paymentMethodId }, body }),
    disableAdminPaymentMethod: (
      paymentMethodId: string,
      body: z.input<typeof apiContract.disableAdminPaymentMethod.body>,
    ) => request(apiContract.disableAdminPaymentMethod, { params: { paymentMethodId }, body }),
    archiveAdminPaymentMethod: (
      paymentMethodId: string,
      body: z.input<typeof apiContract.archiveAdminPaymentMethod.body>,
    ) => request(apiContract.archiveAdminPaymentMethod, { params: { paymentMethodId }, body }),
    uploadAdminPaymentMethodQr: (paymentMethodId: string, file: Blob, filename: string) =>
      upload(apiContract.uploadAdminPaymentMethodQr, file, {
        params: { paymentMethodId },
        filename,
      }),
    adminPaymentSubmissions: (query?: z.input<typeof apiContract.adminPaymentSubmissions.query>) =>
      query
        ? request(apiContract.adminPaymentSubmissions, { query: { ...query } })
        : request(apiContract.adminPaymentSubmissions),
    adminPaymentSubmission: (submissionId: string) =>
      request(apiContract.adminPaymentSubmission, { params: { submissionId } }),
    adminPaymentProofAccess: (submissionId: string) =>
      request(apiContract.adminPaymentProofAccess, { params: { submissionId } }),
    startPaymentReview: (
      submissionId: string,
      body: z.input<typeof apiContract.startPaymentReview.body>,
    ) => request(apiContract.startPaymentReview, { params: { submissionId }, body }),
    requestPaymentInformation: (
      submissionId: string,
      body: z.input<typeof apiContract.requestPaymentInformation.body>,
    ) => request(apiContract.requestPaymentInformation, { params: { submissionId }, body }),
    approvePaymentSubmission: (
      submissionId: string,
      body: z.input<typeof apiContract.approvePaymentSubmission.body>,
    ) => request(apiContract.approvePaymentSubmission, { params: { submissionId }, body }),
    rejectPaymentSubmission: (
      submissionId: string,
      body: z.input<typeof apiContract.rejectPaymentSubmission.body>,
    ) => request(apiContract.rejectPaymentSubmission, { params: { submissionId }, body }),
    recordPaymentRefund: (
      submissionId: string,
      body: z.input<typeof apiContract.recordPaymentRefund.body>,
    ) => request(apiContract.recordPaymentRefund, { params: { submissionId }, body }),
    reversePaymentApproval: (
      submissionId: string,
      body: z.input<typeof apiContract.reversePaymentApproval.body>,
    ) => request(apiContract.reversePaymentApproval, { params: { submissionId }, body }),
    adminSubscriptions: (query?: z.input<typeof apiContract.adminSubscriptions.query>) =>
      query
        ? request(apiContract.adminSubscriptions, { query: { ...query } })
        : request(apiContract.adminSubscriptions),
    adminSubscription: (subscriptionId: string) =>
      request(apiContract.adminSubscription, { params: { subscriptionId } }),
    correctAdminSubscription: (
      subscriptionId: string,
      body: z.input<typeof apiContract.correctAdminSubscription.body>,
    ) => request(apiContract.correctAdminSubscription, { params: { subscriptionId }, body }),
    adminSecurity: () => request(apiContract.adminSecurity),
    careerProfiles: () => request(apiContract.careerProfiles),
    createCareerProfile: (body: z.input<typeof apiContract.createCareerProfile.body>) =>
      request(apiContract.createCareerProfile, { body }),
    careerProfile: (profileId: string) =>
      request(apiContract.careerProfile, { params: { profileId } }),
    updateCareerProfile: (
      profileId: string,
      body: z.input<typeof apiContract.updateCareerProfile.body>,
    ) => request(apiContract.updateCareerProfile, { params: { profileId }, body }),
    deleteCareerProfile: (profileId: string) =>
      request(apiContract.deleteCareerProfile, { params: { profileId } }),
    setPrimaryCareerProfile: (profileId: string) =>
      request(apiContract.setPrimaryCareerProfile, { params: { profileId } }),
    setCareerProfileStatus: (
      profileId: string,
      body: z.input<typeof apiContract.setCareerProfileStatus.body>,
    ) => request(apiContract.setCareerProfileStatus, { params: { profileId }, body }),
    upsertCareerRecord: (
      profileId: string,
      body: z.input<typeof apiContract.upsertCareerRecord.body>,
    ) => request(apiContract.upsertCareerRecord, { params: { profileId }, body }),
    deleteCareerRecord: (profileId: string, recordKind: string, recordId: string) =>
      request(apiContract.deleteCareerRecord, { params: { profileId, recordKind, recordId } }),
    careerFacts: (profileId: string, query?: z.input<typeof apiContract.careerFacts.query>) =>
      query
        ? request(apiContract.careerFacts, { params: { profileId }, query: { ...query } })
        : request(apiContract.careerFacts, { params: { profileId } }),
    recordCareerFacts: (
      profileId: string,
      body: z.input<typeof apiContract.recordCareerFacts.body>,
    ) => request(apiContract.recordCareerFacts, { params: { profileId }, body }),
    decideCareerFact: (factId: string, body: z.input<typeof apiContract.decideCareerFact.body>) =>
      request(apiContract.decideCareerFact, { params: { factId }, body }),
    confirmedCareerEvidence: (profileId: string) =>
      request(apiContract.confirmedCareerEvidence, { params: { profileId } }),
    careerDocuments: () => request(apiContract.careerDocuments),
    uploadCareerDocument: (
      file: Blob,
      filename: string,
      query: z.input<typeof apiContract.uploadCareerDocument.query>,
    ) => upload(apiContract.uploadCareerDocument, file, { params: {}, filename, query }),
    careerDocument: (documentId: string) =>
      request(apiContract.careerDocument, { params: { documentId } }),
    deleteCareerDocument: (documentId: string) =>
      request(apiContract.deleteCareerDocument, { params: { documentId } }),
    careerDocumentAccess: (documentId: string) =>
      request(apiContract.careerDocumentPreview, { params: { documentId } }),
    careerDocumentExtraction: (documentId: string) =>
      request(apiContract.careerDocumentExtraction, { params: { documentId } }),
    applyCareerDocumentExtraction: (
      documentId: string,
      body: z.input<typeof apiContract.applyCareerDocumentExtraction.body>,
    ) => request(apiContract.applyCareerDocumentExtraction, { params: { documentId }, body }),
    setOnboardingStatus: (body: z.input<typeof apiContract.setOnboardingStatus.body>) =>
      request(apiContract.setOnboardingStatus, { body }),
  });
}

export type HanaplyApiClient = ReturnType<typeof createApiClient>;
