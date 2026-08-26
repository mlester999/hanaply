import type { ApiEnvironment } from '@hanaply/config';
import {
  adminPaymentMethodSchema,
  adminPaymentSubmissionSchema,
  paymentMethodSchema,
  paymentMethodSnapshotSchema,
  paymentProofSchema,
  paymentSubmissionSchema,
  type AdminPaymentMethod,
  type AdminPaymentSubmission,
  type AdminVersionedActionInput,
  type ApprovePaymentInput,
  type CorrectSubscriptionInput,
  type CreatePaymentDraftInput,
  type PaymentMethod,
  type PaymentMethodMutationInput,
  type PaymentQueueQuery,
  type PaymentSubmission,
  type RecordPaymentRefundInput,
  type RejectPaymentInput,
  type RequestPaymentInformationInput,
  type ReversePaymentInput,
  type SubscriptionDetail,
  type UpdatePaymentDraftInput,
  type UpdatePaymentMethodInput,
} from '@hanaply/contracts';
import {
  createPublicDatabaseClient,
  createServiceDatabaseClient,
  createUserDatabaseClient,
  type Database,
  type Json,
} from '@hanaply/database';
import { Inject, Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';

import { AppError } from './app-error.js';
import type { ValidatedPaymentImage } from './payment-files.js';
import { API_ENVIRONMENT } from './tokens.js';

type PaymentMethodRow = Database['public']['Tables']['payment_methods']['Row'];
type PaymentMethodVersionRow = Database['public']['Tables']['payment_method_versions']['Row'];
type PaymentSubmissionRow = Database['public']['Tables']['payment_submissions']['Row'];
type PaymentFileRow = Database['public']['Tables']['payment_submission_files']['Row'];
type PaymentEventRow = Database['public']['Tables']['payment_submission_events']['Row'];
type PaymentFlagRow = Database['public']['Tables']['payment_review_flags']['Row'];
type PlanRow = Database['public']['Tables']['plans']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];
type SubscriptionEventRow = Database['public']['Tables']['subscription_events']['Row'];

type PaymentMethodDetail = AdminPaymentMethod & {
  versions: readonly {
    id: string;
    version: number;
    changeType: string;
    changedBy: string | null;
    snapshot: Record<string, unknown>;
    createdAt: string;
  }[];
};

export interface Page<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SubscriptionRecord {
  detail: Omit<SubscriptionDetail, 'entitlements'>;
  planId: string;
}

interface MyPaymentQuery {
  status?: PaymentSubmission['status'] | undefined;
  page: number;
  pageSize: number;
}

interface AdminSubscriptionQuery {
  status?: string | undefined;
  planCode?: string | undefined;
  userSearch?: string | undefined;
  expiringBefore?: string | undefined;
  page: number;
  pageSize: number;
}

const customerPaymentMethodColumns =
  'id, display_name, method_type, display_order, currency, account_holder_name, account_identifier, bank_name, branch_details, public_instructions, public_notes, qr_version, effective_start_at, effective_end_at, minimum_amount_minor, maximum_amount_minor, version';
const customerPaymentColumns =
  'id, user_id, plan_id, billing_period, quoted_amount_minor, currency, payment_method_id, payment_method_snapshot, original_reference, paid_at, user_note, information_response, proof_file_id, status, submitted_at, review_started_at, reviewed_at, public_review_message, rejection_reason_code, subscription_id, declaration_accepted_at, version, created_at, updated_at';
const customerProofColumns =
  'id, submission_id, checksum_sha256, mime_type, size_bytes, original_filename, width, height, created_at';
const customerPaymentEventColumns =
  'id, submission_id, event_type, previous_status, new_status, public_message, created_at';
const customerSubscriptionColumns =
  'id, user_id, plan_id, status, starts_at, ends_at, source, version, created_at, updated_at';
const customerSubscriptionEventColumns =
  'id, subscription_id, user_id, event_type, effective_at, reason, created_at';

function configurationError(message: string): AppError {
  return new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message });
}

function paymentRpcError(error: { code?: string; message: string }, fallback: string): AppError {
  if (error.code === '42501') {
    return new AppError({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Payment action is not permitted',
    });
  }
  if (error.code === 'P0002') {
    return new AppError({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Payment record was not found',
    });
  }
  if (error.code === '40001' || error.code === '23505') {
    return new AppError({
      code: 'CONFLICT',
      status: 409,
      message: 'Payment record changed. Refresh and try again.',
    });
  }
  if (error.code === '22023' || error.code?.startsWith('22')) {
    return new AppError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Payment request is invalid',
    });
  }
  if (error.code?.startsWith('23')) {
    return new AppError({
      code: 'CONFLICT',
      status: 409,
      message: 'Payment request conflicts with current records',
    });
  }
  return configurationError(fallback);
}

function parseDatabaseValue<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw configurationError(message);
  return parsed.data;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function jsonObject(value: Record<string, Json | undefined>): Json {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined),
  );
}

