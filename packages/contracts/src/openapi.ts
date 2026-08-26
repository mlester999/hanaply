import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { type ApiContractRoute, apiContract } from './api-contract.js';
import { apiErrorEnvelopeSchema } from './errors.js';

extendZodWithOpenApi(z);

function registerRoute(registry: OpenAPIRegistry, route: ApiContractRoute): void {
  const request = {
    ...(route.query ? { query: route.query } : {}),
    ...(route.params ? { params: route.params } : {}),
    ...(route.body ? { body: { content: { 'application/json': { schema: route.body } } } } : {}),
    ...(route.multipartBody
      ? { body: { content: { 'multipart/form-data': { schema: route.multipartBody } } } }
      : {}),
  };
  registry.registerPath({
    method: route.method.toLowerCase() as Lowercase<ApiContractRoute['method']>,
    path: route.path,
    operationId: route.operationId,
    summary: route.summary,
    tags: [route.auth === 'admin' ? 'Admin' : route.auth === 'user' ? 'User' : 'Public'],
    ...(Object.keys(request).length > 0 ? { request } : {}),
    responses: {
      [route.successStatus]: {
        description: 'Successful response',
        content: { 'application/json': { schema: route.response } },
      },
      400: {
        description: 'Invalid request',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      401: {
        description: 'Authentication required',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      403: {
        description: 'Forbidden',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
      503: {
        description: 'Service unavailable',
        content: { 'application/json': { schema: apiErrorEnvelopeSchema } },
      },
    },
  });
}

export function generateOpenApiDocument(): unknown {
  const registry = new OpenAPIRegistry();
  for (const route of Object.values(apiContract)) registerRoute(registry, route);
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Hanaply API',
      version: '1.0.0',
      description: 'Versioned mobile-ready API contracts for the Hanaply career intelligence SaaS.',
    },
    servers: [{ url: 'http://localhost:3101', description: 'Local development' }],
  });
}
