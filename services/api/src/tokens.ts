export const API_ENVIRONMENT = Symbol('API_ENVIRONMENT');

/**
 * The resolved AI provider for this deployment.
 *
 * Injected as a token rather than constructed per call so a test can override it
 * exactly as `careerRepository` and `adminJobsRepository` are overridden, and so
 * one process holds one provider with one retry budget.
 */
export const AI_PROVIDER_TOKEN = Symbol('AI_PROVIDER');