function page<T>(items: T[], currentPage: number, pageSize: number, total: number): Page<T> {
  return {
    items,
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

function withoutEvents<T extends { events: unknown }>(value: T): Omit<T, 'events'> {
  const { events, ...item } = value;
  void events;
  return item;
}

function withoutEventsAndFlags<T extends { events: unknown; flags: unknown }>(
  value: T,
): Omit<T, 'events' | 'flags'> {
  const { events, flags, ...item } = value;
  void events;
  void flags;
  return item;
}

function methodSnapshot(value: Json) {
  return parseDatabaseValue(
    paymentMethodSnapshotSchema,
    value,
    'Payment method snapshot is invalid',
  );
}

function mapPaymentMethod(row: PaymentMethodRow, qrCodeUrl: string | null): PaymentMethod {
  return parseDatabaseValue(
    paymentMethodSchema,
    {
      id: row.id,
      displayName: row.display_name,
      methodType: row.method_type,
      displayOrder: row.display_order,
      currency: row.currency,
      accountHolderName: row.account_holder_name,
      accountIdentifier: row.account_identifier,
      bankName: row.bank_name,
      branchDetails: row.branch_details,
      publicInstructions: row.public_instructions,
      publicNotes: row.public_notes,
      minimumAmountMinor: row.minimum_amount_minor,
      maximumAmountMinor: row.maximum_amount_minor,
      effectiveStartAt: row.effective_start_at,
      effectiveEndAt: row.effective_end_at,
      qrCodeUrl,
      qrCodeVersion: row.qr_version,
      version: row.version,
    },
    'Payment method configuration is invalid',
  );
}

function mapAdminPaymentMethod(
  row: PaymentMethodRow,
  qrCodeUrl: string | null,
): AdminPaymentMethod {
  return parseDatabaseValue(
    adminPaymentMethodSchema,
    {
      ...mapPaymentMethod(row, qrCodeUrl),
      enabled: row.enabled,
      privateNotes: row.private_notes,
      archivedAt: row.archived_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    'Administrative payment method configuration is invalid',
  );
}

function mapProof(row: PaymentFileRow, previewUrl: string | null = null) {
  return parseDatabaseValue(
    paymentProofSchema,
    {
      id: row.id,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      originalFilename: row.original_filename,
      checksumSha256: row.checksum_sha256,
      width: row.width,
      height: row.height,
      uploadedAt: row.created_at,
      previewUrl,
    },
    'Payment proof metadata is invalid',
  );
}

function mapPublicEvent(row: PaymentEventRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    publicMessage: row.public_message,
    createdAt: row.created_at,
  };
}

function mapAdminEvent(row: PaymentEventRow) {
  return {
    ...mapPublicEvent(row),
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    internalNote: row.internal_note,
    reasonCode: row.reason_code,
  };
}

function profileDisplayName(profile: ProfileRow | undefined): string | null {
  if (!profile) return null;
  if (profile.display_name) return profile.display_name;
  return `${profile.first_name} ${profile.last_name}`.trim() || null;
}

@Injectable()
export class PaymentRepository {
  private readonly publicClient;
  private readonly serviceClient;

  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {
    this.publicClient = createPublicDatabaseClient(
      environment.SUPABASE_URL,
      environment.SUPABASE_PUBLISHABLE_KEY,
    );
    this.serviceClient = createServiceDatabaseClient(
      environment.SUPABASE_URL,
      environment.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  private userClient(accessToken: string) {
    return createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
  }

  private async authorizeAdmin(actorUserId: string, permission: string): Promise<void> {
    const result = await this.serviceClient.rpc('authorize_admin_payment_access', {
      actor_user_id: actorUserId,
      required_permission: permission,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment authorization is unavailable');
  }

  private async signedObjectUrl(bucket: string, objectPath: string): Promise<string> {
    const result = await this.serviceClient.storage
      .from(bucket)
      .createSignedUrl(objectPath, this.environment.PAYMENT_SIGNED_URL_TTL_SECONDS);
    if (result.error || !result.data?.signedUrl) {
      throw configurationError('Private payment image access is unavailable');
    }
    return result.data.signedUrl;
  }

  private async resolveQrUrl(
    actorUserId: string,
    paymentMethodId: string,
    administratorAccess: boolean,
  ): Promise<string | null> {
    const resolved = await this.serviceClient.rpc('resolve_payment_method_qr_object', {
      actor_user_id: actorUserId,
      administrator_access: administratorAccess,
      target_payment_method_id: paymentMethodId,
    });
    if (resolved.error) {
      if (resolved.error.code === 'P0002') return null;
      throw paymentRpcError(resolved.error, 'Payment method QR access is unavailable');
    }
    const object = resolved.data?.[0];
    return object ? this.signedObjectUrl(object.bucket_id, object.object_path) : null;
  }

  async listPaymentMethods(accessToken: string, userId: string): Promise<PaymentMethod[]> {
    const result = await this.userClient(accessToken)
      .from('payment_methods')
      .select(customerPaymentMethodColumns)
      .order('display_order')
      .order('display_name');
    if (result.error) throw configurationError('Payment methods are unavailable');
    return Promise.all(
      (result.data ?? []).map(async (row) =>
        mapPaymentMethod(
          row as PaymentMethodRow,
          row.qr_version > 0 ? await this.resolveQrUrl(userId, row.id, false) : null,
        ),
      ),
    );
  }

  async listAdminPaymentMethods(actorUserId: string): Promise<AdminPaymentMethod[]> {
    await this.authorizeAdmin(actorUserId, 'payment_methods.read');
    const result = await this.serviceClient
      .from('payment_methods')
      .select('*')
      .order('display_order')
      .order('display_name');
    if (result.error) throw configurationError('Administrative payment methods are unavailable');
    return Promise.all(
      (result.data ?? []).map(async (row) =>
        mapAdminPaymentMethod(
          row,
          row.qr_object_path ? await this.resolveQrUrl(actorUserId, row.id, true) : null,
        ),
      ),
    );
  }

  async getAdminPaymentMethod(
    actorUserId: string,
    paymentMethodId: string,
  ): Promise<PaymentMethodDetail | null> {
    await this.authorizeAdmin(actorUserId, 'payment_methods.read');
    const [methodResult, versionResult] = await Promise.all([
      this.serviceClient
        .from('payment_methods')
        .select('*')
        .eq('id', paymentMethodId)
        .maybeSingle(),
      this.serviceClient
        .from('payment_method_versions')
        .select('*')
        .eq('payment_method_id', paymentMethodId)
        .order('version', { ascending: false }),
    ]);
    if (methodResult.error || versionResult.error) {
      throw configurationError('Administrative payment method is unavailable');
    }
    if (!methodResult.data) return null;
    const qrCodeUrl = methodResult.data.qr_object_path
      ? await this.resolveQrUrl(actorUserId, paymentMethodId, true)
      : null;
    return {
      ...mapAdminPaymentMethod(methodResult.data, qrCodeUrl),
      versions: (versionResult.data ?? []).map((version: PaymentMethodVersionRow) => ({
        id: version.id,
        version: version.version,
        changeType: version.change_type,
        changedBy: version.changed_by,
        snapshot:
          version.snapshot &&
          !Array.isArray(version.snapshot) &&
          typeof version.snapshot === 'object'
            ? version.snapshot
            : {},
        createdAt: version.created_at,
      })),
    };
  }

  private async requiredAdminPaymentMethod(actorUserId: string, paymentMethodId: string) {
    const method = await this.getAdminPaymentMethod(actorUserId, paymentMethodId);
    if (!method) {
      throw new AppError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Payment method was not found',
      });
    }
    return method;
  }

  async createAdminPaymentMethod(
    actorUserId: string,
    input: PaymentMethodMutationInput,
    requestId: string,
  ): Promise<PaymentMethodDetail> {
    const result = await this.serviceClient.rpc('admin_create_payment_method', {
      actor_user_id: actorUserId,
      requested_method: jsonObject(input),
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment method could not be created');
    return this.requiredAdminPaymentMethod(actorUserId, result.data);
  }

  async updateAdminPaymentMethod(
    actorUserId: string,
    paymentMethodId: string,
    input: UpdatePaymentMethodInput,
    requestId: string,
  ): Promise<PaymentMethodDetail> {
    const { expectedVersion, ...method } = input;
    const result = await this.serviceClient.rpc('admin_update_payment_method', {
      actor_user_id: actorUserId,
      target_payment_method_id: paymentMethodId,
      expected_version: expectedVersion,
      requested_method: jsonObject(method),
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment method could not be updated');
    return this.requiredAdminPaymentMethod(actorUserId, paymentMethodId);
  }

  async setAdminPaymentMethodState(
    actorUserId: string,
    paymentMethodId: string,
    action: 'enable' | 'disable' | 'archive',
    input: AdminVersionedActionInput,
    requestId: string,
  ): Promise<PaymentMethodDetail> {
    const result = await this.serviceClient.rpc('admin_set_payment_method_state', {
      actor_user_id: actorUserId,
      target_payment_method_id: paymentMethodId,
      expected_version: input.expectedVersion,
      requested_action: action,
      action_reason: input.reason,
      action_request_id: requestId,
    });
    if (result.error)
      throw paymentRpcError(result.error, 'Payment method state could not be changed');
    return this.requiredAdminPaymentMethod(actorUserId, paymentMethodId);
  }

  async createPaymentDraft(
    userId: string,
    input: CreatePaymentDraftInput,
    requestId: string,
  ): Promise<string> {
    const result = await this.serviceClient.rpc('create_payment_draft', {
      actor_user_id: userId,
      draft_input: jsonObject(input),
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment draft could not be created');
    return result.data;
  }

  async updatePaymentDraft(
    userId: string,
    submissionId: string,
    input: UpdatePaymentDraftInput,
    requestId: string,
  ): Promise<void> {
    const { expectedVersion, ...draft } = input;
    const result = await this.serviceClient.rpc('update_payment_draft', {
      actor_user_id: userId,
      target_submission_id: submissionId,
      expected_version: expectedVersion,
      draft_input: jsonObject(draft),
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment draft could not be updated');
  }

  async submitPayment(
    userId: string,
    submissionId: string,
    expectedVersion: number,
    declarationAccepted: true,
    requestId: string,
  ): Promise<void> {
    const result = await this.serviceClient.rpc('submit_payment_submission', {
      actor_user_id: userId,
      target_submission_id: submissionId,
      expected_version: expectedVersion,
      declaration_accepted: declarationAccepted,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment could not be submitted');
  }

  async cancelPayment(
    userId: string,
    submissionId: string,
    expectedVersion: number,
    requestId: string,
  ): Promise<void> {
    const result = await this.serviceClient.rpc('cancel_payment_submission', {
      actor_user_id: userId,
      target_submission_id: submissionId,
      expected_version: expectedVersion,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment could not be cancelled');
    const payload = result.data;
    const cleanupObjectPath =
      payload && !Array.isArray(payload) && typeof payload === 'object'
        ? payload.cleanupObjectPath
        : null;
    if (typeof cleanupObjectPath === 'string' && cleanupObjectPath) {
      await this.cleanupObject(
        this.environment.PAYMENT_PROOF_BUCKET,
        cleanupObjectPath,
        'cancelled payment draft proof',
      );
    }
  }

  async resubmitPayment(
    userId: string,
    submissionId: string,
    expectedVersion: number,
    response: string,
    declarationAccepted: true,
    requestId: string,
  ): Promise<void> {
    const result = await this.serviceClient.rpc('resubmit_payment_submission', {
      actor_user_id: userId,
      target_submission_id: submissionId,
      expected_version: expectedVersion,
      requested_response: response,
      declaration_accepted: declarationAccepted,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment could not be resubmitted');
  }

  private async loadUserPayments(
    accessToken: string,
    rows: PaymentSubmissionRow[],
    includeEvents: boolean,
  ): Promise<PaymentSubmission[]> {
    if (rows.length === 0) return [];
    const client = this.userClient(accessToken);
    const planIds = unique(rows.map((row) => row.plan_id));
    const proofIds = unique(rows.map((row) => row.proof_file_id));
    const submissionIds = rows.map((row) => row.id);
    const [plansResult, proofsResult, eventsResult] = await Promise.all([
      this.publicClient.from('plans').select('*').in('id', planIds),
      proofIds.length
        ? client.from('payment_submission_files').select(customerProofColumns).in('id', proofIds)
        : Promise.resolve({ data: [] as PaymentFileRow[], error: null }),
      includeEvents
        ? client
            .from('payment_submission_events')
            .select(customerPaymentEventColumns)
            .in('submission_id', submissionIds)
            .order('created_at')
        : Promise.resolve({ data: [] as PaymentEventRow[], error: null }),
    ]);
    if (plansResult.error || proofsResult.error || eventsResult.error) {
      throw configurationError('Payment history is unavailable');
    }
    const plans = new Map((plansResult.data ?? []).map((plan) => [plan.id, plan]));
    const proofs = new Map(
      (proofsResult.data ?? []).map((proof) => [proof.id, proof as PaymentFileRow]),
    );
    const events = new Map<string, PaymentEventRow[]>();
    for (const event of eventsResult.data ?? []) {
      const list = events.get(event.submission_id) ?? [];
      list.push(event as PaymentEventRow);
      events.set(event.submission_id, list);
    }
    return rows.map((row) => {
      const planRow = plans.get(row.plan_id);
      if (!planRow) throw configurationError('Payment plan configuration is unavailable');
      const proofRow = row.proof_file_id ? proofs.get(row.proof_file_id) : undefined;
      if (row.proof_file_id && !proofRow) {
        throw configurationError('Payment proof metadata is unavailable');
      }
      return parseDatabaseValue(
        paymentSubmissionSchema,
        {
          id: row.id,
          planCode: planRow.code,
          tierCode: planRow.tier_code,
          billingPeriod: row.billing_period,
          quotedAmountMinor: row.quoted_amount_minor,
          currency: row.currency,
          paymentMethodId: row.payment_method_id,
          paymentMethod: methodSnapshot(row.payment_method_snapshot),
          referenceNumber: row.original_reference,
          paidAt: row.paid_at,
          userNote: row.user_note,
          informationResponse: row.information_response,
          status: row.status,
          submittedAt: row.submitted_at,
          reviewStartedAt: row.review_started_at,
          reviewedAt: row.reviewed_at,
          publicReviewMessage: row.public_review_message,
          rejectionReasonCode: row.rejection_reason_code,
          proof: proofRow ? mapProof(proofRow) : null,
          subscriptionId: row.subscription_id,
          declarationAcceptedAt: row.declaration_accepted_at,
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          events: (events.get(row.id) ?? []).map(mapPublicEvent),
        },
        'Payment history is invalid',
      );
    });
  }

  async listMyPayments(
    accessToken: string,
    userId: string,
    input: MyPaymentQuery,
  ): Promise<Page<Omit<PaymentSubmission, 'events'>>> {
    const client = this.userClient(accessToken);
    const offset = (input.page - 1) * input.pageSize;
    let query = client
      .from('payment_submissions')
      .select(customerPaymentColumns, { count: 'exact' })
      .eq('user_id', userId);
    if (input.status) query = query.eq('status', input.status);
    const result = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + input.pageSize - 1);
    if (result.error) throw configurationError('Payment history is unavailable');
    const hydrated = await this.loadUserPayments(
      accessToken,
      (result.data ?? []) as PaymentSubmissionRow[],
      false,
    );
    return page(hydrated.map(withoutEvents), input.page, input.pageSize, result.count ?? 0);
  }

  async getMyPayment(
    accessToken: string,
    userId: string,
    submissionId: string,
  ): Promise<PaymentSubmission | null> {
    const result = await this.userClient(accessToken)
      .from('payment_submissions')
      .select(customerPaymentColumns)
      .eq('id', submissionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (result.error) throw configurationError('Payment submission is unavailable');
    if (!result.data) return null;
    const [payment] = await this.loadUserPayments(
      accessToken,
      [result.data as PaymentSubmissionRow],
      true,
    );
    return payment ?? null;
  }

  private async cleanupObject(bucket: string, objectPath: string, reason: string): Promise<void> {
    if (this.environment.STORAGE_CLEANUP_MODE === 'immediate') {
      const removed = await this.serviceClient.storage.from(bucket).remove([objectPath]);
      if (!removed.error) return;
    }
    const queued = await this.serviceClient.rpc('queue_storage_cleanup', {
      requested_bucket_id: bucket,
      requested_object_path: objectPath,
      requested_reason: reason,
    });
    if (queued.error) throw configurationError('Private payment image cleanup is unavailable');
  }

  private async storeImage(
    bucket: string,
    objectPath: string,
    image: ValidatedPaymentImage,
  ): Promise<void> {
    const stored = await this.serviceClient.storage.from(bucket).upload(objectPath, image.buffer, {
      cacheControl: '0',
      contentType: image.mimeType,
      upsert: false,
    });
    if (stored.error) throw configurationError('Private payment image could not be stored');
  }

  async attachPaymentProof(
    userId: string,
    submissionId: string,
    objectPath: string,
    image: ValidatedPaymentImage,
    requestId: string,
  ): Promise<void> {
    await this.storeImage(this.environment.PAYMENT_PROOF_BUCKET, objectPath, image);
    const attached = await this.serviceClient.rpc('attach_payment_proof', {
      actor_user_id: userId,
      target_submission_id: submissionId,
      requested_object_path: objectPath,
      requested_checksum_sha256: image.checksumSha256,
      requested_mime_type: image.mimeType,
      requested_size_bytes: image.sizeBytes,
      requested_original_filename: image.originalFilename,
      requested_width: image.width,
      requested_height: image.height,
      requested_scan_status: 'not_configured',
      action_request_id: requestId,
    });
    if (attached.error) {
      await this.cleanupObject(
        this.environment.PAYMENT_PROOF_BUCKET,
        objectPath,
        'unlinked payment proof after metadata failure',
      );
      throw paymentRpcError(attached.error, 'Payment proof could not be linked');
    }
    const payload = attached.data;
    const replacedObjectPath =
      payload && !Array.isArray(payload) && typeof payload === 'object'
        ? payload.replacedObjectPath
        : null;
    if (typeof replacedObjectPath === 'string' && replacedObjectPath) {
      await this.cleanupObject(
        this.environment.PAYMENT_PROOF_BUCKET,
        replacedObjectPath,
        'replaced payment proof',
      );
    }
  }

  async attachPaymentMethodQr(
    actorUserId: string,
    paymentMethodId: string,
    objectPath: string,
    image: ValidatedPaymentImage,
    requestId: string,
  ): Promise<PaymentMethodDetail> {
    await this.storeImage(this.environment.PAYMENT_QR_BUCKET, objectPath, image);
    const attached = await this.serviceClient.rpc('admin_attach_payment_method_qr', {
      actor_user_id: actorUserId,
      target_payment_method_id: paymentMethodId,
      requested_object_path: objectPath,
      requested_mime_type: image.mimeType,
      requested_checksum_sha256: image.checksumSha256,
      requested_size_bytes: image.sizeBytes,
      requested_width: image.width,
      requested_height: image.height,
      action_request_id: requestId,
    });
    if (attached.error) {
      await this.cleanupObject(
        this.environment.PAYMENT_QR_BUCKET,
        objectPath,
        'unlinked payment method QR after metadata failure',
      );
      throw paymentRpcError(attached.error, 'Payment method QR could not be linked');
    }
    const payload = attached.data;
    const replacedObjectPath =
      payload && !Array.isArray(payload) && typeof payload === 'object'
        ? payload.replacedObjectPath
        : null;
    if (typeof replacedObjectPath === 'string' && replacedObjectPath) {
      await this.cleanupObject(
        this.environment.PAYMENT_QR_BUCKET,
        replacedObjectPath,
        'replaced payment method QR',
      );
    }
    return this.requiredAdminPaymentMethod(actorUserId, paymentMethodId);
  }

  async paymentProofAccess(
    actorUserId: string,
    submissionId: string,
    administratorAccess: boolean,
  ): Promise<{ url: string; expiresAt: string }> {
    const resolved = await this.serviceClient.rpc('resolve_payment_proof_object', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      administrator_access: administratorAccess,
    });
    if (resolved.error)
      throw paymentRpcError(resolved.error, 'Payment proof access is unavailable');
    const object = resolved.data?.[0];
    if (!object) {
      throw new AppError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Payment proof was not found',
      });
    }
    return {
      url: await this.signedObjectUrl(object.bucket_id, object.object_path),
      expiresAt: new Date(
        Date.now() + this.environment.PAYMENT_SIGNED_URL_TTL_SECONDS * 1_000,
      ).toISOString(),
    };
  }

  private async adminUserIds(actorUserId: string, search: string): Promise<string[]> {
    const result = await this.serviceClient.rpc('admin_user_directory', {
      actor_user_id: actorUserId,
      search_query: search,
      verification_filter: 'all',
      page_size: 200,
      page_offset: 0,
    });
    if (result.error) throw paymentRpcError(result.error, 'User search is unavailable');
    return (result.data ?? []).map((user) => user.user_id);
  }

  private async loadAdminPayments(
    actorUserId: string,
    rows: PaymentSubmissionRow[],
    includeEvents: boolean,
    includeFlags: boolean,
  ): Promise<AdminPaymentSubmission[]> {
    if (rows.length === 0) return [];
    const submissionIds = rows.map((row) => row.id);
    const userIds = unique(rows.map((row) => row.user_id));
    const planIds = unique(rows.map((row) => row.plan_id));
    const proofIds = unique(rows.map((row) => row.proof_file_id));
    const [
      plansResult,
      proofsResult,
      eventsResult,
      flagsResult,
      profilesResult,
      subscriptionsResult,
    ] = await Promise.all([
      this.publicClient.from('plans').select('*').in('id', planIds),
      proofIds.length
        ? this.serviceClient.from('payment_submission_files').select('*').in('id', proofIds)
        : Promise.resolve({ data: [] as PaymentFileRow[], error: null }),
      includeEvents
        ? this.serviceClient
            .from('payment_submission_events')
            .select('*')
            .in('submission_id', submissionIds)
            .order('created_at')
        : Promise.resolve({ data: [] as PaymentEventRow[], error: null }),
      includeFlags
        ? this.serviceClient
            .from('payment_review_flags')
            .select('*')
            .in('submission_id', submissionIds)
        : Promise.resolve({ data: [] as PaymentFlagRow[], error: null }),
      this.serviceClient.from('profiles').select('*').in('id', userIds),
      this.serviceClient
        .from('subscriptions')
        .select('*')
        .in('user_id', userIds)
        .order('created_at', { ascending: false }),
    ]);
    if (
      plansResult.error ||
      proofsResult.error ||
      eventsResult.error ||
      flagsResult.error ||
      profilesResult.error ||
      subscriptionsResult.error
    ) {
      throw configurationError('Administrative payment review data is unavailable');
    }
    const subscriptionPlanIds = unique(
      (subscriptionsResult.data ?? []).map((subscription) => subscription.plan_id),
    );
    const subscriptionPlansResult = subscriptionPlanIds.length
      ? await this.publicClient.from('plans').select('*').in('id', subscriptionPlanIds)
      : { data: [] as PlanRow[], error: null };
    if (subscriptionPlansResult.error) {
      throw configurationError('Subscription plan configuration is unavailable');
    }
    const plans = new Map(
      [...(plansResult.data ?? []), ...(subscriptionPlansResult.data ?? [])].map((plan) => [
        plan.id,
        plan,
      ]),
    );
    const proofs = new Map((proofsResult.data ?? []).map((proof) => [proof.id, proof]));
    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
    const events = new Map<string, PaymentEventRow[]>();
    for (const event of eventsResult.data ?? []) {
      const list = events.get(event.submission_id) ?? [];
      list.push(event);
      events.set(event.submission_id, list);
    }
    const flags = new Map<string, PaymentFlagRow[]>();
    for (const flag of flagsResult.data ?? []) {
      const list = flags.get(flag.submission_id) ?? [];
      list.push(flag);
      flags.set(flag.submission_id, list);
    }
    const currentSubscriptions = new Map<string, SubscriptionRow>();
    for (const subscription of subscriptionsResult.data ?? []) {
      if (!currentSubscriptions.has(subscription.user_id)) {
        currentSubscriptions.set(subscription.user_id, subscription);
      }
    }
    const detailEmails = new Map<string, string | null>();
    const onlyRow = rows.length === 1 ? rows[0] : undefined;
    if (includeEvents && onlyRow) {
      const detail = await this.serviceClient.rpc('admin_user_detail', {
        actor_user_id: actorUserId,
        target_user_id: onlyRow.user_id,
      });
      if (detail.error) throw paymentRpcError(detail.error, 'Payment user detail is unavailable');
      detailEmails.set(onlyRow.user_id, detail.data?.[0]?.email ?? null);
    }
    return rows.map((row) => {
      const planRow = plans.get(row.plan_id);
      if (!planRow) throw configurationError('Payment plan configuration is unavailable');
      const proofRow = row.proof_file_id ? proofs.get(row.proof_file_id) : undefined;
      if (row.proof_file_id && !proofRow) {
        throw configurationError('Payment proof metadata is unavailable');
      }
      const profile = profiles.get(row.user_id);
      const currentSubscription = currentSubscriptions.get(row.user_id);
      const currentPlan = currentSubscription ? plans.get(currentSubscription.plan_id) : null;
      return parseDatabaseValue(
        adminPaymentSubmissionSchema,
        {
          id: row.id,
          planCode: planRow.code,
          tierCode: planRow.tier_code,
          billingPeriod: row.billing_period,
          quotedAmountMinor: row.quoted_amount_minor,
          currency: row.currency,
          paymentMethodId: row.payment_method_id,
          paymentMethod: methodSnapshot(row.payment_method_snapshot),
          referenceNumber: row.original_reference,
          normalizedReference: row.normalized_reference,
          paidAt: row.paid_at,
          userNote: row.user_note,
          informationResponse: row.information_response,
          status: row.status,
          submittedAt: row.submitted_at,
          reviewStartedAt: row.review_started_at,
          reviewedAt: row.reviewed_at,
          reviewerId: row.reviewer_id,
          reviewLockExpiresAt: row.review_lock_expires_at,
          publicReviewMessage: row.public_review_message,
          internalReviewNote: row.internal_review_note,
          rejectionReasonCode: row.rejection_reason_code,
          proof: proofRow ? mapProof(proofRow) : null,
          approvalTransactionId: row.approval_transaction_id,
          subscriptionId: row.subscription_id,
          duplicateReference: row.duplicate_reference,
          duplicateProof: row.duplicate_proof,
          declarationAcceptedAt: row.declaration_accepted_at,
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          events: (events.get(row.id) ?? []).map(mapAdminEvent),
          flags: (flags.get(row.id) ?? []).map((flag) => ({
            id: flag.id,
            flagType: flag.flag_type,
            warning: flag.warning,
            createdAt: flag.created_at,
          })),
          user: {
            id: row.user_id,
            email: detailEmails.get(row.user_id) ?? null,
            displayName: profileDisplayName(profile),
            accountStatus: profile?.account_status ?? 'disabled',
          },
          currentSubscription:
            currentSubscription && currentPlan
              ? {
                  id: currentSubscription.id,
                  planCode: currentPlan.code,
                  status: currentSubscription.status,
                  startsAt: currentSubscription.starts_at,
                  endsAt: currentSubscription.ends_at,
                  version: currentSubscription.version,
                }
              : null,
        },
        'Administrative payment review data is invalid',
      );
    });
  }

  async listAdminPayments(
    actorUserId: string,
    input: PaymentQueueQuery,
  ): Promise<Page<Omit<AdminPaymentSubmission, 'events' | 'flags'>>> {
    await this.authorizeAdmin(actorUserId, 'payments.read');
    const offset = (input.page - 1) * input.pageSize;
    let query = this.serviceClient.from('payment_submissions').select('*', { count: 'exact' });
    if (input.status) query = query.eq('status', input.status);
    if (input.billingPeriod) query = query.eq('billing_period', input.billingPeriod);
    if (input.paymentMethodId) query = query.eq('payment_method_id', input.paymentMethodId);
    if (input.amountMinor) query = query.eq('quoted_amount_minor', input.amountMinor);
    if (input.submittedFrom) query = query.gte('submitted_at', input.submittedFrom);
    if (input.submittedTo) query = query.lte('submitted_at', input.submittedTo);
    if (input.reviewerId) query = query.eq('reviewer_id', input.reviewerId);
    if (input.duplicateReference !== undefined) {
      query = query.eq('duplicate_reference', input.duplicateReference);
    }
    if (input.duplicateProof !== undefined)
      query = query.eq('duplicate_proof', input.duplicateProof);
    if (input.planCode) {
      const planResult = await this.publicClient
        .from('plans')
        .select('id')
        .eq('code', input.planCode)
        .maybeSingle();
      if (planResult.error) throw configurationError('Payment plan filter is unavailable');
      if (!planResult.data) return page([], input.page, input.pageSize, 0);
      query = query.eq('plan_id', planResult.data.id);
    }
    if (input.userSearch) {
      const userIds = await this.adminUserIds(actorUserId, input.userSearch);
      if (userIds.length === 0) return page([], input.page, input.pageSize, 0);
      query = query.in('user_id', userIds);
    }
    const result = await query
      .order('submitted_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(offset, offset + input.pageSize - 1);
    if (result.error) throw configurationError('Payment review queue is unavailable');
    const hydrated = await this.loadAdminPayments(actorUserId, result.data ?? [], false, false);
    return page(hydrated.map(withoutEventsAndFlags), input.page, input.pageSize, result.count ?? 0);
  }

  async getAdminPayment(
    actorUserId: string,
    submissionId: string,
  ): Promise<AdminPaymentSubmission | null> {
    await this.authorizeAdmin(actorUserId, 'payments.read');
    const result = await this.serviceClient
      .from('payment_submissions')
      .select('*')
      .eq('id', submissionId)
      .maybeSingle();
    if (result.error) throw configurationError('Payment review detail is unavailable');
    if (!result.data) return null;
    const [payment] = await this.loadAdminPayments(actorUserId, [result.data], true, true);
    return payment ?? null;
  }

  private async requiredAdminPayment(actorUserId: string, submissionId: string) {
    const payment = await this.getAdminPayment(actorUserId, submissionId);
    if (!payment) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Payment was not found' });
    }
    return payment;
  }

  async startReview(
    actorUserId: string,
    submissionId: string,
    expectedVersion: number,
    requestId: string,
  ): Promise<AdminPaymentSubmission> {
    const result = await this.serviceClient.rpc('start_payment_review', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      expected_version: expectedVersion,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment review could not be started');
    return this.requiredAdminPayment(actorUserId, submissionId);
  }

  async requestInformation(
    actorUserId: string,
    submissionId: string,
    input: RequestPaymentInformationInput,
    requestId: string,
  ): Promise<AdminPaymentSubmission> {
    const result = await this.serviceClient.rpc('request_payment_information', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      expected_version: input.expectedVersion,
      reason_category: input.reasonCategory,
      public_message: input.publicMessage,
      internal_note: input.internalNote ?? '',
      action_reason: input.reason,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Information request could not be saved');
    return this.requiredAdminPayment(actorUserId, submissionId);
  }

  async approvePayment(
    actorUserId: string,
    submissionId: string,
    input: ApprovePaymentInput,
    requestId: string,
  ): Promise<AdminPaymentSubmission> {
    const result = await this.serviceClient.rpc('approve_payment_submission', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      expected_version: input.expectedVersion,
      action_reason: input.reason,
      internal_note: input.internalNote ?? '',
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment could not be approved');
    return this.requiredAdminPayment(actorUserId, submissionId);
  }

  async rejectPayment(
    actorUserId: string,
    submissionId: string,
    input: RejectPaymentInput,
    requestId: string,
  ): Promise<AdminPaymentSubmission> {
    const result = await this.serviceClient.rpc('reject_payment_submission', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      expected_version: input.expectedVersion,
      requested_rejection_reason_code: input.rejectionReasonCode,
      public_message: input.publicMessage,
      internal_note: input.internalNote ?? '',
      action_reason: input.reason,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment could not be rejected');
    return this.requiredAdminPayment(actorUserId, submissionId);
  }

  async recordRefund(
    actorUserId: string,
    submissionId: string,
    input: RecordPaymentRefundInput,
    requestId: string,
  ): Promise<AdminPaymentSubmission> {
    const result = await this.serviceClient.rpc('record_payment_refund', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      expected_version: input.expectedVersion,
      refunded_amount_minor: input.refundedAmountMinor,
      external_reference: input.externalReference ?? '',
      refunded_at: input.refundedAt,
      requested_subscription_impact: input.subscriptionImpact,
      action_reason: input.reason,
      internal_note: input.internalNote ?? '',
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Refund record could not be saved');
    return this.requiredAdminPayment(actorUserId, submissionId);
  }

  async reverseApproval(
    actorUserId: string,
    submissionId: string,
    input: ReversePaymentInput,
    requestId: string,
  ): Promise<AdminPaymentSubmission> {
    const result = await this.serviceClient.rpc('reverse_payment_approval', {
      actor_user_id: actorUserId,
      target_submission_id: submissionId,
      expected_version: input.expectedVersion,
      action_reason: input.reason,
      internal_note: input.internalNote ?? '',
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Payment approval could not be reversed');
    return this.requiredAdminPayment(actorUserId, submissionId);
  }

  private async subscriptionRecord(
    row: SubscriptionRow,
    events: SubscriptionEventRow[],
  ): Promise<SubscriptionRecord> {
    const planResult = await this.publicClient
      .from('plans')
      .select('*')
      .eq('id', row.plan_id)
      .single();
    if (planResult.error || !planResult.data) {
      throw configurationError('Subscription plan configuration is unavailable');
    }
    return {
      planId: row.plan_id,
      detail: {
        id: row.id,
        userId: row.user_id,
        planCode: planResult.data.code,
        tierCode: planResult.data.tier_code,
        billingPeriod: planResult.data.billing_period,
        status: row.status,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        source: row.source,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        events: events.map((event) => ({
          id: event.id,
          eventType: event.event_type,
          effectiveAt: event.effective_at,
          reason: event.reason,
          createdAt: event.created_at,
        })),
      },
    };
  }

  async getMySubscriptionRecord(
    accessToken: string,
    userId: string,
  ): Promise<SubscriptionRecord | null> {
    const client = this.userClient(accessToken);
    const result = await client
      .from('subscriptions')
      .select(customerSubscriptionColumns)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw configurationError('Subscription is unavailable');
    if (!result.data) return null;
    const eventsResult = await client
      .from('subscription_events')
      .select(customerSubscriptionEventColumns)
      .eq('subscription_id', result.data.id)
      .order('created_at');
    if (eventsResult.error) throw configurationError('Subscription history is unavailable');
    return this.subscriptionRecord(
      result.data as SubscriptionRow,
      (eventsResult.data ?? []) as SubscriptionEventRow[],
    );
  }

  async listAdminSubscriptions(
    actorUserId: string,
    input: AdminSubscriptionQuery,
  ): Promise<Page<Omit<SubscriptionDetail, 'events' | 'entitlements'>>> {
    await this.authorizeAdmin(actorUserId, 'subscriptions.read');
    const offset = (input.page - 1) * input.pageSize;
    let query = this.serviceClient.from('subscriptions').select('*', { count: 'exact' });
    if (input.status) query = query.eq('status', input.status as SubscriptionRow['status']);
    if (input.expiringBefore) query = query.lte('ends_at', input.expiringBefore);
    if (input.planCode) {
      const planResult = await this.publicClient
        .from('plans')
        .select('id')
        .eq('code', input.planCode)
        .maybeSingle();
      if (planResult.error) throw configurationError('Subscription plan filter is unavailable');
      if (!planResult.data) return page([], input.page, input.pageSize, 0);
      query = query.eq('plan_id', planResult.data.id);
    }
    if (input.userSearch) {
      const userIds = await this.adminUserIds(actorUserId, input.userSearch);
      if (userIds.length === 0) return page([], input.page, input.pageSize, 0);
      query = query.in('user_id', userIds);
    }
    const result = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + input.pageSize - 1);
    if (result.error) throw configurationError('Subscription directory is unavailable');
    const items = await Promise.all(
      (result.data ?? []).map(async (row) => {
        const record = await this.subscriptionRecord(row, []);
        return withoutEvents(record.detail);
      }),
    );
    return page(items, input.page, input.pageSize, result.count ?? 0);
  }

  async getAdminSubscriptionRecord(
    actorUserId: string,
    subscriptionId: string,
  ): Promise<SubscriptionRecord | null> {
    await this.authorizeAdmin(actorUserId, 'subscriptions.read');
    const [subscriptionResult, eventsResult] = await Promise.all([
      this.serviceClient.from('subscriptions').select('*').eq('id', subscriptionId).maybeSingle(),
      this.serviceClient
        .from('subscription_events')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('created_at'),
    ]);
    if (subscriptionResult.error || eventsResult.error) {
      throw configurationError('Subscription detail is unavailable');
    }
    if (!subscriptionResult.data) return null;
    return this.subscriptionRecord(subscriptionResult.data, eventsResult.data ?? []);
  }

  async correctSubscription(
    actorUserId: string,
    subscriptionId: string,
    input: CorrectSubscriptionInput,
    requestId: string,
  ): Promise<void> {
    const result = await this.serviceClient.rpc('correct_subscription', {
      actor_user_id: actorUserId,
      target_subscription_id: subscriptionId,
      expected_version: input.expectedVersion,
      requested_starts_at: input.startsAt,
      requested_ends_at: input.endsAt,
      action_reason: input.reason,
      internal_note: input.internalNote ?? '',
      restore_reversed: input.restoreReversed,
      action_request_id: requestId,
    });
    if (result.error) throw paymentRpcError(result.error, 'Subscription could not be corrected');
  }
}
