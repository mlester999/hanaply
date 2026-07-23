'use client';

import { ArrowRight, Ban, Check, ChevronDown, Radar, Sparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

const careers = [
  'AI Automation Specialist',
  'Full Stack Developer',
  'Virtual Assistant',
  'Graphic Designer',
  'Customer Support Specialist',
];
const subCareers = [
  'Workflow Automation Engineer',
  'Backend Developer',
  'Solutions Engineer',
  'Operations Specialist',
  'Content Designer',
];
const keywords = ['n8n', 'Supabase', 'OpenAI', 'TypeScript', 'Automation'];
const exclusions = ['On-site', 'Commission only', 'Unpaid', 'Senior leadership', 'Night shift'];
const modes = ['Strict', 'Balanced', 'Growth', 'Career Change'];
const scanSteps = [
  'Deduplicating roles',
  'Applying exclusion rules',
  'Mapping verified skills',
  'Checking hard blockers',
  'Explaining worthwhile signals',
];

const opportunities = [
  {
    company: 'Northstar Systems',
    role: 'Workflow Automation Engineer',
    meta: 'Remote · Philippines · ₱80k–₱110k',
    verdict: 'Strong Match',
    score: 88,
    color: 'mint',
    why: 'n8n, API integration, and workflow delivery align directly.',
    gap: 'No formal solutions-engineering title.',
    transfer: 'Client discovery experience is transferable.',
    apply: 'Apply after reviewing the Application Pack.',
  },
  {
    company: 'Pinebridge Labs',
    role: 'Product Automation Developer',
    meta: 'Hybrid · Makati · ₱65k–₱90k',
    verdict: 'Stretch Opportunity',
    score: 74,
    color: 'blue',
    why: 'TypeScript, Supabase, and automation projects align.',
    gap: 'Role prefers two years of production React.',
    transfer: 'Full-stack project work supports the transition.',
    apply: 'Apply if hybrid work is acceptable.',
  },
  {
    company: 'Meridian Group',
    role: 'Senior Platform Director',
    meta: 'On-site · Singapore',
    verdict: 'Hard Blocker',
    score: 31,
    color: 'coral',
    why: 'Some platform keywords overlap.',
    gap: 'Requires eight years of people leadership and relocation.',
    transfer: 'The experience requirement is not a learnable short-term gap.',
    apply: 'Do not apply under the current profile.',
  },
];

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const focusSelected = window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
        ?.focus();
    });
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusSelected);
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="form-field" ref={rootRef}>
      <span id={labelId}>{label}</span>
      <div className="select-wrap">
        <button
          ref={triggerRef}
          type="button"
          className="select-button"
          aria-controls={open ? listboxId : undefined}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onKeyDown={(event) => {
            if (!open && event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          <span id={valueId}>{value}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open && (
          <div
            className="select-options"
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            tabIndex={-1}
            onKeyDown={moveFocus}
          >
            {options.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                key={option}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                <span>{option}</span>
                {option === value && <Check size={16} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChipPicker({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="chip-field">
      <legend>{label}</legend>
      <div>
        {options.map((item) => (
          <button
            type="button"
            key={item}
            className={selected.includes(item) ? 'selected' : ''}
            aria-pressed={selected.includes(item)}
            onClick={() => {
              onToggle(item);
            }}
          >
            {selected.includes(item) && <Check size={13} />}
            {item}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function CareerRadarSimulator() {
  const [career, setCareer] = useState<string>('AI Automation Specialist');
  const [subCareer, setSubCareer] = useState<string>('Workflow Automation Engineer');
  const [experience, setExperience] = useState('Intermediate');
  const [mode, setMode] = useState('Balanced');
  const [included, setIncluded] = useState(['n8n', 'Supabase', 'Automation']);
  const [excluded, setExcluded] = useState(['On-site', 'Unpaid', 'Night shift']);
  const [scan, setScan] = useState(-1);
  const [selected, setSelected] = useState(0);
  const done = scan >= scanSteps.length;

  const toggle = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter((items) =>
      items.includes(value) ? items.filter((item) => item !== value) : [...items, value],
    );
  };
  const resultSummary = useMemo(
    () =>
      mode === 'Strict'
        ? '1 priority signal'
        : mode === 'Growth'
          ? '2 priority signals + 1 stretch'
          : '2 priority signals',
    [mode],
  );

  useEffect(() => {
    if (scan < 0 || done) return;
    const timer = window.setTimeout(() => {
      setScan((value) => value + 1);
    }, 460);
    return () => {
      window.clearTimeout(timer);
    };
  }, [scan, done]);

  const run = () => {
    setSelected(0);
    setScan(0);
  };
  const currentOpportunity = opportunities[selected];
  if (!currentOpportunity) return null;
  return (
    <div className="radar-simulator">
      <div className="sim-config">
        <div className="panel-heading">
          <span className="eyebrow-icon">
            <Radar size={16} /> Sample profile
          </span>
          <strong>Demonstration Data</strong>
        </div>
        <div className="form-grid">
          <SelectControl
            label="Main career"
            value={career}
            options={careers}
            onChange={setCareer}
          />
          <SelectControl
            label="Related sub-career"
            value={subCareer}
            options={subCareers}
            onChange={setSubCareer}
          />
          <SelectControl
            label="Experience level"
            value={experience}
            options={['Entry', 'Intermediate', 'Senior', 'Career Changer']}
            onChange={setExperience}
          />
          <SelectControl label="Opportunity mode" value={mode} options={modes} onChange={setMode} />
        </div>
        <ChipPicker
          label="Include signals"
          options={keywords}
          selected={included}
          onToggle={(value) => {
            toggle(value, setIncluded);
          }}
        />
        <ChipPicker
          label="Exclude signals"
          options={exclusions}
          selected={excluded}
          onToggle={(value) => {
            toggle(value, setExcluded);
          }}
        />
        <button
          className="primary-button radar-run"
          type="button"
          onClick={run}
          disabled={scan >= 0 && !done}
        >
          <Radar size={18} />
          {scan >= 0 && !done ? 'Career Radar running' : 'Run Career Radar'}
          <ArrowRight size={18} />
        </button>
      </div>
      <div className={`sim-output ${scan >= 0 ? 'active' : ''}`} aria-live="polite">
        {scan < 0 ? (
          <div className="sim-idle">
            <div className="idle-result-preview" aria-hidden="true">
              <header>
                <span>Sample output</span>
                <strong>3 roles reviewed</strong>
              </header>
              <div>
                <span>
                  <small>Northstar Systems</small>Workflow Automation Engineer
                </span>
                <strong className="mint">88 · Strong</strong>
              </div>
              <div>
                <span>
                  <small>Pinebridge Labs</small>Product Automation Developer
                </span>
                <strong>74 · Stretch</strong>
              </div>
              <div>
                <span>
                  <small>Meridian Group</small>Senior Platform Director
                </span>
                <strong className="coral">Blocked</strong>
              </div>
            </div>
            <h3>See which roles are worth your time.</h3>
            <p>
              Run the sample Radar to compare fit, surface realistic gaps, and explain why a role
              should or should not be pursued.
            </p>
          </div>
        ) : !done ? (
          <div className="scan-progress">
            <div className="scan-orbit">
              <Radar size={38} />
            </div>
            <span>Analyzing {career}</span>
            <h3>{scanSteps[Math.min(scan, scanSteps.length - 1)]}</h3>
            <div className="step-list">
              {scanSteps.map((step, index) => (
                <div
                  key={step}
                  className={index < scan ? 'complete' : index === scan ? 'current' : ''}
                >
                  <span>{index < scan ? <Check size={13} /> : index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="results-view">
            <div className="results-header">
              <div>
                <span>Radar complete</span>
                <h3>{resultSummary}</h3>
              </div>
              <button type="button" onClick={run}>
                Scan again
              </button>
            </div>
            <div className="job-result-layout">
              <div className="job-result-list" role="tablist" aria-label="Sample job results">
                {opportunities.map((job, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected === index}
                    key={job.role}
                    onClick={() => {
                      setSelected(index);
                    }}
                    className={selected === index ? 'selected' : ''}
                  >
                    <span className={`result-score ${job.color}`}>
                      {job.verdict === 'Hard Blocker' ? <Ban size={16} /> : job.score}
                    </span>
                    <span>
                      <small>{job.company}</small>
                      <strong>{job.role}</strong>
                      <em>{job.meta}</em>
                    </span>
                    <span className={`verdict ${job.color}`}>{job.verdict}</span>
                  </button>
                ))}
              </div>
              <article className="result-detail" role="tabpanel">
                <div className="result-verdict">
                  <span className={`signal-orb ${currentOpportunity.color}`} />
                  <span>{currentOpportunity.verdict}</span>
                  <strong>
                    {currentOpportunity.score}
                    <small>/100</small>
                  </strong>
                </div>
                <h4>{currentOpportunity.role}</h4>
                <p>{currentOpportunity.why}</p>
                <dl>
                  <div>
                    <dt>What is missing</dt>
                    <dd>{currentOpportunity.gap}</dd>
                  </div>
                  <div>
                    <dt>Gap type</dt>
                    <dd>{currentOpportunity.transfer}</dd>
                  </div>
                  <div>
                    <dt>Recommendation</dt>
                    <dd>{currentOpportunity.apply}</dd>
                  </div>
                </dl>
                {selected === 0 && (
                  <a href="#application-packs" className="text-link">
                    <Sparkles size={15} /> See how its Application Pack assembles{' '}
                    <ArrowRight size={15} />
                  </a>
                )}
              </article>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
