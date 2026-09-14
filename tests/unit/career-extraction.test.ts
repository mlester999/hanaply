import { describe, expect, it } from 'vitest';

import {
  extractCareerProfile,
  extractionFingerprint,
} from '../../services/api/src/career-extraction.js';
import {
  validateCareerDocument,
  type UploadedCareerDocument,
} from '../../services/api/src/career-files.js';

const resumeText = [
  'Alex Santos',
  'Workflow Automation Specialist',
  'Manila, Philippines | alex.santos@example.com | +63 917 000 0000',
  'https://github.com/example',
  '',
  'SUMMARY',
  'Automation specialist who builds reliable workflows between business systems for small operations teams.',
  '',
  'EXPERIENCE',
  'Automation Specialist — Northstar Systems',
  'Feb 2023 - Present',
  '- Rebuilt onboarding automation for a 40-person distributed services team',
  '- Cut weekly reporting preparation from 4 hours to 20 minutes',
  '',
  'Operations Analyst, Meridian Support',
  'Jun 2021 - Jan 2023',
  '- Maintained the internal ticketing workflow for 3 support queues',
  '',
  'EDUCATION',
  'University of the Philippines',
  'BS Computer Science, 2014 - 2018',
  '',
  'SKILLS',
  'Automation: n8n, Zapier, Power Automate',
  'Languages: TypeScript, Python, SQL',
  'Databases: PostgreSQL, Supabase',
  '',
  'CERTIFICATIONS',
  'n8n Advanced Certification, issued 2024',
].join('\n');

function resumeInput(overrides: Partial<UploadedCareerDocument> = {}): UploadedCareerDocument {
  return {
    buffer: Buffer.from(resumeText, 'utf8'),
    declaredMimeType: 'text/plain',
    originalFilename: 'alex-santos-resume.txt',
    ...overrides,
  };
}

describe('career document validation', () => {
  it('accepts a plain-text resume and derives its checksum', async () => {
    const validated = await validateCareerDocument(resumeInput());
    expect(validated.mimeType).toBe('text/plain');
    expect(validated.extension).toBe('txt');
    expect(validated.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(validated.wordCount).toBeGreaterThan(50);
  });

  it('trusts the detected content type over the declared type and filename', async () => {
    await expect(
      validateCareerDocument(
        resumeInput({ declaredMimeType: 'application/pdf', originalFilename: 'resume.txt' }),
      ),
    ).resolves.toMatchObject({ extension: 'txt', mimeType: 'text/plain' });
  });

  it('rejects a renamed binary that is not a supported document', async () => {
    await expect(
      validateCareerDocument(
        resumeInput({
          buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]),
          declaredMimeType: 'application/pdf',
          originalFilename: 'resume.pdf',
        }),
      ),
    ).rejects.toThrow(/PDF, DOCX, RTF, plain-text, or Markdown/u);
  });

  it('rejects an empty file', async () => {
    await expect(validateCareerDocument(resumeInput({ buffer: Buffer.alloc(0) }))).rejects.toThrow(
      /Choose a file/u,
    );
  });

  it('strips path components and control characters from the stored filename', async () => {
    const validated = await validateCareerDocument(
      resumeInput({ originalFilename: '../../etc/pass\u0007word resume.txt' }),
    );
    expect(validated.originalFilename).not.toContain('/');
    expect(validated.originalFilename).not.toContain('..');
    expect(validated.originalFilename.endsWith('.txt')).toBe(true);
  });

  it('extracts text from an RTF document', async () => {
    const rtf =
      '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs20 Alex Santos\\par Automation Specialist\\par}';
    const validated = await validateCareerDocument(
      resumeInput({
        buffer: Buffer.from(rtf, 'latin1'),
        declaredMimeType: 'application/rtf',
        originalFilename: 'resume.rtf',
      }),
    );
    expect(validated.mimeType).toBe('application/rtf');
    expect(validated.text).toContain('Alex Santos');
    expect(validated.text).not.toContain('fonttbl');
  });
});

