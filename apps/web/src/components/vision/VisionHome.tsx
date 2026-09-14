'use client';

import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Boxes,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  FileCheck2,
  Filter,
  Globe2,
  Layers3,
  MapPin,
  Radar,
  SearchCheck,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { CareerRadarSimulator } from '@/components/radar/CareerRadarSimulator';
import {
  ApplicationPackDemo,
  ClaimVerificationDemo,
} from '@/components/application/ApplicationPackDemo';
import {
  AdminPreview,
  ProductDashboardPreview,
  ResumeComparison,
} from '@/components/product/ProductPreviews';
import { faqItems, plans, principles, productStatus, roadmap } from '@/content/landing';
import { motionTokens, reveal } from '@/lib/motion';
import { CareerSignalPreview } from '@/components/vision/CareerSignalPreview';
import { CareerConstellationScene } from '@/components/three/ProductScenes';
import { PreviewDialog } from '@/components/preview-dialog';

const introSteps = [
  'Role discovered',
  'Constraints cleared',
  'Evidence matched',
  'Recommendation ready',
];

export function VisionHome() {
  return (
    <div className="vision-home">
      <Hero />
      <HowItWorks />
      <Problem />
      <CareerRadar />
      <CandidateJourney />
      <CareerProfile />
      <JobIntelligence />
      <ClaimVerification />
      <ApplicationPacks />
      <ResumeSection />
      <DashboardSection />
      <AdminSection />
      <PricingSection />
      <RoadmapPreview />
      <ArchitecturePreview />
      <MobileFuture />
      <Principles />
      <FaqSection />
      <FinalCta />
    </div>
  );
}

function Hero() {
  const reduced = useReducedMotion();
  const [introStep, setIntroStep] = useState(0);
  useEffect(() => {
    if (reduced) {
      const frame = window.requestAnimationFrame(() => {
        setIntroStep(introSteps.length);
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    if (introStep >= introSteps.length) return;
    const timer = window.setTimeout(() => {
      setIntroStep((step) => step + 1);
    }, 680);
    return () => {
      window.clearTimeout(timer);
    };
  }, [introStep, reduced]);
  return (
    <section id="vision" className="hero-section">
      <div className="hero-grid-bg" aria-hidden="true" />
      <div className="hero-copy">
        <motion.div
          className="status-kicker"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <span />
          Registration available now <small>Career profile and radar available now</small>
        </motion.div>
        <motion.h1
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.15, duration: 0.7, ease: motionTokens.ease }}
        >
          Your career radar
          <br />
          never stops <em>searching.</em>
        </motion.h1>
        <motion.p
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ delay: reduced ? 0 : 0.4, duration: 0.6 }}
        >
          Hanaply continuously discovers fresh jobs, evaluates them against your real Career
          Profile, and prepares truthful application materials for opportunities worth pursuing.
        </motion.p>
        <motion.p
          className="hero-release-note"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ delay: reduced ? 0 : 0.5, duration: 0.6 }}
        >
          Hanaply is being released in phases. Account registration is available now.
        </motion.p>
        <motion.div
          className="hero-actions"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ delay: reduced ? 0 : 0.6 }}
        >
          <Link className="primary-button" href="/register">
            Create your account <ArrowRight size={18} />
          </Link>
          <a className="secondary-button" href="#how-it-works">
            See how Hanaply works <ArrowDown size={17} />
          </a>
        </motion.div>
        <div className="hero-text-links">
          <a href="#pricing">View plans</a>
          <a href="#roadmap">View build status</a>
          <span>Built first for Filipino professionals. Designed to scale globally.</span>
        </div>
        <div className="hero-proof">
          <div>
            <strong>01</strong>
            <span>
              Discover
              <br />
              fresh signals
            </span>
          </div>
          <div>
            <strong>02</strong>
            <span>
              Explain
              <br />
              real fit
            </span>
          </div>
          <div>
            <strong>03</strong>
            <span>
              Prepare
              <br />
              truthful packs
            </span>
          </div>
        </div>
      </div>
      <div className="hero-visual">
        <span className="preview-label">Product preview · Demonstration data</span>
        <span className="radar-sweep landing-test-radar" aria-hidden="true" />
        <div className="hero-scene-head">
          <div>
            <span>OPPORTUNITY REVIEW</span>
            <strong>
              {introStep >= introSteps.length ? 'Recommendation ready' : introSteps[introStep]}
            </strong>
          </div>
          {introStep < introSteps.length && (
            <button
              type="button"
              onClick={() => {
                setIntroStep(introSteps.length);
              }}
            >
              Show result
            </button>
          )}
        </div>
        <CareerSignalPreview step={introStep} />
      </div>
      <div className="hero-scroll">
        <span>Scroll to enter the system</span>
        <i />
      </div>
    </section>
  );
}

