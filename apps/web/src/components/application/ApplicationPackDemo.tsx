'use client';

import {
  Check,
  FileCheck2,
  FileText,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { useMemo, useState } from 'react';

const items = [
  { id: 'analysis', label: 'AI job analysis', icon: Target },
  { id: 'letter', label: 'Tailored cover letter', icon: FileText },
  { id: 'resume', label: 'Tailored resume', icon: FileCheck2 },
  { id: 'message', label: 'Recruiter message', icon: MessageSquare },
  { id: 'interview', label: 'Interview preparation', icon: Sparkles },
  { id: 'checklist', label: 'Application checklist', icon: Check },
];

const letterContent: Record<string, { paragraphs: string[]; closer: string; signOff: string }> = {
  Professional: {
    paragraphs: [
      'I am writing to apply for the Workflow Automation Engineer role at Northstar Systems. I build practical automations that connect product requirements with reliable delivery, and I am drawn to teams that treat automation as a durable product practice.',
      'In a recent verified project, I connected workflow, AI, and business systems to reduce repetitive operational work across an operations team. That work covered requirement clarification, integration design, and handoff documentation so the automation stayed maintainable after launch.',
      'I also care about clear constraints: what must stay manual, what can be automated safely, and how success is measured. That habit helps me ship useful systems without inventing unsupported claims about scale or impact.',
    ],
    closer:
      'I would welcome the opportunity to discuss how that experience can support Northstar Systems’ automation practice.',
    signOff: 'Sincerely',
  },
  'Results First': {
    paragraphs: [
      'I reduced repetitive operational work by shipping a verified automation across workflow, AI, and business systems. That is the kind of practical delivery the Workflow Automation Engineer role calls for.',
      'The project started from a clear operational bottleneck, moved through integration design, and ended in a maintainable workflow the team could run without constant intervention. The outcome was less repetitive work and a cleaner path from request to completion.',
      'I focus on automations that survive real use: documented assumptions, reversible changes, and evidence tied to confirmed experience rather than inflated claims.',
    ],
    closer:
      'If useful, I can walk through the architecture, trade-offs, and measured outcome in a short conversation.',
    signOff: 'Best regards',
  },
  'Warm and Conversational': {
    paragraphs: [
      'I’m excited about the Workflow Automation Engineer role at Northstar Systems because it sits right where I like to work: turning a messy, repetitive process into something clearer and more reliable for the people who use it every day.',
      'I enjoy finding the small tasks that hold a team back, then shaping them into thoughtful automations. A recent project connecting workflow, AI, and business systems is a good example. I started with the real operational friction, then built a path the team could trust.',
      'What I value most is collaboration around the “why.” When requirements, constraints, and success measures are honest, the automation tends to stay useful long after the first demo.',
    ],
    closer:
      'I’d love to learn more about how your team reviews and ships automations and share how I’ve approached similar problems.',
    signOff: 'Best',
  },
};

interface ResumePreview {
  focus: string;
  order: string[];
  summary: string;
}

const defaultResume: ResumePreview = {
  summary: 'Automation specialist with hands-on workflow, API, and operations experience.',
  order: ['Summary', 'Skills', 'Experience', 'Projects', 'Education'],
  focus: 'Standard ATS-readable structure',
};

const resumeData: Record<string, ResumePreview> = {
  'ATS Professional': defaultResume,
  'Results Led': {
    summary: 'Workflow builder focused on reducing repetitive work through grounded automation.',
    order: ['Impact summary', 'Experience', 'Selected results', 'Skills', 'Education'],
    focus: 'Verified outcomes move upward',
  },
  'Technical Depth': {
    summary:
      'Technical automation specialist working across workflow, application, and AI systems.',
    order: ['Technical profile', 'Tool stack', 'Projects', 'Experience', 'Education'],
    focus: 'Tools and architecture become prominent',
  },
};

export function ClaimVerificationDemo() {
  const [blocked, setBlocked] = useState(false);
  return (
    <div className="truth-demo">
      <div className="fact-bank">
        <span className="small-label">Verified fact bank</span>
        {[
          'Project: Operations workflow',
          'Tools: workflow, AI, and business systems',
          'Outcome: Reduced repetitive work',
        ].map((fact) => (
          <div key={fact}>
            <ShieldCheck size={17} />
            {fact}
          </div>
        ))}
      </div>
      <div className="claim-path" aria-hidden="true">
        <i />
        <span>Evidence path</span>
        <i />
      </div>
      <div className={`claim-card ${blocked ? 'blocked' : 'safe'}`}>
        <span className="small-label">AI-assisted sentence</span>
        <p>
          {blocked
            ? 'Architected enterprise infrastructure for a Fortune 500 company.'
            : 'Developed an automated workflow connecting AI and business systems to reduce repetitive operational work.'}
        </p>
        <div>
          {blocked ? (
            <>
              <span className="block-icon">×</span>
              <strong>Unsupported claim removed</strong>
              <small>This statement is not backed by confirmed profile details.</small>
            </>
          ) : (
            <>
              <Check size={17} />
              <strong>Supported by the profile</strong>
              <small>The sentence uses only confirmed career details.</small>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setBlocked((value) => !value);
          }}
        >
          {blocked ? 'Show supported version' : 'Show an unsupported version'}
        </button>
      </div>
    </div>
  );
}

export function ApplicationPackDemo() {
  const [active, setActive] = useState('letter');
  const [letterStyle, setLetterStyle] = useState('Professional');
  const [resumeStyle, setResumeStyle] = useState('ATS Professional');
  const currentResume = resumeData[resumeStyle] ?? defaultResume;
  const professionalLetter = letterContent.Professional;
  if (!professionalLetter) throw new Error('Professional letter content is required.');
  const currentLetter = letterContent[letterStyle] ?? professionalLetter;
  const panel = useMemo(() => {
    if (active === 'letter')
      return (
        <DocumentPanel title="Cover letter" label="Profile-backed content">
          <Segmented
            options={Object.keys(letterContent)}
            value={letterStyle}
            onChange={setLetterStyle}
          />
          <p className="document-copy">Dear Northstar Systems team,</p>
          {currentLetter.paragraphs.map((paragraph) => (
            <p className="document-copy" key={paragraph.slice(0, 48)}>
              {paragraph}
            </p>
          ))}
          <p className="document-copy">{currentLetter.closer}</p>
          <p className="document-copy document-signoff">
            {currentLetter.signOff},
            <br />
            Alex Santos
          </p>
        </DocumentPanel>
      );
    if (active === 'resume')
      return (
        <DocumentPanel title="Tailored resume" label="Verified facts fixed">
          <Segmented
            options={Object.keys(resumeData)}
            value={resumeStyle}
            onChange={setResumeStyle}
          />
          <div className="resume-preview">
            <h5>{currentResume.summary}</h5>
            <span>{currentResume.focus}</span>
            {currentResume.order.map((section, index) => (
              <div key={section}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <strong>{section}</strong>
                <i />
              </div>
            ))}
          </div>
        </DocumentPanel>
      );
    if (active === 'interview')
      return (
        <DocumentPanel title="Interview preparation" label="Product visualization">
          <ul className="prep-list">
            <li>
              <strong>Likely question</strong>Walk us through an automation you designed end to end.
            </li>
            <li>
              <strong>Gap to prepare</strong>Frame client discovery work as transferable solutions
              experience.
            </li>
            <li>
              <strong>Ask the employer</strong>How does the team review automations before they
              reach production?
            </li>
          </ul>
        </DocumentPanel>
      );
    if (active === 'analysis')
      return (
        <DocumentPanel title="AI job analysis" label="Explainable verdict">
          <div className="analysis-bars">
            {[
              ['Career alignment', 92],
              ['Skills', 88],
              ['Experience', 76],
              ['Location', 100],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{value}%</b>
                <i>
                  <em style={{ width: `${value}%` }} />
                </i>
              </div>
            ))}
          </div>
        </DocumentPanel>
      );
    if (active === 'message')
      return (
        <DocumentPanel title="Recruiter message" label="Professional tone">
          <p className="document-copy">
            Hi Mara, I’m reaching out about the Workflow Automation Engineer role. My recent work
            connecting workflow, AI, and business systems aligns with the team’s focus. I’d be glad
            to share a concise project walkthrough.
          </p>
        </DocumentPanel>
      );
    return (
      <DocumentPanel title="Application checklist" label="Human review required">
        <ul className="check-list">
          <li>
            <Check size={15} /> Review role requirements
          </li>
          <li>
            <Check size={15} /> Confirm every document fact
          </li>
          <li>
            <span /> Add personal context
          </li>
          <li>
            <span /> Submit directly to employer
          </li>
        </ul>
      </DocumentPanel>
    );
  }, [active, letterStyle, resumeStyle, currentResume, currentLetter]);

  return (
    <div className="pack-demo">
      <div className="pack-map">
        <article className="source-job">
          <span>Strong Match · 88</span>
          <small>Northstar Systems</small>
          <h3>Workflow Automation Engineer</h3>
          <p>Remote · Philippines</p>
        </article>
        <div className="pack-spine">
          <span>
            <Sparkles size={17} />
          </span>
          <i />
        </div>
        <div className="pack-items" role="tablist" aria-label="Application Pack contents">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active === item.id}
              className={active === item.id ? 'active' : ''}
              onClick={() => {
                setActive(item.id);
              }}
            >
              <span>
                <item.icon size={17} />
              </span>
              <span>
                <small>0{index + 1}</small>
                {item.label}
              </span>
              <Check size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="pack-document" role="tabpanel">
        {panel}
      </div>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          type="button"
          role="tab"
          aria-selected={option === value}
          key={option}
          className={option === value ? 'active' : ''}
          onClick={() => {
            onChange(option);
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function DocumentPanel({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <article className="document-panel">
      <header>
        <div>
          <span>Application Pack / Product visualization</span>
          <h4>{title}</h4>
        </div>
        <strong>
          <ShieldCheck size={14} />
          {label}
        </strong>
      </header>
      <div className="document-page">{children}</div>
      <footer>Facts and dates remain fixed across every style.</footer>
    </article>
  );
}
