'use client';

import {
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleUserRound,
  FileStack,
  Flag,
  Gauge,
  LayoutDashboard,
  Pause,
  Radar,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react';
import { useState } from 'react';

const dashboardNav = [
  ['Overview', LayoutDashboard],
  ['Job Radar', Radar],
  ['Search Profiles', Search],
  ['Career Profile', CircleUserRound],
  ['Application Packs', FileStack],
  ['Applications', BriefcaseBusiness],
  ['AI Career Coach', Sparkles],
  ['Notifications', Bell],
] as const;

export function ProductDashboardPreview() {
  const [active, setActive] = useState('Overview');
  return (
    <div className="product-window">
      <div className="window-bar">
        <span className="window-dots">
          <i />
          <i />
          <i />
        </span>
        <strong>Product Preview</strong>
        <span>Conceptual customer dashboard</span>
      </div>
      <div className="dashboard-grid">
        <aside>
          <div className="mini-brand">
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            hanaply
          </div>
          <nav aria-label="Customer preview navigation">
            {dashboardNav.map(([label, Icon]) => (
              <button
                type="button"
                key={label}
                className={active === label ? 'active' : ''}
                onClick={() => {
                  setActive(label);
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="profile-mini">
            <span>AS</span>
            <div>
              <strong>Alex S.</strong>
              <small>Plus vision</small>
            </div>
          </div>
        </aside>
        <div className="dashboard-content">
          <header>
            <div>
              <span>Tuesday, 22 July</span>
              <h3>{active}</h3>
            </div>
            <div>
              <button type="button" aria-label="Notifications">
                <Bell size={18} />
              </button>
              <button type="button" aria-label="Settings">
                <Settings2 size={18} />
              </button>
            </div>
          </header>
          <DashboardState active={active} />
        </div>
      </div>
    </div>
  );
}

function DashboardState({ active }: { active: string }) {
  if (active === 'Job Radar')
    return (
      <div className="radar-dashboard-state">
        <div className="dashboard-radar">
          <i />
          <i />
          <i />
          <span>Scanning</span>
        </div>
        <div>
          <span className="preview-label">Demonstration Data</span>
          <h4>Looking for meaningful signals</h4>
          <p>One main career · Two related sub-careers · Balanced mode</p>
          <ul>
            <li>
              <Check size={14} /> 24 fresh roles normalized
            </li>
            <li>
              <Check size={14} /> 7 duplicates removed
            </li>
            <li>
              <span /> Career matching in progress
            </li>
          </ul>
        </div>
      </div>
    );
  if (active === 'Application Packs')
    return (
      <div className="pack-dashboard-state">
        <div className="state-heading">
          <div>
            <span>Product Preview</span>
            <h4>Review-ready packs</h4>
          </div>
          <strong>2 prepared</strong>
        </div>
        {['Workflow Automation Engineer', 'Product Automation Developer'].map((role, index) => (
          <article key={role}>
            <span className="document-thumb">
              <FileStack size={20} />
            </span>
            <div>
              <small>{index ? 'Pinebridge Labs' : 'Northstar Systems'}</small>
              <h5>{role}</h5>
              <p>{index ? 'Stretch opportunity' : 'Strong match'} · Human review required</p>
            </div>
            <ChevronRight size={18} />
          </article>
        ))}
      </div>
    );
  if (active === 'Career Profile')
    return (
      <div className="profile-dashboard-state">
        <div className="profile-ring">
          <span>
            82<small>%</small>
          </span>
        </div>
        <div>
          <span className="preview-label">Sample profile completeness</span>
          <h4>A strong base with room for context</h4>
          <p>
            Add outcome evidence to two recent projects. It will improve explanations without
            inflating your experience.
          </p>
          <button type="button">
            Review sample gaps <ChevronRight size={15} />
          </button>
        </div>
      </div>
    );
  return (
    <>
      <div className="dashboard-hero-card">
        <div>
          <span className="preview-label">PRODUCT PREVIEW · DEMONSTRATION DATA</span>
          <h4>Your career radar is focused.</h4>
          <p>
            Fresh signals are being compared with verified experience, projects, and preferences.
          </p>
        </div>
        <div className="mini-signal-field">
          <i />
          <i />
          <i />
          <span>3</span>
          <small>Worth a closer look</small>
        </div>
      </div>
      <div className="dashboard-cards">
        <article>
          <span>Signal quality</span>
          <strong>2 strong</strong>
          <p>One stretch opportunity has a learnable gap.</p>
        </article>
        <article>
          <span>Application Packs</span>
          <strong>2 ready</strong>
          <p>Both require your review before use.</p>
        </article>
        <article>
          <span>Profile guidance</span>
          <strong>1 action</strong>
          <p>Add verified outcomes to a recent project.</p>
        </article>
      </div>
      <div className="opportunity-table">
        <div>
          <span>Worth a closer look</span>
          <button type="button">Open Job Radar</button>
        </div>
        {(
          [
            ['Northstar Systems', 'Workflow Automation Engineer', 'Strong Match', '88'],
            ['Pinebridge Labs', 'Product Automation Developer', 'Stretch', '74'],
          ] as const
        ).map((row) => (
          <article key={row[1]}>
            <span className="company-avatar">{row[0].slice(0, 1)}</span>
            <span>
              <small>{row[0]}</small>
              <strong>{row[1]}</strong>
            </span>
            <em>{row[2]}</em>
            <b>{row[3]}</b>
            <ChevronRight size={16} />
          </article>
        ))}
      </div>
    </>
  );
}

const adminActions = [
  ['Pause job source', 'Northstar ATS feed', Pause],
  ['Publish prompt version', 'Resume generator v0.8', Sparkles],
  ['Disable mobile feature', 'Application Pack export', Flag],
  ['Review audit event', 'Plan entitlement updated', ShieldCheck],
] as const;

export function AdminPreview() {
  const [selected, setSelected] = useState(0);
  const [simulated, setSimulated] = useState(false);
  const current = adminActions[selected] ?? adminActions[0];
  const CurrentIcon = current[2];
  return (
    <div className="admin-window">
      <aside>
        <div className="mini-brand inverse">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          hanaply <small>admin</small>
        </div>
        <nav aria-label="Admin preview navigation">
          {(
            [
              ['Overview', Gauge],
              ['Users', Users],
              ['Payments', WalletCards],
              ['Job Sources', Radar],
              ['AI Studio', Sparkles],
              ['Feature Flags', Flag],
              ['Audit Logs', ShieldCheck],
            ] as const
          ).map(([label, Icon]) => (
            <button
              type="button"
              key={label as string}
              className={label === 'Overview' ? 'active' : ''}
            >
              <Icon size={15} />
              {label as string}
            </button>
          ))}
        </nav>
        <span className="vision-badge">Vision simulation</span>
      </aside>
      <div className="admin-content">
        <header>
          <div>
            <span>Operations</span>
            <h3>Control center</h3>
          </div>
          <strong>VISION SIMULATION</strong>
        </header>
        <div className="admin-status-grid">
          <article>
            <span>Source health</span>
            <strong>All sample sources stable</strong>
            <i className="healthy" />
          </article>
          <article>
            <span>Active prompt</span>
            <strong>Resume generator v0.7</strong>
            <i />
          </article>
          <article>
            <span>Platform policy</span>
            <strong>Mobile future phase</strong>
            <i />
          </article>
        </div>
        <div className="admin-workflow">
          <div>
            <span>Conceptual workflows</span>
            <h4>Choose an operator action</h4>
            {adminActions.map(([title, detail, Icon], index) => (
              <button
                type="button"
                key={title}
                className={selected === index ? 'active' : ''}
                onClick={() => {
                  setSelected(index);
                  setSimulated(false);
                }}
              >
                <span>
                  <Icon size={17} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          <article>
            <span className="preview-label">VISION SIMULATION · NO REAL ACTION</span>
            <CurrentIcon size={26} />
            <h4>{current[0]}</h4>
            <p>
              {selected === 0
                ? 'The feed stops accepting new runs while existing canonical jobs remain available. The operator sees impact and can resume safely.'
                : selected === 1
                  ? 'The new prompt is versioned, validated against a sample set, and can be rolled back without a client release.'
                  : selected === 2
                    ? 'The platform flag changes future mobile behavior while the shared API remains stable.'
                    : 'The event shows actor, time, before and after values, and the approved reason.'}
            </p>
            <dl>
              <div>
                <dt>Target</dt>
                <dd>{current[1]}</dd>
              </div>
              <div>
                <dt>Boundary</dt>
                <dd>Admin only · Audited</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => {
                setSimulated(true);
              }}
              disabled={simulated}
            >
              {simulated ? (
                <>
                  <Check size={16} /> Simulation complete
                </>
              ) : (
                'Preview action'
              )}
            </button>
            {simulated && <small className="sim-note">No external state changed.</small>}
          </article>
        </div>
      </div>
    </div>
  );
}

export function ResumeComparison() {
  const [strategy, setStrategy] = useState('Results Led');
  const strategies = ['ATS Professional', 'Results Led', 'Technical Depth'];
  const orders: Record<string, string[]> = {
    'ATS Professional': ['Summary', 'Skills', 'Experience', 'Projects'],
    'Results Led': ['Impact', 'Experience', 'Projects', 'Skills'],
    'Technical Depth': ['Technical profile', 'Tool stack', 'Projects', 'Experience'],
  };
  const selectedOrder = orders[strategy];
  if (!selectedOrder) return null;
  return (
    <div className="resume-compare">
      <div className="compare-controls">
        <span>Content strategy</span>
        {strategies.map((item) => (
          <button
            type="button"
            key={item}
            className={strategy === item ? 'active' : ''}
            onClick={() => {
              setStrategy(item);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="resume-sheets">
        <article>
          <header>
            <span>JD</span>
            <div>
              <strong>Alex Santos</strong>
              <small>Automation Specialist</small>
            </div>
          </header>
          <div className="resume-order">
            {selectedOrder.map((item, index) => (
              <section key={item} className={index === 0 ? 'highlight' : ''}>
                <span>0{index + 1}</span>
                <div>
                  <strong>{item}</strong>
                  <i />
                  <i />
                </div>
              </section>
            ))}
          </div>
          <footer>Content strategy: {strategy}</footer>
        </article>
        <div className="compare-divider">
          <span>≠</span>
          <small>Different choices</small>
        </div>
        <article className="template-sheet">
          <header>
            <span>JD</span>
            <div>
              <strong>Alex Santos</strong>
              <small>Automation Specialist</small>
            </div>
          </header>
          <div className="resume-order compact">
            {selectedOrder.map((item, index) => (
              <section key={item}>
                <span>0{index + 1}</span>
                <div>
                  <strong>{item}</strong>
                  <i />
                  <i />
                </div>
              </section>
            ))}
          </div>
          <footer>Visual template: Compact ATS</footer>
        </article>
      </div>
      <p className="compare-note">
        <ShieldCheck size={16} /> Verified employment dates, facts, and credentials never change
        when the strategy or visual template changes.
      </p>
    </div>
  );
}