const howItWorksSteps = [
  {
    icon: UserRoundCheck,
    number: '01',
    title: 'Build one trusted Career Profile',
    copy: 'Add verified experience, skills, projects, preferences, and goals.',
    status: 'Available now',
    href: '#career-profile',
  },
  {
    icon: Radar,
    number: '02',
    title: 'Let Career Radar find worthwhile roles',
    copy: 'Hanaply filters noise, evaluates requirements, and explains your real fit.',
    status: 'Available now',
    href: '#career-radar',
  },
  {
    icon: FileCheck2,
    number: '03',
    title: 'Prepare stronger applications',
    copy: 'Create truthful resumes, cover letters, recruiter messages, and interview preparation.',
    status: 'In development',
    href: '#application-packs',
  },
] as const;

function HowItWorks() {
  return (
    <section id="how-it-works" className="how-it-works-section section-pad">
      <div className="content-shell">
        <div className="how-it-works-heading">
          <span className="eyebrow">How Hanaply works</span>
          <h2>
            One trusted profile.
            <br />
            <em>One clearer path from discovery to application.</em>
          </h2>
          <p>
            Account registration is available now. The connected career intelligence journey below
            shows what Hanaply is building next.
          </p>
        </div>
        <div className="how-it-works-flow">
          {howItWorksSteps.map(({ icon: Icon, ...step }, index) => (
            <a href={step.href} key={step.title}>
              <span className="step-icon">
                <Icon aria-hidden="true" size={24} />
              </span>
              <small>{step.number}</small>
              <strong>{step.title}</strong>
              <p>{step.copy}</p>
              <span className="step-status">{step.status}</span>
              {index < howItWorksSteps.length - 1 ? (
                <i className="step-connector" aria-hidden="true">
                  <ArrowRight size={18} />
                </i>
              ) : null}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionIntro({
  index,
  eyebrow,
  title,
  copy,
  light = false,
  cta,
}: {
  index: string;
  eyebrow: string;
  title: React.ReactNode;
  copy: string;
  light?: boolean;
  cta?: { label: string; href?: string };
}) {
  return (
    <motion.div {...reveal} className={`section-intro ${light ? 'light' : ''}`}>
      <div className="section-index">
        <span>{index}</span>
        <i />
      </div>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
        {cta ? (
          <a className="section-pricing-cta" href={cta.href ?? '#pricing'}>
            {cta.label} <ArrowRight aria-hidden="true" size={15} />
          </a>
        ) : null}
      </div>
    </motion.div>
  );
}

function Problem() {
  const [level, setLevel] = useState(0);
  const stages = ['Unfiltered feed', 'Rules applied', 'Meaningful set'];
  const jobs = [
    ['Senior Sales Director', 'Hard blocker', 'block'],
    ['Automation Specialist', 'Strong signal', 'strong'],
    ['Unpaid AI Intern', 'Excluded', 'dim'],
    ['Workflow Developer', 'Strong signal', 'strong'],
    ['Night Shift VA', 'Excluded', 'dim'],
    ['Automation Specialist', 'Duplicate', 'duplicate'],
    ['Platform VP', 'Hard blocker', 'block'],
    ['n8n Developer', 'Stretch', 'stretch'],
  ];
  return (
    <section className="problem-section">
      <div className="content-shell">
        <SectionIntro
          index="01"
          eyebrow="The problem"
          title={
            <>
              More listings do not create
              <br />
              <em>better decisions.</em>
            </>
          }
          copy="Job boards flood people with roles, but rarely understand their direction, evidence, constraints, or real chances."
          light
          cta={{ label: 'Cut the noise with a plan' }}
        />
        <div className="noise-lab">
          <div className="noise-controls">
            <div>
              <span>Noise reduction</span>
              <strong>{stages[level]}</strong>
            </div>
            <div role="group" aria-label="Noise filtering stage">
              {stages.map((stage, index) => (
                <button
                  type="button"
                  key={stage}
                  className={level === index ? 'active' : ''}
                  onClick={() => {
                    setLevel(index);
                  }}
                >
                  <span>0{index + 1}</span>
                  {stage}
                </button>
              ))}
            </div>
          </div>
          <div className={`job-noise-grid level-${level}`}>
            {jobs.map(([role, status, kind], index) => (
              <article key={`${role}-${index}`} className={kind}>
                <div>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {kind === 'block' ? (
                    <Ban size={15} />
                  ) : kind === 'dim' ? (
                    <X size={15} />
                  ) : kind === 'duplicate' ? (
                    <Layers3 size={15} />
                  ) : (
                    <Target size={15} />
                  )}
                </div>
                <small>
                  {
                    ['Northstar Systems', 'Atlas Workflow', 'Meridian Support', 'Pinebridge Labs'][
                      index % 4
                    ]
                  }
                </small>
                <h3>{role}</h3>
                <p>{status}</p>
              </article>
            ))}
          </div>
          <div className="noise-result">
            <Filter size={18} />
            <p>
              <strong>{level === 0 ? '8' : level === 1 ? '5' : '3'} signals remain</strong>
              {level === 0
                ? 'No career context applied'
                : level === 1
                  ? 'Exclusions and duplicates removed'
                  : 'Two strong matches and one stretch opportunity'}
            </p>
            <button
              type="button"
              onClick={() => {
                setLevel((value) => Math.min(value + 1, 2));
              }}
              disabled={level === 2}
            >
              {level === 2 ? (
                <>
                  <Check size={15} /> Noise reduced
                </>
              ) : (
                <>
                  Apply next layer <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CareerRadar() {
  return (
    <section id="career-radar" className="radar-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="02"
          eyebrow="Career Radar"
          title={
            <>
              Find the roles that make sense
              <br />
              <em>for this person.</em>
            </>
          }
          copy="Configure a fictional career profile and watch Hanaply turn a field of sample jobs into an explainable opportunity set."
          cta={{ label: 'Unlock Career Radar' }}
        />
        <CareerRadarSimulator />
        <PreviewDialog
          title="Career Radar"
          description="Explore the demonstration at a larger size. All opportunities and scores are fictional."
        >
          <CareerRadarSimulator />
        </PreviewDialog>
        <p className="demo-disclaimer">
          <ShieldCheck size={15} /> All employers, profiles, scores, and jobs shown here are
          fictional demonstration data.
        </p>
      </div>
    </section>
  );
}

const journeyStages = [
  ['Profile', 'Alex adds verified skills and experience.'],
  ['Discovery', 'Career Radar finds a sample role.'],
  ['Filter', 'Location and career constraints are cleared.'],
  ['Match', 'Verified evidence supports the requirements.'],
  ['Explain', 'Strengths and gaps shape the recommendation.'],
  ['Prepare', 'A truthful Application Pack is assembled.'],
  ['Review', 'Alex reviews before submitting externally.'],
] as const;

function CandidateJourney() {
  return (
    <section className="candidate-journey-section section-pad" aria-labelledby="journey-title">
      <div className="content-shell">
        <div className="journey-heading">
          <div>
            <span className="eyebrow">One connected candidate journey</span>
            <h2 id="journey-title">
              Meet Alex Santos.
              <br />
              <em>See one opportunity move through the system.</em>
            </h2>
          </div>
          <span className="demo-data-badge">Demonstration data</span>
        </div>
        <div className="journey-profile">
          <div className="journey-avatar" aria-hidden="true">
            AS
          </div>
          <div>
            <span>AI Automation Specialist</span>
            <strong>Alex Santos</strong>
            <small>
              <MapPin aria-hidden="true" size={14} /> Philippines
            </small>
          </div>
          <ul aria-label="Alex Santos sample skills">
            {['n8n', 'Supabase', 'OpenAI', 'TypeScript', 'Workflow automation'].map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
          <div className="journey-opportunity">
            <SearchCheck aria-hidden="true" size={20} />
            <span>Sample opportunity</span>
            <strong>Workflow Automation Engineer</strong>
            <small>Northstar Systems</small>
          </div>
        </div>
        <ol className="journey-timeline">
          {journeyStages.map(([stage, copy], index) => (
            <li key={stage}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage}</strong>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CareerProfile() {
  return (
    <section id="career-profile" className="constellation-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="03"
          eyebrow="Career evidence map"
          title={
            <>
              A career is more than
              <br />
              <em>a keyword list.</em>
            </>
          }
          copy="Hanaply connects verified experience, skills, projects, tools, preferences, and goals to the requirements of a real role."
          light
          cta={{ label: 'Build your evidence map' }}
        />
        <div className="constellation-layout">
          <CareerConstellationScene />
          <div className="constellation-copy">
            <span className="eyebrow">How evidence flows</span>
            <h3>A job activates only the facts that matter.</h3>
            <p>
              The map shows a verified profile on the left, relevant evidence in the center, and a
              sample role on the right. Missing requirements stay separate. Hard blockers never hide
              behind an average score.
            </p>
            <dl>
              <div>
                <dt>
                  <i className="mint" />
                  Verified match
                </dt>
                <dd>Evidence directly supports a requirement.</dd>
              </div>
              <div>
                <dt>
                  <i className="blue" />
                  Transferable
                </dt>
                <dd>Related experience can carry into the role.</dd>
              </div>
              <div>
                <dt>
                  <i className="coral" />
                  Hard blocker
                </dt>
                <dd>A constraint makes the role unrealistic now.</dd>
              </div>
            </dl>
          </div>
        </div>
        <PreviewDialog
          title="Career Profile"
          description="Inspect the demonstration evidence map at a larger size."
        >
          <CareerConstellationScene />
        </PreviewDialog>
      </div>
    </section>
  );
}

const dimensions = [
  ['Career alignment', 92],
  ['Skills alignment', 88],
  ['Experience', 76],
  ['Seniority', 81],
  ['Compensation', 90],
  ['Location', 100],
  ['Education', 68],
  ['Certifications', 55],
  ['Freshness', 96],
  ['Competitiveness', 72],
] as const;

const requirementInsights = {
  Responsibilities: {
    extracted:
      'Build reliable client automations and translate operational needs into documented workflows.',
    context:
      'This is the core work of the role, so Hanaply compares it with delivered projects instead of job-title similarity.',
    verified: ['Workflow delivery', 'Built and documented n8n automations'],
    transferable: ['Client discovery', 'Operations interviews map to solution discovery'],
    gap: ['Solution diagrams', 'Formal architecture diagrams need practice'],
    dimensions: ['Career alignment', 'Experience'],
    effect: 'Strengthens the match',
    verdict: "The sample profile already shows the role's main work in real projects.",
  },
  'Required skills': {
    extracted:
      'Hands-on n8n, API integration, workflow debugging, and clear technical documentation.',
    context:
      'Required skills carry more weight than preferred tools because the role expects them from day one.',
    verified: ['n8n + API integration', 'Direct evidence appears in two sample projects'],
    transferable: [
      'TypeScript + backend systems',
      'Backend experience supports workflow debugging',
    ],
    gap: ['Enterprise monitoring', 'Production observability is not yet verified'],
    dimensions: ['Skills alignment', 'Experience'],
    effect: 'Supports a strong fit',
    verdict:
      'The essential technical requirements are covered; one production-depth gap remains visible.',
  },
  'Preferred skills': {
    extracted:
      'Experience with AI-assisted workflows, process mapping, and customer-facing delivery is preferred.',
    context:
      'Preferred skills improve competitiveness, but missing one should not become a hard blocker.',
    verified: ['Process documentation', 'Verified workflow documentation is relevant'],
    transferable: ['AI workflow design', 'Prototype work transfers to this preference'],
    gap: ['Vendor certification', 'Useful, but not required for application'],
    dimensions: ['Skills alignment', 'Competitiveness'],
    effect: 'Adds supporting evidence',
    verdict:
      'The profile meets enough preferences to stay competitive without overstating expertise.',
  },
  Experience: {
    extracted:
      'Two or more years delivering automation or technical operations projects for real users.',
    context: 'Hanaply separates years of relevant work from years spent under an identical title.',
    verified: ['3 years of delivery', 'Workflow and operations projects meet the threshold'],
    transferable: ['Technical operations', 'Adjacent delivery experience counts as relevant'],
    gap: ['Role-title history', 'No formal Solutions Engineer title'],
    dimensions: ['Experience', 'Seniority'],
    effect: 'Meets the experience bar',
    verdict: 'Relevant delivery evidence matters more here than an exact previous title.',
  },
  Education: {
    extracted: 'A technical degree or equivalent practical experience is acceptable.',
    context:
      'The posting explicitly accepts equivalent experience, so education is not treated as a blocker.',
    verified: ['Relevant coursework', 'Information systems coursework is recorded'],
    transferable: ['Practical experience', 'Delivered systems support equivalency'],
    gap: ['Completed degree', 'A completed technical degree is not verified'],
    dimensions: ['Education', 'Certifications'],
    effect: 'Keeps the role viable',
    verdict:
      "Practical experience offsets the education gap under the employer's stated requirement.",
  },
  Location: {
    extracted:
      'Applicants must be based in the Philippines and able to overlap with Manila business hours.',
    context: 'Location is checked as a deterministic constraint before softer matching dimensions.',
    verified: ['Philippines eligibility', 'Sample profile is based in Manila'],
    transferable: ['Time-zone overlap', 'Existing work history matches required hours'],
    gap: ['Occasional travel', 'Quarterly Makati travel needs confirmation'],
    dimensions: ['Location'],
    effect: 'Clears a hard constraint',
    verdict:
      'The role remains actionable because location and working-hour requirements are satisfied.',
  },
  'Work arrangement': {
    extracted: 'Remote-first, with optional team days and quarterly in-person planning in Makati.',
    context:
      'The arrangement is compared with explicit work preferences rather than inferred from keywords.',
    verified: ['Remote preference', 'Remote or hybrid work is selected'],
    transferable: ['Hybrid collaboration', 'Prior hybrid delivery supports team days'],
    gap: ['Planning travel', 'Quarterly attendance still needs confirmation'],
    dimensions: ['Career alignment', 'Location'],
    effect: 'Matches work preferences',
    verdict: 'The normal arrangement fits; only occasional travel needs a human review.',
  },
  Compensation: {
    extracted: 'The posted range is ₱80,000–₱110,000 per month, subject to final leveling.',
    context:
      "Hanaply checks the disclosed range against the person's target without inventing an offer.",
    verified: ['Target range overlap', 'The sample target sits inside the posted range'],
    transferable: ['Leveling flexibility', 'Relevant projects support mid-level review'],
    gap: ['Total package', 'Benefits and equity are not disclosed'],
    dimensions: ['Compensation'],
    effect: 'Meets the salary target',
    verdict: 'Base compensation aligns, while undisclosed package details remain a review item.',
  },
} as const;

type RequirementName = keyof typeof requirementInsights;

function JobIntelligencePreview({
  instanceId,
  showEnlarge = false,
}: {
  instanceId: string;
  showEnlarge?: boolean;
}) {
  const [selected, setSelected] = useState<RequirementName>('Responsibilities');
  const requirements = Object.keys(requirementInsights) as RequirementName[];
  const insight = requirementInsights[selected];
  return (
    <section className="intelligence-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="04"
          eyebrow="AI job intelligence"
          title={
            <>
              Not “do the keywords match?”
              <br />
              <em>Does this role make sense?</em>
            </>
          }
          copy="A verdict is the result of visible dimensions, extracted requirements, deterministic blockers, and grounded career evidence."
          cta={{ label: 'Get explainable matches' }}
        />
        <div className="intelligence-console">
          <div className="requirement-pane">
            <div className="console-label">
              <Code2 size={16} /> Requirement extraction <strong>DEMONSTRATION DATA</strong>
            </div>
            <div className="jd-card">
              <span>Northstar Systems</span>
              <h3>Workflow Automation Engineer</h3>
              <p>
                Build and maintain client automations, translate operational needs, document
                reliable workflows, and partner with technical teams.
              </p>
            </div>
            <p className="requirement-helper">
              Choose a requirement to inspect its evidence and see how it affects the
              recommendation.
            </p>
            <div
              className="requirement-list"
              role="tablist"
              aria-label="Extracted job requirements"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const tabs = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                ];
                const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : event.key === 'ArrowDown'
                        ? (current + 1) % tabs.length
                        : (current - 1 + tabs.length) % tabs.length;
                tabs[next]?.focus();
                tabs[next]?.click();
              }}
            >
              {requirements.map((item, index) => (
                <button
                  type="button"
                  id={`${instanceId}-requirement-tab-${index}`}
                  role="tab"
                  aria-selected={selected === item}
                  aria-controls={`${instanceId}-classified-requirement-panel`}
                  tabIndex={selected === item ? 0 : -1}
                  key={item}
                  className={selected === item ? 'active' : ''}
                  onClick={() => {
                    setSelected(item);
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {item}
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          </div>
          <div
            className="classification-pane"
            id={`${instanceId}-classified-requirement-panel`}
            role="tabpanel"
            aria-labelledby={`${instanceId}-requirement-tab-${requirements.indexOf(selected)}`}
            aria-live="polite"
          >
            <div className="console-label">
              <Sparkles size={16} /> Classified requirements <span>Inspecting: {selected}</span>
            </div>
            <div className="selection-explanation" key={selected}>
              <span>EXTRACTED REQUIREMENT</span>
              <strong>{insight.extracted}</strong>
              <p>{insight.context}</p>
            </div>
            <div className="classification-cards">
              <article className="verified">
                <Check size={16} />
                <div>
                  <span>Verified match</span>
                  <strong>{insight.verified[0]}</strong>
                  <small>{insight.verified[1]}</small>
                </div>
              </article>
              <article className="transfer">
                <ArrowRight size={16} />
                <div>
                  <span>Transferable</span>
                  <strong>{insight.transferable[0]}</strong>
                  <small>{insight.transferable[1]}</small>
                </div>
              </article>
              <article className="learnable">
                <Clock3 size={16} />
                <div>
                  <span>Gap to review</span>
                  <strong>{insight.gap[0]}</strong>
                  <small>{insight.gap[1]}</small>
                </div>
              </article>
            </div>
            <div className="dimension-chart">
              {dimensions.map(([label, score]) => (
                <div
                  className={
                    (insight.dimensions as readonly string[]).includes(label) ? 'selected' : ''
                  }
                  key={label}
                >
                  <span>{label}</span>
                  <i>
                    <em style={{ width: `${score}%` }} />
                  </i>
                  <strong>{score}</strong>
                </div>
              ))}
            </div>
            <div className="verdict-card">
              <span className="signal-orb mint" />
              <div>
                <small>HOW THIS AFFECTS THE VERDICT</small>
                <strong>{insight.effect}</strong>
                <p>{insight.verdict}</p>
              </div>
              <b>88</b>
            </div>
          </div>
        </div>
        {showEnlarge ? (
          <PreviewDialog
            title="Job Intelligence"
            description="Inspect the fictional requirement analysis and explained match at a larger size."
          >
            <JobIntelligencePreview instanceId="dialog-job-intelligence" />
          </PreviewDialog>
        ) : null}
      </div>
    </section>
  );
}

export function JobIntelligence() {
  return <JobIntelligencePreview instanceId="page-job-intelligence" showEnlarge />;
}

function ClaimVerification() {
  return (
    <section className="claim-verification-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="05"
          eyebrow="Claim verification"
          title={
            <>
              AI should help you present the truth,
              <br />
              <em>not invent a career.</em>
            </>
          }
          copy="Before a document is shown, Hanaply compares its claims with confirmed career details and removes anything unsupported."
          light
          cta={{ label: 'Keep every claim honest' }}
        />
        <ClaimVerificationDemo />
        <PreviewDialog
          title="Claim verification"
          description="Review the fictional claim-verification demonstration at a larger size."
        >
          <ClaimVerificationDemo />
        </PreviewDialog>
      </div>
    </section>
  );
}

function ApplicationPacks() {
  return (
    <section id="application-packs" className="pack-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="06"
          eyebrow="Application Pack assembly"
          title={
            <>
              One worthwhile signal.
              <br />
              <em>A complete, truthful next step.</em>
            </>
          }
          copy="After a strong match is explained, Hanaply prepares a coordinated set of materials for the person to review and use."
          cta={{ label: 'Include Application Packs' }}
        />
        <ApplicationPackDemo />
        <PreviewDialog
          title="Application Pack"
          description="Review the fictional application materials at a larger size."
        >
          <ApplicationPackDemo />
        </PreviewDialog>
      </div>
    </section>
  );
}

function ResumeSection() {
  return (
    <section className="resume-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="07"
          eyebrow="Resume variation"
          title={
            <>
              Strategy changes the story.
              <br />
              <em>Templates change the frame.</em>
            </>
          }
          copy="Content order and visual presentation are independent choices. Both stay ATS-aware and preserve verified facts."
          cta={{ label: 'Try resume strategies' }}
        />
        <ResumeComparison />
        <PreviewDialog
          title="Resume comparison"
          description="Compare the demonstration resume strategies at a larger size."
        >
          <ResumeComparison />
        </PreviewDialog>
      </div>
    </section>
  );
}

function DashboardSection() {
  return (
    <section className="dashboard-section section-pad">
      <div className="wide-shell">
        <SectionIntro
          index="08"
          eyebrow="Customer experience"
          title={
            <>
              A dashboard designed around
              <br />
              <em>decisions, not feeds.</em>
            </>
          }
          copy="Account access is available today. The career signals shown in this workspace are clearly labeled previews of the experience being built next."
          light
          cta={{ label: 'Open your workspace' }}
        />
        <ProductDashboardPreview />
        <PreviewDialog
          title="Customer dashboard"
          description="Explore the demonstration workspace at a larger size."
        >
          <ProductDashboardPreview />
        </PreviewDialog>
      </div>
    </section>
  );
}
function AdminSection() {
  return (
    <section className="admin-section section-pad">
      <div className="wide-shell">
        <SectionIntro
          index="09"
          eyebrow="Admin control center"
          title={
            <>
              Operations should be configurable,
              <br />
              <em>auditable, and reversible.</em>
            </>
          }
          copy="Hanaply is designed with careful controls for accounts, sessions, security, and important changes. Future career intelligence will follow the same accountable approach."
          cta={{ label: 'Compare plan limits' }}
        />
        <AdminPreview />
        <PreviewDialog
          title="Admin control center"
          description="Explore the demonstration operations preview at a larger size."
        >
          <AdminPreview />
        </PreviewDialog>
      </div>
    </section>
  );
}

function PricingSection() {
  const [annual, setAnnual] = useState(true);
  return (
    <section id="pricing" className="pricing-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="10"
          eyebrow="Plan catalog"
          title={
            <>
              Choose the plan that keeps
              <br />
              <em>your search moving.</em>
            </>
          }
          copy="Start with one focused career direction or unlock deeper intelligence across multiple paths. Annual billing saves 20%."
        />
        <ul className="pricing-benefits" aria-label="Plan benefits">
          <li>
            <Check aria-hidden="true" size={16} /> Transparent limits
          </li>
          <li>
            <Check aria-hidden="true" size={16} /> Save 20% annually
          </li>
          <li>
            <Check aria-hidden="true" size={16} /> No payment today
          </li>
        </ul>
        <div className="pricing-toolbar">
          <div className="pricing-toolbar-copy">
            <strong>Choose your billing preference</strong>
            <span>Simple pricing in Philippine pesos</span>
          </div>
          <div role="group" aria-label="Billing interval">
            <button
              aria-pressed={!annual}
              type="button"
              onClick={() => {
                setAnnual(false);
              }}
              className={!annual ? 'active' : ''}
            >
              Monthly
            </button>
            <button
              aria-pressed={annual}
              type="button"
              onClick={() => {
                setAnnual(true);
              }}
              className={annual ? 'active' : ''}
            >
              Annual <span>Save 20%</span>
            </button>
          </div>
        </div>
        <div className="plan-grid">
          {plans.map((plan) => {
            const monthlyEquivalent = Math.round(plan.annual / 12);
            const savings = plan.monthly * 12 - plan.annual;
            const featured = plan.name === 'Pro';
            return (
              <article key={plan.name} className={featured ? 'featured' : ''}>
                {featured ? (
                  <div className="plan-popular">
                    <Sparkles aria-hidden="true" size={15} /> Most popular
                  </div>
                ) : null}
                <header>
                  <div>
                    <span>{featured ? 'DEEPER INTELLIGENCE' : 'FOCUSED RADAR'}</span>
                    <h3>{plan.name}</h3>
                  </div>
                </header>
                <p>{plan.description}</p>
                <div className="plan-price-block">
                  <div className="price">
                    <small>₱</small>
                    <strong>
                      {annual ? monthlyEquivalent.toLocaleString() : plan.monthly.toLocaleString()}
                    </strong>
                    <span>
                      per month
                      {annual ? <small>when billed annually</small> : null}
                    </span>
                  </div>
                  {annual ? (
                    <div className="billing-summary has-savings">
                      <span>Billed ₱{plan.annual.toLocaleString()} per year</span>
                      <strong>Save ₱{savings.toLocaleString()} / year</strong>
                    </div>
                  ) : null}
                </div>
                <div className="plan-includes">
                  <span>What you get</span>
                  <small>
                    {featured ? 'For ambitious, multi-track searches' : 'For one focused path'}
                  </small>
                </div>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <span className="feature-check">
                        <Check aria-hidden="true" size={15} />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/register?plan=${plan.name.toLowerCase()}&billing=${annual ? 'annual' : 'monthly'}`}
                >
                  Start with {plan.name} <ArrowRight aria-hidden="true" size={18} />
                </Link>
                <small className="plan-assurance">Create your account · No payment today</small>
              </article>
            );
          })}
        </div>
        <p className="pricing-note">
          Pick the direction that fits you today. Paid access is activated through the manual
          Activation Center after an authorized review, and no payment is collected when you create
          your account.
        </p>
      </div>
    </section>
  );
}

function RoadmapPreview() {
  return (
    <section id="roadmap" className="roadmap-preview section-pad">
      <div className="content-shell">
        <SectionIntro
          index="11"
          eyebrow="Product journey"
          title={
            <>
              A roadmap built from gates,
              <br />
              <em>not wishful dates.</em>
            </>
          }
          copy="Hanaply is being built in deliberate stages, starting with your account and expanding into guided discovery, matching, and application support."
          light
        />
        <div className="route-map">
          <div className="route-line" />
          {roadmap.map((phase, index) => (
            <Link href="/help" key={phase.id} className={index < 2 ? 'featured' : ''}>
              <span>{phase.number}</span>
              <div>
                <small>{phase.status}</small>
                <strong>{phase.title}</strong>
              </div>
              <ArrowUpRight size={16} />
            </Link>
          ))}
        </div>
        <div className="section-cta">
          <div>
            <span>Account access is available · Career intelligence is next</span>
            <p>See what works today and what is planned for the complete Hanaply experience.</p>
          </div>
          <Link className="primary-button light-button" href="/help">
            Read current release status <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function ArchitecturePreview() {
  const flow = ['Sources', 'Normalize', 'Match', 'Analyze', 'Verify claims', 'Pack', 'Clients'];
  return (
    <section id="architecture" className="architecture-preview section-pad">
      <div className="content-shell">
        <SectionIntro
          index="12"
          eyebrow="How Hanaply works"
          title={
            <>
              One career system.
              <br />
              <em>Many trusted surfaces.</em>
            </>
          }
          copy="Your profile, preferences, opportunities, and application materials work together as one connected career system without making you repeat the same work."
        />
        <div className="architecture-stage">
          <div className="arch-flow">
            {flow.map((item, index) => (
              <div key={item} className={index === 4 ? 'protected' : ''}>
                <span>
                  {index === 4 ? (
                    <ShieldCheck size={17} />
                  ) : index < 2 ? (
                    <Globe2 size={17} />
                  ) : index > 4 ? (
                    <FileCheck2 size={17} />
                  ) : (
                    <Boxes size={17} />
                  )}
                </span>
                <strong>{item}</strong>
                {index < flow.length - 1 && (
                  <i>
                    <ArrowRight size={14} />
                  </i>
                )}
              </div>
            ))}
          </div>
          <div className="arch-support">
            <span>Private account access</span>
            <span>Protected career data</span>
            <span>Reliable connections</span>
            <span>Activity history</span>
            <span>Controlled releases</span>
          </div>
        </div>
        <div className="section-cta dark-cta">
          <div>
            <span>Security before scale</span>
            <p>
              See the controls protecting account access, career information, permissions, and
              important activity.
            </p>
          </div>
          <Link className="primary-button" href="/security">
            Explore security <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function MobileFuture() {
  return (
    <section id="mobile" className="mobile-section section-pad">
      <div className="content-shell">
        <SectionIntro
          index="13"
          eyebrow="Mobile future"
          title={
            <>
              Built for the web first.
              <br />
              <em>Designed for mobile from day one.</em>
            </>
          }
          copy="Hanaply is designed so your profile, opportunities, and application materials can move with you from the web to future mobile experiences."
          light
        />
        <div className="mobile-platform-map">
          <div className="surface-row">
            <article className="surface web">
              <Globe2 size={23} />
              <span>Web experience</span>
              <small>Available first</small>
            </article>
            <article className="surface ios">
              <Smartphone size={23} />
              <span>iPhone app</span>
              <small>Planned</small>
            </article>
            <article className="surface android">
              <Smartphone size={23} />
              <span>Android app</span>
              <small>Planned</small>
            </article>
          </div>
          <div className="mobile-data-path">
            <i />
            <span>ONE PROFILE · CONTINUOUS CAREER CONTEXT</span>
            <i />
          </div>
          <div className="platform-core">
            <div>
              <span className="brand-mark">
                <i />
                <i />
                <i />
              </span>
              <span>
                <strong>Your Hanaply career system</strong>
                <small>One connected experience across every device</small>
              </span>
            </div>
            <div className="platform-layers">
              <span>Your profile</span>
              <span>Job matches</span>
              <span>Career guidance</span>
              <span>Application packs</span>
            </div>
          </div>
          <div className="mobile-capabilities">
            <span>Push notifications</span>
            <span>Deep links</span>
            <span>Saved progress</span>
            <span>Personal preferences</span>
          </div>
        </div>
        <p className="demo-disclaimer inverse">
          <Smartphone size={15} /> Mobile applications remain future product direction and are not
          currently available.
        </p>
      </div>
    </section>
  );
}

function Principles() {
  return (
    <section className="principles-section section-pad" id="principles">
      <div className="content-shell">
        <SectionIntro
          index="14"
          eyebrow="Built on trust"
          title={
            <>
              Built to help you apply honestly
              <br />
              <em>and intelligently.</em>
            </>
          }
          copy="These practical commitments shape how Hanaply explains decisions, protects your information, and prepares work for your review."
        />
        <div className="principles-list">
          {principles.map(([title, copy], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <i />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="faq-section section-pad" id="faq">
      <div className="content-shell">
        <div className="faq-layout">
          <div className="faq-intro">
            <span className="eyebrow">Before you create an account</span>
            <h2>
              Clear answers.
              <br />
              <em>No inflated promises.</em>
            </h2>
            <p>
              Hanaply is being released in phases. Here is what you can use now and what the product
              previews are designed to demonstrate.
            </p>
            <div className="product-status-list" aria-label="Current product status">
              {productStatus.map((item) => (
                <div key={item.feature}>
                  <span>{item.feature}</span>
                  <strong>{item.status}</strong>
                </div>
              ))}
            </div>
            <a className="section-pricing-cta" href="#roadmap">
              View the product roadmap <ArrowRight aria-hidden="true" size={15} />
            </a>
          </div>
          <div className="faq-list">
            {faqItems.map((item, index) => (
              <details key={item.question}>
                <summary>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {item.question}
                  <i aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final-cta-section section-pad">
      <div className="content-shell">
        <div className="final-statement">
          <span className="status-kicker">
            <i />
            REGISTRATION AVAILABLE NOW
          </span>
          <h2>
            Build the Career Profile
            <br />
            your next application can trust.
          </h2>
          <div>
            <p>
              Registration is available. Hanaply’s Activation Center, Career Radar, and application
              tools are being released in phases.
            </p>
            <div>
              <Link className="primary-button light-button" href="/register">
                Create your Hanaply account <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <a className="secondary-button inverse-button" href="#roadmap">
                Explore the product roadmap <ArrowUpRight aria-hidden="true" size={17} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
