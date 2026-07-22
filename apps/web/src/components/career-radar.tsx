import { CheckCircle2, FileText, Search } from 'lucide-react';

const signals = [
  { className: 'radar-signal radar-signal--discover', icon: Search, label: 'Discover' },
  { className: 'radar-signal radar-signal--understand', icon: CheckCircle2, label: 'Understand' },
  { className: 'radar-signal radar-signal--prepare', icon: FileText, label: 'Prepare' },
] as const;

export function CareerRadar() {
  return (
    <div aria-label="Hanaply career radar process" className="career-radar" role="img">
      <div aria-hidden="true" className="radar-grid" />
      <div aria-hidden="true" className="radar-sweep" />
      <div aria-hidden="true" className="radar-core">
        H
      </div>
      {signals.map((signal) => {
        const Icon = signal.icon;
        return (
          <div className={signal.className} key={signal.label}>
            <Icon aria-hidden="true" size={17} />
            <span>{signal.label}</span>
          </div>
        );
      })}
      <span className="h-sr-only">
        Discover opportunities, understand fit, and prepare applications.
      </span>
    </div>
  );
}
