import { createAiProvider, type AiProvider } from '@hanaply/ai';
import type { ApiEnvironment } from '@hanaply/config';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AdminAuthorizationGuard, SupabaseAuthGuard, SupabaseAuthService } from './auth.js';
import { HanaplyService } from './app.service.js';
import { AdminJobsController } from './admin-jobs.controllers.js';
import { AdminJobsRepository } from './admin-jobs.repository.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { AiController } from './ai.controllers.js';
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
}

@Module({})
// Nest dynamic modules use a class as the framework registration boundary.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {
  static register(environment: ApiEnvironment, overrides: ApiRuntimeOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
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
          useValue: overrides.aiProvider ?? createAiProvider(environment),
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
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    };
  }
}
