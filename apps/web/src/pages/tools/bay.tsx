// Pieces of the "bay" look (fabrication.css) shared by the Mining views (v1.58.0).

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The bay's riveted plate. */
export function Plate({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn('fab-plate relative flex min-w-0 flex-col gap-4 px-5 pb-5 pt-6 sm:px-7', className)}>
      {[{ top: 10, left: 10 }, { top: 10, right: 10 }, { bottom: 10, left: 10 }, { bottom: 10, right: 10 }].map((pos, i) => <span key={i} aria-hidden="true" className="fab-rivet" style={pos} />)}
      {children}
    </section>
  );
}

export const Heading = ({ children }: { children: ReactNode }) => <h3 className="fab-stencil m-0 text-base text-[var(--fab-gold-text)]">{children}</h3>;