describe('deterministic resume extraction', () => {
  const extraction = extractCareerProfile({
    text: resumeText,
    pageCount: null,
    wordCount: 200,
    warnings: [],
  });

  it('never invents a company or role that is absent from the document', () => {
    for (const entry of extraction.employment) {
      expect(resumeText).toContain(entry.companyName.value);
      expect(resumeText).toContain(entry.roleTitle.value);
    }
  });

  it('attaches the verbatim source line as evidence for every grounded field', () => {
    for (const entry of extraction.employment) {
      expect(entry.companyName.evidence).not.toBeNull();
      expect(resumeText).toContain(entry.roleTitle.value);
      for (const highlight of entry.highlights) {
        expect(resumeText).toContain(highlight.value);
      }
    }
  });

  it('parses employment date ranges and marks the current role', () => {
    const current = extraction.employment.find((entry) => entry.isCurrent);
    expect(current?.companyName.value).toBe('Northstar Systems');
    expect(current?.startDate).toBe('2023-02-01');
    expect(current?.endDate).toBeNull();

    const previous = extraction.employment.find((entry) => !entry.isCurrent);
    expect(previous?.startDate).toBe('2021-06-01');
    expect(previous?.endDate).toBe('2023-01-01');
  });

  it('reports metrics only when a number appears with its unit', () => {
    expect(extraction.candidateFacts.length).toBeGreaterThan(0);
    for (const fact of extraction.candidateFacts) {
      expect(resumeText).toContain(fact.statement.replace(/^Professional summary: /u, ''));
      if (fact.metricValue === null) {
        expect(fact.metricUnit).toBeNull();
      } else {
        expect(fact.metricUnit).not.toBeNull();
        expect(fact.metricUnit?.length).toBeGreaterThan(0);
        expect(fact.metricValue).toBeTypeOf('number');
      }
    }
    const salvaged = extraction.candidateFacts.find((fact) =>
      fact.statement.includes('Cut weekly reporting preparation'),
    );
    expect(salvaged?.metricValue).toBe(4);
    expect(salvaged?.metricUnit).toBe('hours');
  });

  it('never classifies a document with no numbers as a metric claim', () => {
    const withoutNumbers = extractCareerProfile({
      text: [
        'Jordan Cruz',
        'Support Specialist',
        'SUMMARY',
        'Support specialist focused on ticketing quality and knowledge base upkeep.',
        'SKILLS',
        'Zendesk, Intercom',
      ].join('\n'),
      pageCount: null,
      wordCount: 30,
      warnings: [],
    });
    expect(withoutNumbers.candidateFacts.every((fact) => fact.metricValue === null)).toBe(true);
  });

  it('extracts skills with a typed kind and links with a recognised host', () => {
    const names = extraction.skills.map((skill) => skill.name.toLowerCase());
    expect(names).toContain('n8n');
    expect(names).toContain('postgresql');
    const typescript = extraction.skills.find((skill) => skill.name.toLowerCase() === 'typescript');
    expect(typescript?.skillKind).toBe('technology');
    expect(extraction.links).toContainEqual({
      linkKind: 'github',
      url: 'https://github.com/example',
    });
  });

  it('extracts education with the institution and end year', () => {
    expect(extraction.education[0]?.institution.value).toContain('University of the Philippines');
    expect(extraction.education[0]?.endYear).toBe(2018);
  });

  it('always warns that extracted values are proposals', () => {
    expect(extraction.warnings.join(' ')).toMatch(/proposal/u);
  });

  it('produces a stable fingerprint for identical text', () => {
    expect(extractionFingerprint(resumeText)).toBe(extractionFingerprint(resumeText));
    expect(extractionFingerprint(resumeText)).not.toBe(extractionFingerprint(`${resumeText} `));
  });
});
