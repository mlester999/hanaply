import type { ApiEnvironment } from '@hanaply/config';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AdminAuthorizationGuard, SupabaseAuthGuard, SupabaseAuthService } from './auth.js';
import { HanaplyService } from './app.service.js';
import { AdminJobsController } from './admin-jobs.controllers.js';
import { AdminJobsRepository } from './admin-jobs.repository.js';
import { AdminJobsService } from './admin-jobs.service.js';
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
import { API_ENVIRONMENT } from './tokens.js';

export interface ApiRuntimeOverrides {
  repository?: unknown;
  paymentRepository?: unknown;
  careerRepository?: unknown;
  adminJobsRepository?: unknown;
  authService?: unknown;
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
        DocumentationController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
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
        HanaplyService,
        PaymentService,
        CareerService,
        AdminJobsService,
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
