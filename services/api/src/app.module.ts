import { createAiProvider, type AiProvider } from '@hanaply/ai';
import type { ApiEnvironment } from '@hanaply/config';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';

import { AdminAuthorizationGuard, SupabaseAuthGuard, SupabaseAuthService } from './auth.js';
import { HanaplyService } from './app.service.js';
import { AdminJobsController } from './admin-jobs.controllers.js';
import { AdminJobsRepository } from './admin-jobs.repository.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { AiController } from './ai.controllers.js';
import { createScriptedFakeProvider } from './ai-fake-script.js';
import { AiMeter } from './ai-meter.js';
import { AiRepository } from './ai.repository.js';
import { AiService } from './ai.service.js';
import { InsightsController } from './insights.controllers.js';
import { InsightsRepository } from './insights.repository.js';
import { InsightsService } from './insights.service.js';
import {
  AdminController,
  DocumentationController,
  PublicController,
  UserController,
} from './controllers.js';
import { AdminPaymentController, CustomerPaymentController } from './payment.controllers.js';
import { CareerController } from './career.controllers.js';
import { CareerRepository } from './career.repository.js';
import { CareerService } from './career.service.js';
import { PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';
import {
  createThrottlerStorage,
  isExpensiveRequest,
  routeDeclaredNothing,
  ScopedThrottlerGuard,
} from './rate-limit.js';
import { HanaplyRepository } from './repository.js';
import { AI_PROVIDER_TOKEN, API_ENVIRONMENT } from './tokens.js';

export interface ApiRuntimeOverrides {
  repository?: unknown;
  paymentRepository?: unknown;
  careerRepository?: unknown;
  adminJobsRepository?: unknown;
  insightsRepository?: unknown;
  authService?: unknown;
  /** The AI database boundary, so a test can run the routes without a database. */
  aiRepository?: unknown;
  /**
   * The resolved AI provider. A test injects `FakeAiProvider` here to exercise
   * generation, refusals, and provider failures without a network or a key.
   */
  aiProvider?: AiProvider;
  /**
   * The rate-limit store. Two applications that share one instance are one
   * limiter, which is the shape a multi-instance deployment needs; the default
   * is one in-process store per application.
   */
  throttlerStorage?: ThrottlerStorage;
}

/**
 * The AI provider for this process.
 *
 * `createScriptedFakeProvider` only answers when `AI_PROVIDER=fake` is combined
 * with a scripted response set in `local` or `test`, so an ordinary deployment
 * — and every test that does not opt in — resolves exactly the provider it did
 * before. See `ai-fake-script.ts` for why the browser suite needs the seam.
 */
function resolveAiProvider(environment: ApiEnvironment): AiProvider {
  return createScriptedFakeProvider(environment) ?? createAiProvider(environment);
}

@Module({})
// Nest dynamic modules use a class as the framework registration boundary.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {
  static register(environment: ApiEnvironment, overrides: ApiRuntimeOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        /**
         * Two named throttlers, one decision each.
         *
         * `default` carries every route. Its module-level limit and window are a
         * sentinel: the guard replaces them with the scope's configured policy
         * when the route declares nothing, and a route's own
         * `@Throttle({ default: { limit, ttl } })` still wins where it exists —
         * the library reads that decorator exactly as it did before, only the
         * bucket key changed. The key is the verified member when there is one
         * and the client address when there is not; see
         * `services/api/src/rate-limit.ts` for the scopes and
         * `packages/config/src/index.ts` for the values.
         *
         * `expensive` is a second, independent ceiling on the model and
         * generation routes, skipped everywhere else, so a member cannot spend an
         * unbounded amount of model time no matter how generous a single route's
         * decorator is.
         */
        ThrottlerModule.forRoot({
          storage: overrides.throttlerStorage ?? createThrottlerStorage(environment),
          throttlers: [
            {
              name: 'default',
              limit: routeDeclaredNothing,
              ttl: routeDeclaredNothing,
            },
            {
              name: 'expensive',
              limit: environment.RATE_LIMIT_EXPENSIVE_LIMIT,
              ttl: environment.RATE_LIMIT_EXPENSIVE_TTL_MS,
              skipIf: (context) => !isExpensiveRequest(context.switchToHttp().getRequest()),
            },
          ],
        }),
      ],
      controllers: [
        PublicController,
        UserController,
        CustomerPaymentController,
        CareerController,
        AdminController,
        AdminPaymentController,
        AdminJobsController,
        InsightsController,
        AiController,
        DocumentationController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        /**
         * The provider is resolved once per application, and it never throws:
         * a malformed environment, a selected provider with no credential, and a
         * missing base URL each produce a `DisabledAiProvider` that reports why.
         * A caller therefore always has a provider to ask, and the answer to
         * "can a model generate?" is a value rather than an exception.
         */
        {
          provide: AI_PROVIDER_TOKEN,
          useValue: overrides.aiProvider ?? resolveAiProvider(environment),
        },
        overrides.repository
          ? { provide: HanaplyRepository, useValue: overrides.repository }
          : HanaplyRepository,
        overrides.paymentRepository
          ? { provide: PaymentRepository, useValue: overrides.paymentRepository }
          : PaymentRepository,
        overrides.careerRepository
          ? { provide: CareerRepository, useValue: overrides.careerRepository }
          : CareerRepository,
        overrides.adminJobsRepository
          ? { provide: AdminJobsRepository, useValue: overrides.adminJobsRepository }
          : AdminJobsRepository,
        overrides.insightsRepository
          ? { provide: InsightsRepository, useValue: overrides.insightsRepository }
          : InsightsRepository,
        overrides.aiRepository
          ? { provide: AiRepository, useValue: overrides.aiRepository }
          : AiRepository,
        HanaplyService,
        PaymentService,
        CareerService,
        AdminJobsService,
        InsightsService,
        AiMeter,
        AiService,
        overrides.authService
          ? { provide: SupabaseAuthService, useValue: overrides.authService }
          : SupabaseAuthService,
        SupabaseAuthGuard,
        AdminAuthorizationGuard,
        Reflector,
        {
          provide: APP_GUARD,
          /**
           * A global guard runs before a controller guard, so this resolves the
           * caller itself, through the same `SupabaseAuthService` the controller's
           * `SupabaseAuthGuard` uses, and that service verifies a request once:
           * the bucket knows the member without paying for the session twice.
           */
          useClass: ScopedThrottlerGuard,
        },
      ],
    };
  }
}
