'use client';

import { ArrowRight, BriefcaseBusiness, Check, MapPin, ShieldCheck, Sparkles } from 'lucide-react';

const checks = [
  { label: 'Work constraints', detail: 'Remote · Philippines', icon: MapPin },
  { label: 'Verified evidence', detail: 'n8n · API delivery', icon: ShieldCheck },
  { label: 'Realistic gap', detail: 'Solutions title is learnable', icon: Sparkles },
] as const;

export function CareerSignalPreview({ step }: { step: number }) {
  const progress = Math.min(step, 4);
  const ready = progress >= 4;

  return (
    <div
      className="career-preview"
      aria-label="Example opportunity review for a Workflow Automation Engineer role"
    >
      <section className={`preview-role ${progress >= 1 ? 'is-complete' : 'is-active'}`}>
        <div className="preview-section-label">
          <span>01</span> Fresh role discovered <strong>2 min ago</strong>
        </div>
        <article>
          <span className="preview-company-mark">
            <BriefcaseBusiness size={18} />
          </span>
          <div>
            <small>Northstar Systems · Sample job</small>
            <h2>Workflow Automation Engineer</h2>
            <p>
              <MapPin size={13} /> Remote · Philippines
            </p>
          </div>
          <span className="preview-new">NEW</span>
        </article>
      </section>

      <section className="preview-fit">
        <div className="preview-section-label">
          <span>02</span> Fit check <strong>Based on the sample profile</strong>
        </div>
        <div className="preview-checks">
          {checks.map((item, index) => {
            const Icon = item.icon;
            const complete = progress >= index + 2;
            return (
              <div
                className={complete ? 'is-complete' : progress === index + 1 ? 'is-active' : ''}
                key={item.label}
              >
                <span className="preview-check-icon">
                  {complete ? <Check size={15} /> : <Icon size={15} />}
                </span>
                <span>
                  <small>{item.label}</small>
                  <strong>{item.detail}</strong>
                </span>
                <em>{complete ? 'CLEAR' : progress === index + 1 ? 'CHECKING' : 'WAITING'}</em>
              </div>
            );
          })}
        </div>
      </section>

      <section className={`preview-decision ${ready ? 'is-ready' : ''}`}>
        <div>
          <small>03 · EXPLAINED RECOMMENDATION</small>
          <strong>{ready ? 'Strong match' : 'Building recommendation'}</strong>
          <p>
            {ready
              ? 'Apply after review. No hard blockers found.'
              : 'Hanaply is checking evidence before recommending a next step.'}
          </p>
        </div>
        <div className="preview-score">
          <strong>{ready ? '88' : '…'}</strong>
          <span>/100</span>
        </div>
        <div className="preview-next">
          <span>{ready ? 'Application Pack is ready next' : 'Truthful next step pending'}</span>
          <ArrowRight size={16} />
        </div>
      </section>
    </div>
  );
}
