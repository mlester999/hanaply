import { apiContract } from '@hanaply/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  AdminAuthorizationGuard,
  RequireAllPermissions,
  RequirePermission,
  SupabaseAuthGuard,
} from './auth.js';
import { successEnvelope, type AuthenticatedRequest } from './http.js';
import { PaymentService } from './payment.service.js';

function routePath(path: string): string {
  return path
    .replace('{submissionId}', ':submissionId')
    .replace('{paymentMethodId}', ':paymentMethodId')
    .replace('{subscriptionId}', ':subscriptionId');
}

@Controller()
@UseGuards(SupabaseAuthGuard)
export class CustomerPaymentController {
  constructor(@Inject(PaymentService) private readonly service: PaymentService) {}

  @Get(apiContract.paymentMethods.path)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async paymentMethods(@Req() request: AuthenticatedRequest) {
    return apiContract.paymentMethods.response.parse(
      successEnvelope(request, await this.service.paymentMethods(request)),
    );
  }

  @Get(apiContract.mySubscription.path)
  async subscription(@Req() request: AuthenticatedRequest) {
    return apiContract.mySubscription.response.parse(
      successEnvelope(request, await this.service.mySubscription(request)),
    );
  }

  @Get(apiContract.myPaymentSubmissions.path)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async payments(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return apiContract.myPaymentSubmissions.response.parse(
      successEnvelope(request, await this.service.myPayments(request, query)),
    );
  }

  @Post(apiContract.createPaymentSubmission.path)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async createPayment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return apiContract.createPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.createPayment(request, body)),
    );
  }

  @Get(routePath(apiContract.myPaymentSubmission.path))
  async payment(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.myPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.myPayment(request, params)),
    );
  }

  @Patch(routePath(apiContract.updatePaymentSubmission.path))
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async updatePayment(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.updatePaymentSubmission.response.parse(
      successEnvelope(request, await this.service.updatePayment(request, params, body)),
    );
  }

  @Delete(routePath(apiContract.deletePaymentDraft.path))
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async deleteDraft(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.deletePaymentDraft.response.parse(
      successEnvelope(request, await this.service.cancelPayment(request, params, body)),
    );
  }

  @Post(routePath(apiContract.uploadPaymentProof.path))
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async uploadProof(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.uploadPaymentProof.response.parse(
      successEnvelope(request, await this.service.uploadPaymentProof(request, params)),
    );
  }

  @Get(routePath(apiContract.myPaymentProofAccess.path))
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async proofAccess(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.myPaymentProofAccess.response.parse(
      successEnvelope(request, await this.service.myPaymentProofAccess(request, params)),
    );
  }

  @Post(routePath(apiContract.submitPaymentSubmission.path))
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async submitPayment(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.submitPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.submitPayment(request, params, body)),
    );
  }

  @Post(routePath(apiContract.cancelPaymentSubmission.path))
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async cancelPayment(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.cancelPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.cancelPayment(request, params, body)),
    );
  }

  @Post(routePath(apiContract.resubmitPaymentSubmission.path))
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async resubmitPayment(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.resubmitPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.resubmitPayment(request, params, body)),
    );
  }
}

@Controller()
@UseGuards(SupabaseAuthGuard, AdminAuthorizationGuard)
export class AdminPaymentController {
  constructor(@Inject(PaymentService) private readonly service: PaymentService) {}

  @Get(apiContract.adminPaymentMethods.path)
  @RequirePermission('payment_methods.read')
  async paymentMethods(@Req() request: AuthenticatedRequest) {
    return apiContract.adminPaymentMethods.response.parse(
      successEnvelope(request, await this.service.adminPaymentMethods(request)),
    );
  }

