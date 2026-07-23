'use client';

import { Dialog } from '@hanaply/ui';
import { Maximize2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function PreviewDialog({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      description={description}
      contentClassName="preview-dialog-content"
      trigger={
        <button className="preview-expand-button" type="button">
          <Maximize2 aria-hidden="true" size={17} /> Enlarge {title} preview
        </button>
      }
    >
      <div className="preview-dialog-stage">{children}</div>
    </Dialog>
  );
}
