import type { ApiEnvironment } from '@hanaply/config';
import {
  apiContract,
  subscriptionDetailSchema,
  type AdminPaymentSubmission,
  type PaymentSubmission,
  type SubscriptionDetail,
} from '@hanaply/contracts';
import { EntitlementConfigurationError, evaluateEntitlements } from '@hanaply/entitlements';
import { Inject, Injectable } from '@nestjs/common';

import { AppError } from './app-error.js';
import type { AuthenticatedRequest } from './http.js';
import {
  paymentMethodQrObjectPath,
  paymentProofObjectPath,
  readSinglePaymentImage,
  validateAndSanitizePaymentImage,
} from './payment-files.js';
import { PaymentRepository, type SubscriptionRecord } from './payment.repository.js';
import { HanaplyRepository } from './repository.js';
import { API_ENVIRONMENT } from './tokens.js';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PaymentRepository) private readonly payments: PaymentRepository,
    @Inject(HanaplyRepository) private readonly repository: HanaplyRepository,
  ) {}

  private requireAuthentication(request: AuthenticatedRequest) {
    if (!request.auth) {
      throw new AppError({
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
        message: 'Authentication is required',
      });
    }
    return request.auth;
  }

  private requireAdministrator(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    if (!auth.roles || !auth.permissions) {
      throw new AppError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Administrator access is required',
      });
    }
    return auth;
  }

  private notFound(resource: 'Payment' | 'Payment method' | 'Subscription'): never {
    throw new AppError({ code: 'NOT_FOUND', status: 404, message: `${resource} was not found` });
  }

  private async subscriptionDetail(record: SubscriptionRecord): Promise<SubscriptionDetail> {
    const plan = await this.repository.getPlanEntitlementSnapshot(record.planId);
    try {
      const entitlements = evaluateEntitlements({
        subscription: {
          planCode: record.detail.planCode,
          status: record.detail.status,
          startsAt: record.detail.startsAt,
          endsAt: record.detail.endsAt,
        },
        plan,
      });
      return subscriptionDetailSchema.parse({ ...record.detail, entitlements });
    } catch (error) {
      if (error instanceof EntitlementConfigurationError) {
        throw new AppError({
          code: 'SERVICE_UNAVAILABLE',
          status: 503,
          message: 'Entitlement configuration is unavailable',
        });
      }
      throw error;
    }
  }

  async paymentMethods(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    return this.payments.listPaymentMethods(auth.accessToken, auth.userId);
  }

  async mySubscription(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    const record = await this.payments.getMySubscriptionRecord(auth.accessToken, auth.userId);
    return record ? this.subscriptionDetail(record) : null;
  }

  async myPayments(request: AuthenticatedRequest, query: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.myPaymentSubmissions.query.parse(query);
    return this.payments.listMyPayments(auth.accessToken, auth.userId, parsed);
  }

  async myPayment(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.myPaymentSubmission.params.parse(params);
    return (
      (await this.payments.getMyPayment(auth.accessToken, auth.userId, parsed.submissionId)) ??
      this.notFound('Payment')
    );
  }

  async createPayment(request: AuthenticatedRequest, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.createPaymentSubmission.body.parse(body);
    const submissionId = await this.payments.createPaymentDraft(auth.userId, parsed, request.id);
    return (
      (await this.payments.getMyPayment(auth.accessToken, auth.userId, submissionId)) ??
      this.notFound('Payment')
    );
  }

  async updatePayment(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsedParams = apiContract.updatePaymentSubmission.params.parse(params);
    const parsedBody = apiContract.updatePaymentSubmission.body.parse(body);
    await this.payments.updatePaymentDraft(
      auth.userId,
      parsedParams.submissionId,
      parsedBody,
      request.id,
    );
    return (
      (await this.payments.getMyPayment(
        auth.accessToken,
        auth.userId,
        parsedParams.submissionId,
      )) ?? this.notFound('Payment')
    );
  }

  async cancelPayment(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsedParams = apiContract.cancelPaymentSubmission.params.parse(params);
    const parsedBody = apiContract.cancelPaymentSubmission.body.parse(body);
    await this.payments.cancelPayment(
      auth.userId,
      parsedParams.submissionId,
      parsedBody.expectedVersion,
      request.id,
    );
    return (
      (await this.payments.getMyPayment(
        auth.accessToken,
        auth.userId,
        parsedParams.submissionId,
      )) ?? this.notFound('Payment')
    );
  }

  async submitPayment(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsedParams = apiContract.submitPaymentSubmission.params.parse(params);
    const parsedBody = apiContract.submitPaymentSubmission.body.parse(body);
    await this.payments.submitPayment(
      auth.userId,
      parsedParams.submissionId,
      parsedBody.expectedVersion,
      parsedBody.declarationAccepted,
      request.id,
    );
    return (
      (await this.payments.getMyPayment(
        auth.accessToken,
        auth.userId,
        parsedParams.submissionId,
      )) ?? this.notFound('Payment')
    );
  }

  async resubmitPayment(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsedParams = apiContract.resubmitPaymentSubmission.params.parse(params);
    const parsedBody = apiContract.resubmitPaymentSubmission.body.parse(body);
    await this.payments.resubmitPayment(
      auth.userId,
      parsedParams.submissionId,
      parsedBody.expectedVersion,
      parsedBody.response,
      parsedBody.declarationAccepted,
      request.id,
    );
    return (
      (await this.payments.getMyPayment(
        auth.accessToken,
        auth.userId,
        parsedParams.submissionId,
      )) ?? this.notFound('Payment')
    );
  }

  async uploadPaymentProof(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.uploadPaymentProof.params.parse(params);
    const payment = await this.payments.getMyPayment(
      auth.accessToken,
      auth.userId,
      parsed.submissionId,
    );
    if (!payment) this.notFound('Payment');
    if (!['draft', 'needs_information'].includes(payment.status)) {
      throw new AppError({
        code: 'CONFLICT',
        status: 409,
        message: 'Proof cannot be replaced in the current payment state',
      });
    }
    const upload = await readSinglePaymentImage(request, this.environment.PAYMENT_PROOF_MAX_BYTES);
    const image = await validateAndSanitizePaymentImage(upload, {
      maximumBytes: this.environment.PAYMENT_PROOF_MAX_BYTES,
      maximumPixels: this.environment.PAYMENT_IMAGE_MAX_PIXELS,
    });
    const objectPath = paymentProofObjectPath(auth.userId, parsed.submissionId, image.extension);
    await this.payments.attachPaymentProof(
      auth.userId,
      parsed.submissionId,
      objectPath,
      image,
      request.id,
    );
    const updated = await this.payments.getMyPayment(
      auth.accessToken,
      auth.userId,
      parsed.submissionId,
    );
    if (!updated?.proof) this.notFound('Payment');
    return updated.proof;
  }

  async myPaymentProofAccess(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.myPaymentProofAccess.params.parse(params);
    return this.payments.paymentProofAccess(auth.userId, parsed.submissionId, false);
  }

  async adminPaymentMethods(request: AuthenticatedRequest) {
    const auth = this.requireAdministrator(request);
    return this.payments.listAdminPaymentMethods(auth.userId);
  }

  async adminPaymentMethod(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminPaymentMethod.params.parse(params);
    return (
      (await this.payments.getAdminPaymentMethod(auth.userId, parsed.paymentMethodId)) ??
      this.notFound('Payment method')
    );
  }

  async createAdminPaymentMethod(request: AuthenticatedRequest, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.createAdminPaymentMethod.body.parse(body);
    return this.payments.createAdminPaymentMethod(auth.userId, parsed, request.id);
  }

  async updateAdminPaymentMethod(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.updateAdminPaymentMethod.params.parse(params);
    const parsedBody = apiContract.updateAdminPaymentMethod.body.parse(body);
    return this.payments.updateAdminPaymentMethod(
      auth.userId,
      parsedParams.paymentMethodId,
      parsedBody,
      request.id,
    );
  }

  async setAdminPaymentMethodState(
    request: AuthenticatedRequest,
    params: unknown,
    body: unknown,
    action: 'enable' | 'disable' | 'archive',
  ) {
    const auth = this.requireAdministrator(request);
    const contract =
      action === 'enable'
        ? apiContract.enableAdminPaymentMethod
        : action === 'disable'
          ? apiContract.disableAdminPaymentMethod
          : apiContract.archiveAdminPaymentMethod;
    const parsedParams = contract.params.parse(params);
    const parsedBody = contract.body.parse(body);
    return this.payments.setAdminPaymentMethodState(
      auth.userId,
      parsedParams.paymentMethodId,
      action,
      parsedBody,
      request.id,
    );
  }

  async uploadAdminPaymentMethodQr(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.uploadAdminPaymentMethodQr.params.parse(params);
    const method = await this.payments.getAdminPaymentMethod(auth.userId, parsed.paymentMethodId);
    if (!method) this.notFound('Payment method');
    if (method.archivedAt) {
      throw new AppError({
        code: 'CONFLICT',
        status: 409,
        message: 'Archived payment methods cannot receive a QR image',
      });
    }
    const upload = await readSinglePaymentImage(request, this.environment.PAYMENT_QR_MAX_BYTES);
    const image = await validateAndSanitizePaymentImage(upload, {
      maximumBytes: this.environment.PAYMENT_QR_MAX_BYTES,
      maximumPixels: this.environment.PAYMENT_IMAGE_MAX_PIXELS,
    });
    const objectPath = paymentMethodQrObjectPath(parsed.paymentMethodId, image.extension);
    return this.payments.attachPaymentMethodQr(
      auth.userId,
      parsed.paymentMethodId,
      objectPath,
      image,
      request.id,
    );
  }

  async adminPayments(request: AuthenticatedRequest, query: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminPaymentSubmissions.query.parse(query);
    return this.payments.listAdminPayments(auth.userId, parsed);
  }

  async adminPayment(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminPaymentSubmission.params.parse(params);
    return (
      (await this.payments.getAdminPayment(auth.userId, parsed.submissionId)) ??
      this.notFound('Payment')
    );
  }

  async adminPaymentProofAccess(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminPaymentProofAccess.params.parse(params);
    return this.payments.paymentProofAccess(auth.userId, parsed.submissionId, true);
  }

  async startReview(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.startPaymentReview.params.parse(params);
    const parsedBody = apiContract.startPaymentReview.body.parse(body);
    return this.payments.startReview(
      auth.userId,
      parsedParams.submissionId,
      parsedBody.expectedVersion,
      request.id,
    );
  }

  async requestInformation(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.requestPaymentInformation.params.parse(params);
    const parsedBody = apiContract.requestPaymentInformation.body.parse(body);
    return this.payments.requestInformation(
      auth.userId,
      parsedParams.submissionId,
      parsedBody,
      request.id,
    );
  }

  async approvePayment(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.approvePaymentSubmission.params.parse(params);
    const parsedBody = apiContract.approvePaymentSubmission.body.parse(body);
    const submission = await this.payments.approvePayment(
      auth.userId,
      parsedParams.submissionId,
      parsedBody,
      request.id,
    );
    if (!submission.subscriptionId) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'Approved subscription result is unavailable',
      });
    }
    const record = await this.payments.getAdminSubscriptionRecord(
      auth.userId,
      submission.subscriptionId,
    );
    if (!record) this.notFound('Subscription');
    return { submission, subscription: await this.subscriptionDetail(record) };
  }

  async rejectPayment(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.rejectPaymentSubmission.params.parse(params);
    const parsedBody = apiContract.rejectPaymentSubmission.body.parse(body);
    return this.payments.rejectPayment(
      auth.userId,
      parsedParams.submissionId,
      parsedBody,
      request.id,
    );
  }

  async recordRefund(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.recordPaymentRefund.params.parse(params);
    const parsedBody = apiContract.recordPaymentRefund.body.parse(body);
    return this.payments.recordRefund(
      auth.userId,
      parsedParams.submissionId,
      parsedBody,
      request.id,
    );
  }

  async reverseApproval(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.reversePaymentApproval.params.parse(params);
    const parsedBody = apiContract.reversePaymentApproval.body.parse(body);
    return this.payments.reverseApproval(
      auth.userId,
      parsedParams.submissionId,
      parsedBody,
      request.id,
    );
  }

  async adminSubscriptions(request: AuthenticatedRequest, query: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminSubscriptions.query.parse(query);
    return this.payments.listAdminSubscriptions(auth.userId, parsed);
  }

  async adminSubscription(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminSubscription.params.parse(params);
    const record = await this.payments.getAdminSubscriptionRecord(
      auth.userId,
      parsed.subscriptionId,
    );
    if (!record) this.notFound('Subscription');
    return this.subscriptionDetail(record);
  }

  async correctSubscription(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.correctAdminSubscription.params.parse(params);
    const parsedBody = apiContract.correctAdminSubscription.body.parse(body);
    await this.payments.correctSubscription(
      auth.userId,
      parsedParams.subscriptionId,
      parsedBody,
      request.id,
    );
    const record = await this.payments.getAdminSubscriptionRecord(
      auth.userId,
      parsedParams.subscriptionId,
    );
    if (!record) this.notFound('Subscription');
    return this.subscriptionDetail(record);
  }

  static paymentAllowsProofUpload(payment: PaymentSubmission | AdminPaymentSubmission): boolean {
    return payment.status === 'draft' || payment.status === 'needs_information';
  }
}