  @Post(apiContract.createAdminPaymentMethod.path)
  @HttpCode(200)
  @RequirePermission('payment_methods.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async createPaymentMethod(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return apiContract.createAdminPaymentMethod.response.parse(
      successEnvelope(request, await this.service.createAdminPaymentMethod(request, body)),
    );
  }

  @Get(routePath(apiContract.adminPaymentMethod.path))
  @RequirePermission('payment_methods.read')
  async paymentMethod(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.adminPaymentMethod.response.parse(
      successEnvelope(request, await this.service.adminPaymentMethod(request, params)),
    );
  }

  @Patch(routePath(apiContract.updateAdminPaymentMethod.path))
  @RequirePermission('payment_methods.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async updatePaymentMethod(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.updateAdminPaymentMethod.response.parse(
      successEnvelope(request, await this.service.updateAdminPaymentMethod(request, params, body)),
    );
  }

  @Post(routePath(apiContract.enableAdminPaymentMethod.path))
  @HttpCode(200)
  @RequirePermission('payment_methods.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async enablePaymentMethod(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.enableAdminPaymentMethod.response.parse(
      successEnvelope(
        request,
        await this.service.setAdminPaymentMethodState(request, params, body, 'enable'),
      ),
    );
  }

  @Post(routePath(apiContract.disableAdminPaymentMethod.path))
  @HttpCode(200)
  @RequirePermission('payment_methods.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async disablePaymentMethod(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.disableAdminPaymentMethod.response.parse(
      successEnvelope(
        request,
        await this.service.setAdminPaymentMethodState(request, params, body, 'disable'),
      ),
    );
  }

  @Post(routePath(apiContract.archiveAdminPaymentMethod.path))
  @HttpCode(200)
  @RequirePermission('payment_methods.manage')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async archivePaymentMethod(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.archiveAdminPaymentMethod.response.parse(
      successEnvelope(
        request,
        await this.service.setAdminPaymentMethodState(request, params, body, 'archive'),
      ),
    );
  }

  @Post(routePath(apiContract.uploadAdminPaymentMethodQr.path))
  @HttpCode(200)
  @RequirePermission('payment_methods.manage')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async uploadPaymentMethodQr(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.uploadAdminPaymentMethodQr.response.parse(
      successEnvelope(request, await this.service.uploadAdminPaymentMethodQr(request, params)),
    );
  }

  @Get(apiContract.adminPaymentSubmissions.path)
  @RequirePermission('payments.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async payments(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return apiContract.adminPaymentSubmissions.response.parse(
      successEnvelope(request, await this.service.adminPayments(request, query)),
    );
  }

  @Get(routePath(apiContract.adminPaymentSubmission.path))
  @RequirePermission('payments.read')
  async payment(@Req() request: AuthenticatedRequest, @Param() params: Record<string, unknown>) {
    return apiContract.adminPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.adminPayment(request, params)),
    );
  }

  @Get(routePath(apiContract.adminPaymentProofAccess.path))
  @RequirePermission('payments.review')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async proofAccess(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.adminPaymentProofAccess.response.parse(
      successEnvelope(request, await this.service.adminPaymentProofAccess(request, params)),
    );
  }

  @Post(routePath(apiContract.startPaymentReview.path))
  @HttpCode(200)
  @RequirePermission('payments.review')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async startReview(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.startPaymentReview.response.parse(
      successEnvelope(request, await this.service.startReview(request, params, body)),
    );
  }

  @Post(routePath(apiContract.requestPaymentInformation.path))
  @HttpCode(200)
  @RequirePermission('payments.review')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async requestInformation(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.requestPaymentInformation.response.parse(
      successEnvelope(request, await this.service.requestInformation(request, params, body)),
    );
  }

  @Post(routePath(apiContract.approvePaymentSubmission.path))
  @HttpCode(200)
  @RequirePermission('payments.review')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async approvePayment(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.approvePaymentSubmission.response.parse(
      successEnvelope(request, await this.service.approvePayment(request, params, body)),
    );
  }

  @Post(routePath(apiContract.rejectPaymentSubmission.path))
  @HttpCode(200)
  @RequirePermission('payments.review')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async rejectPayment(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.rejectPaymentSubmission.response.parse(
      successEnvelope(request, await this.service.rejectPayment(request, params, body)),
    );
  }

  @Post(routePath(apiContract.recordPaymentRefund.path))
  @HttpCode(200)
  @RequireAllPermissions('payments.review', 'subscriptions.manage')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async recordRefund(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.recordPaymentRefund.response.parse(
      successEnvelope(request, await this.service.recordRefund(request, params, body)),
    );
  }

  @Post(routePath(apiContract.reversePaymentApproval.path))
  @HttpCode(200)
  @RequireAllPermissions('payments.review', 'subscriptions.manage')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async reverseApproval(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.reversePaymentApproval.response.parse(
      successEnvelope(request, await this.service.reverseApproval(request, params, body)),
    );
  }

  @Get(apiContract.adminSubscriptions.path)
  @RequirePermission('subscriptions.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async subscriptions(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return apiContract.adminSubscriptions.response.parse(
      successEnvelope(request, await this.service.adminSubscriptions(request, query)),
    );
  }

  @Get(routePath(apiContract.adminSubscription.path))
  @RequirePermission('subscriptions.read')
  async subscription(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
  ) {
    return apiContract.adminSubscription.response.parse(
      successEnvelope(request, await this.service.adminSubscription(request, params)),
    );
  }

  @Post(routePath(apiContract.correctAdminSubscription.path))
  @HttpCode(200)
  @RequirePermission('subscriptions.manage')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async correctSubscription(
    @Req() request: AuthenticatedRequest,
    @Param() params: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return apiContract.correctAdminSubscription.response.parse(
      successEnvelope(request, await this.service.correctSubscription(request, params, body)),
    );
  }
}
