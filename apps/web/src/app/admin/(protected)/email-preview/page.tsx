import { emailTemplateIds, emailTemplatePreviewMessage, renderEmailTemplate } from '@hanaply/email';
import { Alert, Badge, Card, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Email Template Preview' };

export default async function EmailPreviewPage() {
  await requireAdminPermission('notifications.manage');
  const localPreview = process.env.HANAPLY_ENV === 'local' || process.env.HANAPLY_ENV === 'test';
  const templates = localPreview
    ? emailTemplateIds.map((templateId) =>
        renderEmailTemplate(emailTemplatePreviewMessage(templateId)),
      )
    : [];
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          <Badge tone={localPreview ? 'success' : 'warning'}>
            {localPreview ? 'Local capture only' : 'Preview disabled'}
          </Badge>
        }
        description="Review branded HTML, plain text, subject lines, and preheaders without sending an email."
        eyebrow="Notification quality"
        title="Email Template Preview"
      />
      {!localPreview ? (
        <Alert title="Local preview only" tone="warning">
          Template rendering is intentionally disabled on hosted environments. Use the reviewed
          local capture workflow.
        </Alert>
      ) : (
        <div className="email-preview-list">
          {templates.map((template) => (
            <Card className="email-preview-card" key={template.templateId}>
              <div className="email-preview-heading">
                <div>
                  <span className="h-eyebrow">{template.templateId}</span>
                  <h2>{template.subject}</h2>
                  <p>{template.preheader}</p>
                </div>
                <Badge tone="neutral">{template.category}</Badge>
              </div>
              <iframe
                sandbox=""
                srcDoc={template.html}
                title={`${template.templateId} HTML email preview`}
              />
              <details>
                <summary>View plain-text version</summary>
                <pre>{template.text}</pre>
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
