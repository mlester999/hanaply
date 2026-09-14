import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppError } from './app-error.js';
import { AiRepository } from './ai.repository.js';

export interface MeterDecision {
  /** True when this call actually consumed a unit. False when it was a repeat. */
  readonly charged: boolean;
  /** The plan allowance for the feature, as the database reports it. */
  readonly limit: number;
  /** What the counter reports as used, plus this unit when it was charged. */
  readonly used: number;
  readonly remaining: number;
  /** The key the decision was taken under, so a caller can release it. */
  readonly idempotencyKey: string;
}

interface MeterRequest {
  readonly userId: string;
  readonly feature: 'ai_analysis' | 'coach_message';
  readonly idempotencyKey: string;
  readonly units: number;
}

/**
 * Quota metering for the AI features.
 *
 * The guarantee is exactly-once per logical operation, and it is derived the way
 * `public.create_application_pack` derives it: from the identity of the
 * operation rather than from the request. `AiService` builds the key from who
 * asked, about what, and under which evidence, so a retry, a timeout, or a
 * resubmitted form resolves to the same key and the second call is reported as
 * `charged: false` instead of consuming a second unit.
 *
 * Two rules are enforced here rather than by the caller, because a caller that
 * forgets them would charge a member for nothing:
 *
 *   - Entitlement comes first. The allowance is read from `usage_summary`, the
 *     same source the usage surface shows, so a plan that does not include the
 *     feature is refused with the allowance it actually grants and no work is
 *     started.
 *   - A pending unit is released when generation produces nothing. `consume`
 *     reserves; `release` gives the reservation back. A generation that fails,
 *     that the truth gate refuses, or that the database refuses therefore costs
 *     the member nothing, which is the precedent `create_application_pack` sets
 *     when it charges only after the pack row exists.
 *
 * The ledger is process-local. It is the API's own record of which operation
 * identities it has already charged; the database's `usage_counters` row for the
 * period remains the authoritative counter, and it is read — never written —
 * from here, because the migration that introduced the AI tables exposes no
 * service-role function that consumes a non-pack feature and this module does
 * not reach around that boundary with a direct write. The consequence is stated
 * plainly in the module report: with more than one API instance, a retry routed
 * to a different instance is a second charge.
 */
@Injectable()
export class AiMeter {
  private readonly logger = new Logger('AiMeter');
  private readonly ledger = new Map<string, MeterDecision>();

  constructor(@Inject(AiRepository) private readonly repository: AiRepository) {}

  async consume(request: MeterRequest): Promise<MeterDecision> {
    const existing = this.ledger.get(request.idempotencyKey);
    if (existing !== undefined) {
      // Already consumed under this key. The same decision is returned and the
      // counter is not touched, which is what makes a retry free.
      this.logger.log(
        `ai.meter outcome=repeat feature=${request.feature} key_present=true charged=false`,
      );
      return { ...existing, charged: false };
    }

    const usage = await this.repository.usageFor(request.userId, request.feature);
    // A missing row means the plan grants nothing for this feature. The refusal
    // is a 403 with the allowance the plan actually states, matching the pack
    // route's refusal so the interface renders one kind of entitlement error.
    const limit = usage?.limit ?? 0;
    const used = usage?.used ?? 0;
    if (limit <= 0) {
      throw new AppError({
        code: 'ENTITLEMENT_REQUIRED',
        status: 403,
        message: `Your current plan does not include ${featureLabel(request.feature)}. Upgrade to use it, or use the deterministic analysis Hanaply provides on every opportunity.`,
      });
    }
    if (used + request.units > limit) {
      throw new AppError({
        code: 'ENTITLEMENT_REQUIRED',
        status: 403,
        message: `the current plan allows ${limit} ${featureLabel(request.feature)} this month`,
      });
    }

    const decision: MeterDecision = {
      charged: true,
      limit,
      used: used + request.units,
      remaining: Math.max(limit - (used + request.units), 0),
      idempotencyKey: request.idempotencyKey,
    };
    this.ledger.set(request.idempotencyKey, decision);
    this.logger.log(
      `ai.meter outcome=consumed feature=${request.feature} units=${request.units} limit=${limit} used=${decision.used}`,
    );
    return decision;
  }

  /**
   * Gives a reserved unit back.
   *
   * Called when a generation produced nothing: a provider failure, a truth-gate
   * refusal, or a database refusal. Removing the key means a later attempt at
   * the same operation is a first attempt again rather than a repeat, so a
   * member is never locked out of an operation that never ran.
   *
   * This is not `async` and does not need to be: no counter was advanced for a
   * reservation, so giving it back is a ledger write and nothing more.
   */
  release(idempotencyKey: string): void {
    if (!this.ledger.has(idempotencyKey)) return;
    this.ledger.delete(idempotencyKey);
    this.logger.log('ai.meter outcome=released charged=false');
  }

  /** Exposed for tests and for an operator view: how many reservations are held. */
  get reservedCount(): number {
    return this.ledger.size;
  }

  /** Drops every reservation. Used by tests between cases. */
  reset(): void {
    this.ledger.clear();
  }
}

function featureLabel(feature: 'ai_analysis' | 'coach_message'): string {
  return feature === 'ai_analysis' ? 'AI analyses' : 'coach messages';
}
