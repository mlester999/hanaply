import { Card } from '@hanaply/ui';

import {
  CareerRecordDeleteForm,
  CareerRecordEditor,
} from '@/components/career/career-record-editor';
import { careerRecordSpecs, type CareerRecord } from '@/lib/career-records';

export interface CareerRecordItem {
  record: CareerRecord;
  title: string;
  meta: readonly string[];
  detail: string | null;
  tags: readonly string[];
  href?: string;
}

/** One structured record section: saved records, their editors, and deletion. */
export function CareerRecordSection({
  profileId,
  kind,
  items,
  idPrefix,
}: {
  profileId: string;
  kind: CareerRecord['kind'];
  items: readonly CareerRecordItem[];
  idPrefix: string;
}) {
  const spec = careerRecordSpecs[kind];
  return (
    <Card aria-labelledby={`${idPrefix}-title`} className="career-section-card" role="region">
      <div className="career-section-heading">
        <div>
          <span className="h-eyebrow">Structured record</span>
          <h2 id={`${idPrefix}-title`}>{spec.label}</h2>
        </div>
        <CareerRecordEditor idPrefix={`${idPrefix}-new`} kind={kind} profileId={profileId} />
      </div>
      {items.length === 0 ? (
        <p className="career-section-empty">{spec.emptyMessage}</p>
      ) : (
        <ul className="career-record-list">
          {items.map((item) => (
            <li key={item.record.value.id}>
              <div className="career-record-heading">
                <div>
                  <h3>
                    {item.href ? (
                      <a href={item.href} rel="noreferrer noopener" target="_blank">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h3>
                  {item.meta.length > 0 ? (
                    <p className="career-record-meta">{item.meta.join(' · ')}</p>
                  ) : null}
                </div>
                <div className="career-record-controls">
                  <CareerRecordEditor
                    idPrefix={`${idPrefix}-${item.record.value.id}`}
                    kind={kind}
                    profileId={profileId}
                    record={item.record}
                  />
                  <CareerRecordDeleteForm
                    kind={kind}
                    label={item.title}
                    profileId={profileId}
                    recordId={item.record.value.id}
                  />
                </div>
              </div>
              {item.detail ? <p className="career-record-detail">{item.detail}</p> : null}
              {item.tags.length > 0 ? (
                <ul className="career-tag-list">
                  {item.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
