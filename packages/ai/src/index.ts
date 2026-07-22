export type AiProviderKind = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'openai_compatible';

export type AiTaskKind =
  | 'job_extraction'
  | 'preliminary_scoring'
  | 'deep_job_analysis'
  | 'resume_parsing'
  | 'portfolio_parsing'
  | 'cover_letter_generation'
  | 'resume_tailoring'
  | 'interview_preparation'
  | 'recruiter_message'
  | 'career_coaching'
  | 'embedding'
  | 'notification_summary';

export interface UntrustedSourceContent {
  sourceId: string;
  sourceType: 'job_post' | 'resume' | 'portfolio' | 'employer_instruction' | 'external_page';
  sha256: string;
  content: string;
  trustLevel: 'untrusted';
}

export interface AiGenerationRequest<TOutput> {
  task: AiTaskKind;
  model: string;
  promptVersion: string;
  trustedInstructions: readonly string[];
  untrustedInputs: readonly UntrustedSourceContent[];
  verifiedFactIds: readonly string[];
  outputSchemaName: string;
  timeoutMs: number;
  maxAttempts: number;
  validateOutput: (value: unknown) => TOutput;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostMinorUsd: number | null;
}

export interface TruthGateResult {
  status: 'not_evaluated' | 'passed' | 'rejected' | 'needs_review';
  unsupportedClaimIds: readonly string[];
  verifiedFactIds: readonly string[];
}

export interface AiGenerationResult<TOutput> {
  output: TOutput;
  provider: AiProviderKind;
  model: string;
  promptVersion: string;
  usage: AiUsage;
  truthGate: TruthGateResult;
}

export interface AiProvider {
  readonly kind: AiProviderKind;
  generate<TOutput>(request: AiGenerationRequest<TOutput>): Promise<AiGenerationResult<TOutput>>;
  health(): Promise<'available' | 'degraded' | 'unavailable'>;
}

export class DisabledAiProvider implements AiProvider {
  readonly kind = 'openai_compatible' as const;

  generate<TOutput>(_request: AiGenerationRequest<TOutput>): Promise<AiGenerationResult<TOutput>> {
    void _request;
    return Promise.reject(new Error('Live AI generation is disabled in Phase 0'));
  }

  health(): Promise<'unavailable'> {
    return Promise.resolve('unavailable');
  }
}
