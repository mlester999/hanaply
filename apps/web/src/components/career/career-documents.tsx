'use client';

import type {
  CareerDocument,
  CareerDocumentExtraction,
  CareerProfileSummary,
} from '@hanaply/contracts';
import { Alert, Badge, Button, Card, EmptyState, FormField, LinkButton } from '@hanaply/ui';
import { FileText, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  applyCareerDocumentExtractionAction,
  deleteCareerDocumentAction,
  uploadCareerDocumentAction,
} from '@/app/(customer)/dashboard/career/documents/actions';
import { CareerFeedback } from '@/components/career/career-feedback';
import { useCareerAction } from '@/components/career/use-career-action';
import {
  documentKindLabel,
  documentKindOptions,
  documentStatusLabel,
  formatBytes,
  formatTimestamp,
  humanise,
} from '@/lib/career';

const maximumDocumentBytes = 10 * 1024 * 1024;
const acceptedExtensions: readonly string[] = ['pdf', 'docx', 'rtf', 'txt', 'md'];
const acceptedAttribute = '.pdf,.docx,.rtf,.txt,.md';

function statusTone(
  status: CareerDocument['status'],
): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'parsed') return 'success';
  if (status === 'needs_review') return 'warning';
  if (status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'processing' || status === 'uploaded') return 'brand';
  return 'neutral';
}

function extensionOf(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
}

/** Joins the parts of a summary line, skipping everything the parser left empty. */
function joined(
  values: readonly (string | number | null | undefined)[],
  separator = ' · ',
): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== '') parts.push(text);
  }
  return parts.join(separator);
}

