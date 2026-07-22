import { Badge, Card, LinkButton } from '@hanaply/ui';
import { ArrowRight, BellRing, FileCheck2, Radar, ShieldCheck, Sparkles } from 'lucide-react';

import { CareerRadar } from '@/components/career-radar';

const foundations = [
  {
    icon: Radar,
    title: 'Fresh opportunity discovery',
    copy: 'A future source network will monitor approved APIs, ATS feeds, and company career pages from one secure backend.',
  },
  {
    icon: Sparkles,
    title: 'Explainable career intelligence',
    copy: 'Your verified experience and preferences will shape every match explanation, gap, and recommendation.',
  },
  {
    icon: FileCheck2,
    title: 'Truthful application preparation',
    copy: 'Application Packs will use verified facts only and remain under your review before you apply.',
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero-section">
        <div className="hero-inner">
          <div className="hero-copy">
            <Badge tone="success">Philippines-first, globally ready</Badge>
            <h1>Your career radar never stops searching.</h1>
            <p>
              Hanaply discovers fresh jobs, analyzes how well they match your real experience, and
              prepares tailored resumes and cover letters for opportunities worth pursuing.
            </p>
            <div className="hero-actions">
              <LinkButton href="/register" size="lg">
                Build My Career Radar <ArrowRight aria-hidden="true" size={18} />
              </LinkButton>
              <LinkButton href="#how-it-works" size="lg" variant="secondary">
                See How Hanaply Works
              </LinkButton>
            </div>
            <div className="hero-trust">
              <ShieldCheck aria-hidden="true" size={18} />
              <span>Verified facts. Explainable signals. You stay in control.</span>
            </div>
          </div>
          <CareerRadar />
        </div>
      </section>

      <section className="section section--light" id="how-it-works">
        <div className="section-inner">
          <div className="section-heading">
            <span className="h-eyebrow">A stronger foundation for every application</span>
            <h2>Discovery, judgment, and preparation in one career radar.</h2>
            <p>
              Hanaply is being built as a secure intelligence service, not another feed of generic
              job listings.
            </p>
          </div>
          <div className="foundation-grid">
            {foundations.map((item) => {
              const Icon = item.icon;
              return (
                <Card className="foundation-card" key={item.title}>
                  <div className="foundation-icon">
                    <Icon aria-hidden="true" size={23} />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--ink">
        <div className="signal-panel">
          <div>
            <Badge tone="success">Truth Gate architecture</Badge>
            <h2>Your application story should be strong because it is true.</h2>
            <p>
              Future generated claims will trace back to verified experience, skills, projects,
              education, and achievements. Unsupported claims will be rejected or flagged.
            </p>
          </div>
          <div className="signal-list" aria-label="Truth Gate principles">
            <span>
              <ShieldCheck aria-hidden="true" size={20} /> Verified facts only
            </span>
            <span>
              <FileCheck2 aria-hidden="true" size={20} /> Human review before submission
            </span>
            <span>
              <BellRing aria-hidden="true" size={20} /> Useful alerts without noise
            </span>
          </div>
        </div>
      </section>

      <section className="section section--cta">
        <div className="cta-panel">
          <span className="h-eyebrow">Hanap smarter. Apply stronger.</span>
          <h2>Build a career radar around your real strengths.</h2>
          <p>Join the foundation experience now. Full onboarding arrives in Phase 1.</p>
          <LinkButton href="/register" size="lg">
            Build My Career Radar
          </LinkButton>
        </div>
      </section>
    </>
  );
}
