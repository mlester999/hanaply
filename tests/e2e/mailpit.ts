import { readLocalSupabaseEnvironment } from './local-supabase.js';

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: readonly { Address: string }[];
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
  To: readonly { Address: string }[];
}

const { mailpitUrl } = readLocalSupabaseEnvironment();

export async function clearMailbox(): Promise<void> {
  const response = await fetch(new URL('/api/v1/messages', mailpitUrl), { method: 'DELETE' });
  if (!response.ok) throw new Error(`Mailpit cleanup failed with HTTP ${response.status}`);
}

export async function waitForEmail(
  recipient: string,
  subject: string,
  timeoutMilliseconds = 15_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const response = await fetch(new URL('/api/v1/messages?limit=100', mailpitUrl));
    if (!response.ok) throw new Error(`Mailpit listing failed with HTTP ${response.status}`);
    const body = (await response.json()) as { messages?: MailpitSummary[] };
    const summary = body.messages?.find(
      (candidate) =>
        candidate.Subject === subject &&
        candidate.To.some((mailbox) => mailbox.Address.toLowerCase() === recipient.toLowerCase()),
    );
    if (summary) {
      const detail = await fetch(new URL(`/api/v1/message/${summary.ID}`, mailpitUrl));
      if (!detail.ok) throw new Error(`Mailpit detail failed with HTTP ${detail.status}`);
      return (await detail.json()) as MailpitMessage;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
  }
  throw new Error(`Timed out waiting for ${subject} to ${recipient}`);
}

export function firstActionLink(message: MailpitMessage): string {
  const match = /https?:\/\/[^\s)]+/u.exec(message.Text);
  if (!match?.[0]) throw new Error(`No action link found in ${message.Subject}`);
  return match[0].replaceAll('&amp;', '&');
}