function UploadForm({ profiles }: { profiles: readonly CareerProfileSummary[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [clientNotice, setClientNotice] = useState<string | null>(null);
  const { state, onSubmit, pending } = useCareerAction(uploadCareerDocumentAction, {
    onSuccess: () => {
      setClientNotice(null);
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  function inspect(file: File | undefined) {
    if (!file) {
      setClientNotice(null);
      return;
    }
    if (!acceptedExtensions.includes(extensionOf(file.name))) {
      setClientNotice('Upload a PDF, DOCX, RTF, TXT, or Markdown file.');
      return;
    }
    if (file.size > maximumDocumentBytes) {
      setClientNotice(`${file.name} is ${formatBytes(file.size)}. The limit is 10 MB.`);
      return;
    }
    setClientNotice(`${file.name} · ${formatBytes(file.size)} is ready to upload.`);
  }

  return (
    <Card aria-labelledby="career-upload-title" className="career-section-card" role="region">
      <div className="career-section-heading">
        <div>
          <span className="h-eyebrow">Resume intake</span>
          <h2 id="career-upload-title">Upload a resume</h2>
          <p>
            PDF, DOCX, RTF, TXT, or Markdown, up to 10 MB. The file is validated, checksummed,
            stored privately, and queued for parsing.
          </p>
        </div>
      </div>
      <form className="career-form" onSubmit={onSubmit}>
        <label
          className={dragging ? 'career-dropzone is-dragging' : 'career-dropzone'}
          htmlFor="careerDocumentFile"
          onDragEnter={() => {
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files;
            if (inputRef.current && dropped.length > 0) {
              inputRef.current.files = dropped;
              inspect(dropped[0]);
            }
          }}
        >
          <UploadCloud aria-hidden="true" size={26} />
          <span>
            <strong>Drop a resume here or choose a file</strong>
            <small>
              Only the selected file is uploaded. Nothing is written to your profile yet.
            </small>
          </span>
          <input
            accept={acceptedAttribute}
            className="h-input"
            id="careerDocumentFile"
            name="document"
            onChange={(event) => {
              inspect(event.currentTarget.files?.[0]);
            }}
            ref={inputRef}
            type="file"
          />
        </label>
        <p aria-live="polite" className="career-dropzone-notice">
          {clientNotice}
        </p>
        <div className="career-form-grid">
          <FormField id="careerDocumentKind" label="Document kind" required>
            <select
              className="h-input"
              defaultValue="resume"
              id="careerDocumentKind"
              name="documentKind"
            >
              {documentKindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            hint="Optional. Choose the profile these extracted items should be proposed to."
            id="careerDocumentProfile"
            label="Career profile"
          >
            <select
              className="h-input"
              defaultValue=""
              id="careerDocumentProfile"
              name="careerProfileId"
            >
              <option value="">No profile yet</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.isPrimary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <CareerFeedback errorTitle="Upload failed" state={state} successTitle="Upload accepted" />
        <div className="career-form-actions">
          <Button
            leadingIcon={<UploadCloud aria-hidden="true" size={18} />}
            loading={pending}
            type="submit"
          >
            Upload document
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ExtractionReview({
  document,
  extraction,
  profiles,
}: {
  document: CareerDocument;
  extraction: CareerDocumentExtraction;
  profiles: readonly CareerProfileSummary[];
}) {
  const { state, onSubmit, pending } = useCareerAction(applyCareerDocumentExtractionAction);
  const defaultProfileId =
    document.careerProfileId ??
    profiles.find((profile) => profile.isPrimary)?.id ??
    profiles[0]?.id ??
    '';
  const nothingProposed =
    extraction.employment.length === 0 &&
    extraction.education.length === 0 &&
    extraction.certifications.length === 0 &&
    extraction.skills.length === 0 &&
    extraction.links.length === 0 &&
    extraction.candidateFacts.length === 0;

  return (
    <div className="career-extraction">
      <div className="career-section-heading">
        <div>
          <span className="h-eyebrow">Extraction draft</span>
          <h3>Proposals from {document.originalFilename}</h3>
          <p>
            Extractor: {extraction.extractor ?? 'not recorded'}
            {extraction.extractorVersion ? ` (${extraction.extractorVersion})` : ''}. Every item
            below is a proposal that needs your confirmation. Nothing here is a fact yet.
          </p>
        </div>
      </div>

      {extraction.warnings.length > 0 ? (
        <Alert title="Parser warnings" tone="warning">
          <ul className="career-warning-list">
            {extraction.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {nothingProposed ? (
        <p className="career-section-empty">
          The parser found no structured items in this document. Nothing can be applied.
        </p>
      ) : (
        <form className="career-form" onSubmit={onSubmit}>
          <input name="documentId" type="hidden" value={document.id} />
          <FormField
            id={`careerExtractionProfile-${document.id}`}
            label="Apply to profile"
            required
          >
            <select
              className="h-input"
              defaultValue={defaultProfileId}
              id={`careerExtractionProfile-${document.id}`}
              name="careerProfileId"
              required
            >
              <option value="">Choose a career profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.isPrimary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          </FormField>

          {extraction.headline || extraction.summary ? (
            <div className="career-extraction-group">
              <h4>Headline and summary proposals</h4>
              <ul className="career-proposal-list">
                {extraction.headline ? (
                  <li>
                    <strong>Headline proposal</strong>
                    <span>{extraction.headline.value}</span>
                    {extraction.headline.evidence ? (
                      <small>Evidence: {extraction.headline.evidence}</small>
                    ) : null}
                  </li>
                ) : null}
                {extraction.summary ? (
                  <li>
                    <strong>Summary proposal</strong>
                    <span>{extraction.summary.value}</span>
                    {extraction.summary.evidence ? (
                      <small>Evidence: {extraction.summary.evidence}</small>
                    ) : null}
                  </li>
                ) : null}
              </ul>
              <p className="career-hint">
                Headline and summary proposals are informational only. This action applies the
                checked items below.
              </p>
            </div>
          ) : null}

          {extraction.employment.length > 0 ? (
            <fieldset className="career-choice-group">
              <legend className="h-label">Employment proposals</legend>
              <ul className="career-proposal-list">
                {extraction.employment.map((item, index) => (
                  <li key={`${item.companyName.value}-${index}`}>
                    <label className="career-choice">
                      <input name="employmentIndexes" type="checkbox" value={index} />
                      <span>
                        <strong>
                          {item.roleTitle.value} · {item.companyName.value}
                        </strong>
                        <small>
                          {joined(
                            [item.startDate, item.isCurrent ? 'Present' : item.endDate],
                            ' — ',
                          )}
                          {item.location ? ` · ${item.location.value}` : ''}
                        </small>
                        {item.highlights.length > 0 ? (
                          <small>{item.highlights.map((entry) => entry.value).join(' · ')}</small>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {extraction.education.length > 0 ? (
            <fieldset className="career-choice-group">
              <legend className="h-label">Education proposals</legend>
              <ul className="career-proposal-list">
                {extraction.education.map((item, index) => (
                  <li key={`${item.institution.value}-${index}`}>
                    <label className="career-choice">
                      <input name="educationIndexes" type="checkbox" value={index} />
                      <span>
                        {item.institution.value}
                        <small>
                          Education ·{' '}
                          {joined([item.degree?.value, item.fieldOfStudy?.value, item.endYear])}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {extraction.certifications.length > 0 ? (
            <fieldset className="career-choice-group">
              <legend className="h-label">Certification proposals</legend>
              <ul className="career-proposal-list">
                {extraction.certifications.map((item, index) => (
                  <li key={`${item.value}-${index}`}>
                    <label className="career-choice">
                      <input name="certificationIndexes" type="checkbox" value={index} />
                      <span>
                        <strong>{item.value}</strong>
                        {item.evidence ? <small>Evidence: {item.evidence}</small> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {extraction.skills.length > 0 ? (
            <fieldset className="career-choice-group">
              <legend className="h-label">Skill proposals</legend>
              <ul className="career-proposal-list career-proposal-list--compact">
                {extraction.skills.map((item) => (
                  <li key={item.name}>
                    <label className="career-choice">
                      <input name="skillNames" type="checkbox" value={item.name} />
                      <span>
                        {item.name}
                        <small>Skill · {humanise(item.skillKind)}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {extraction.links.length > 0 ? (
            <fieldset className="career-choice-group">
              <legend className="h-label">Link proposals</legend>
              <ul className="career-proposal-list">
                {extraction.links.map((item) => (
                  <li key={`${item.linkKind}-${item.url}`}>
                    <label className="career-choice">
                      <input name="linkKinds" type="checkbox" value={item.linkKind} />
                      <span>
                        {humanise(item.linkKind)}
                        <small>Link · {item.url}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {extraction.candidateFacts.length > 0 ? (
            <fieldset className="career-choice-group">
              <legend className="h-label">Claim proposals</legend>
              <ul className="career-proposal-list">
                {extraction.candidateFacts.map((item, index) => (
                  <li key={`${item.statement}-${index}`}>
                    <label className="career-choice">
                      <input name="factIndexes" type="checkbox" value={index} />
                      <span>
                        {item.statement}
                        <small>
                          Claim · {humanise(item.category)}
                          {item.metricValue !== null && item.metricUnit
                            ? ` · ${item.metricValue} ${item.metricUnit}`
                            : ''}
                          {` · ${Math.round(item.confidence * 100)}% extractor confidence`}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          <label className="career-choice">
            <input name="confirmSelected" type="checkbox" value="on" />
            <span>
              I reviewed these proposals. Applying them adds profile records and puts every claim in
              Needs review until I confirm it.
            </span>
          </label>
          <CareerFeedback
            errorTitle="Proposals not applied"
            state={state}
            successTitle="Proposals applied"
          />
          <div className="career-form-actions">
            <Button
              leadingIcon={<ShieldCheck aria-hidden="true" size={18} />}
              loading={pending}
              type="submit"
            >
              Apply selected to profile
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function DocumentRow({
  document,
  accessUrl,
  extraction,
  profiles,
}: {
  document: CareerDocument;
  accessUrl: string | null;
  extraction: CareerDocumentExtraction | null;
  profiles: readonly CareerProfileSummary[];
}) {
  const { state, onSubmit, pending } = useCareerAction(deleteCareerDocumentAction);
  const uploaded = formatTimestamp(document.createdAt) ?? document.createdAt;
  const showExtraction =
    extraction !== null && (document.status === 'parsed' || document.status === 'needs_review');

  return (
    <li className="career-document-row">
      <div className="career-document-heading">
        <div>
          <div className="career-badge-row">
            <Badge tone="neutral">{documentKindLabel(document.documentKind)}</Badge>
            <Badge tone={statusTone(document.status)}>{documentStatusLabel(document.status)}</Badge>
          </div>
          <h3>{document.originalFilename}</h3>
          <p className="career-record-meta">
            {joined([
              formatBytes(document.sizeBytes),
              document.pageCount === null ? null : `${document.pageCount} pages`,
              document.wordCount === null ? null : `${document.wordCount} words`,
              `Uploaded ${uploaded}`,
            ])}
          </p>
        </div>
        <div className="career-record-controls">
          {accessUrl ? (
            <LinkButton
              href={accessUrl}
              rel="noreferrer"
              size="sm"
              target="_blank"
              variant="secondary"
            >
              <FileText aria-hidden="true" size={16} /> Open private copy
            </LinkButton>
          ) : (
            <span className="career-hint">No private link available</span>
          )}
          <form className="career-record-delete" onSubmit={onSubmit}>
            <input name="documentId" type="hidden" value={document.id} />
            <Button
              aria-label={`Delete ${document.originalFilename}`}
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              loading={pending}
              size="sm"
              type="submit"
              variant="quiet"
            >
              Delete
            </Button>
            <span aria-live="polite" className="career-inline-note">
              {state.status === 'error' ? state.message : ''}
            </span>
          </form>
        </div>
      </div>
      {document.status === 'failed' ? (
        <Alert title="Parsing failed" tone="danger">
          This file could not be parsed. Delete it and upload a text-based resume instead.
        </Alert>
      ) : null}
      {showExtraction ? (
        <ExtractionReview document={document} extraction={extraction} profiles={profiles} />
      ) : document.status === 'uploaded' || document.status === 'processing' ? (
        <p className="career-hint">
          Parsing has not finished for this document. Reopen this page to check again; the
          extraction draft appears here once it is ready.
        </p>
      ) : null}
    </li>
  );
}

export function CareerDocuments({
  profiles,
  documents,
  access,
  extractions,
}: {
  profiles: readonly CareerProfileSummary[];
  documents: readonly CareerDocument[];
  access: Readonly<Record<string, string | null>>;
  extractions: Readonly<Record<string, CareerDocumentExtraction | null>>;
}) {
  return (
    <div className="career-documents">
      <UploadForm profiles={profiles} />
      {documents.length === 0 ? (
        <EmptyState
          description="Uploaded resumes and their parsing state will be listed here. No document is stored unless you upload one."
          eyebrow="Document library"
          icon={<FileText aria-hidden="true" size={24} />}
          title="No documents yet"
        />
      ) : (
        <Card
          aria-labelledby="career-document-list-title"
          className="career-section-card"
          role="region"
        >
          <div className="career-section-heading">
            <div>
              <span className="h-eyebrow">Library</span>
              <h2 id="career-document-list-title">{documents.length} stored documents</h2>
              <p>Private copies are opened through a short-lived signed link.</p>
            </div>
          </div>
          <ul className="career-document-list">
            {documents.map((document) => (
              <DocumentRow
                accessUrl={access[document.id] ?? null}
                document={document}
                extraction={extractions[document.id] ?? null}
                key={document.id}
                profiles={profiles}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
