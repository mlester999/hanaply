import { apiContract, metaQuerySchema } from '@hanaply/contracts';
import { generateOpenApiDocument } from '@hanaply/contracts/openapi';
import { Controller, Get, Header, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { AdminAuthorizationGuard, SupabaseAuthGuard } from './auth.js';
import { AppError } from './app-error.js';
import { HanaplyService } from './app.service.js';
import { successEnvelope, type AuthenticatedRequest } from './http.js';

@Controller()
export class PublicController {
  constructor(@Inject(HanaplyService) private readonly service: HanaplyService) {}

  @Get(apiContract.health.path)
  @SkipThrottle()
  health(@Req() request: FastifyRequest) {
    return apiContract.health.response.parse(successEnvelope(request, this.service.health()));
  }

  @Get(apiContract.ready.path)
  @SkipThrottle()
  async ready(@Req() request: FastifyRequest) {
    return apiContract.ready.response.parse(
      successEnvelope(request, await this.service.readiness()),
    );
  }

  @Get(apiContract.version.path)
  @SkipThrottle()
  version(@Req() request: FastifyRequest) {
    return apiContract.version.response.parse(successEnvelope(request, this.service.version()));
  }

  @Get(apiContract.meta.path)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async meta(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) {
    const parsed = metaQuerySchema.parse(query);
    const input = parsed.clientVersion
      ? { platform: parsed.platform, clientVersion: parsed.clientVersion }
      : { platform: parsed.platform };
    return apiContract.meta.response.parse(
      successEnvelope(request, await this.service.meta(input)),
    );
  }

  @Get(apiContract.plans.path)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async plans(@Req() request: FastifyRequest) {
    return apiContract.plans.response.parse(successEnvelope(request, await this.service.plans()));
  }
}

@Controller()
@UseGuards(SupabaseAuthGuard)
export class UserController {
  constructor(@Inject(HanaplyService) private readonly service: HanaplyService) {}

  @Get(apiContract.me.path)
  async me(@Req() request: AuthenticatedRequest) {
    return apiContract.me.response.parse(successEnvelope(request, await this.service.me(request)));
  }

  @Get(apiContract.entitlements.path)
  async entitlements(@Req() request: AuthenticatedRequest) {
    return apiContract.entitlements.response.parse(
      successEnvelope(request, await this.service.entitlements(request)),
    );
  }
}

@Controller()
@UseGuards(SupabaseAuthGuard, AdminAuthorizationGuard)
export class AdminController {
  constructor(@Inject(HanaplyService) private readonly service: HanaplyService) {}

  @Get(apiContract.adminMe.path)
  adminMe(@Req() request: AuthenticatedRequest) {
    return apiContract.adminMe.response.parse(
      successEnvelope(request, this.service.adminMe(request)),
    );
  }
}

@Controller()
export class DocumentationController {
  constructor(@Inject(HanaplyService) private readonly service: HanaplyService) {}

  @Get('/openapi.json')
  @SkipThrottle()
  openApi() {
    if (!this.service.openApiEnabled()) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Resource not found' });
    }
    return generateOpenApiDocument();
  }

  @Get('/docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @SkipThrottle()
  docs() {
    if (!this.service.openApiEnabled()) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'Resource not found' });
    }
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hanaply API</title><style>body{max-width:52rem;margin:4rem auto;padding:0 1rem;font:16px/1.6 system-ui;color:#101828}a{color:#3157e8}code{background:#f6f8fc;padding:.2rem .4rem;border-radius:.3rem}</style></head><body><h1>Hanaply API v1</h1><p>The canonical OpenAPI 3.1 document is available at <a href="/openapi.json"><code>/openapi.json</code></a>.</p><p>This local documentation endpoint is disabled in production by default.</p></body></html>`;
  }
}
