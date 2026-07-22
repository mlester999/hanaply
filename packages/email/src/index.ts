export type EmailCategory =
  | 'authentication'
  | 'account'
  | 'job_alert'
  | 'daily_digest'
  | 'application_reminder'
  | 'administrative';

export interface EmailMessage {
  recipient: string;
  templateId: string;
  templateVersion: string;
  category: EmailCategory;
  idempotencyKey: string;
  variables: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EmailDeliveryReceipt {
  provider: string;
  status: 'disabled' | 'queued' | 'delivered' | 'failed';
  providerMessageId: string | null;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt>;
}

export class DisabledEmailProvider implements EmailProvider {
  send(_message: EmailMessage): Promise<EmailDeliveryReceipt> {
    void _message;
    return Promise.resolve({ provider: 'disabled', status: 'disabled', providerMessageId: null });
  }
}
