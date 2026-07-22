import type { ApiEnvironment } from '@hanaply/config';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AdminAuthorizationGuard, SupabaseAuthGuard, SupabaseAuthService } from './auth.js';
import { HanaplyService } from './app.service.js';
import {
  AdminController,
  DocumentationController,
  PublicController,
  UserController,
} from './controllers.js';
import { HanaplyRepository } from './repository.js';
import { API_ENVIRONMENT } from './tokens.js';

@Module({})
// Nest dynamic modules use a class as the framework registration boundary.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {
  static register(environment: ApiEnvironment): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
      controllers: [PublicController, UserController, AdminController, DocumentationController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        HanaplyRepository,
        HanaplyService,
        SupabaseAuthService,
        SupabaseAuthGuard,
        AdminAuthorizationGuard,
        Reflector,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    };
  }
}
