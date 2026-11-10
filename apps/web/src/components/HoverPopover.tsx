import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

// A hover card that never changes the page layout. It is drawn in a fixed
// layer at the end of <body>, below its trigger when it fits and above it
// otherwise, and kept inside the window. (A card positioned inside the page
// could stretch the page near the bottom, move the trigger out from under the
// cursor and close again, which made it flicker.)

const GAP = 4;    // between trigger and card
const MARGIN = 8; // kept clear of the window edges

interface Pos { top: number; left: number }

export function HoverPopover({
  trigger,
  children,
  className,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  /** Extra classes for the card (width, padding…). */
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const setShown = (v: boolean) => {
    setOpen(v);
    if (!v) setPos(null);
    onOpenChange?.(v);
  };

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    const card = cardRef.current;
    if (!t || !card) return;
    const h = card.offsetHeight;
    const w = card.offsetWidth;
    const below = window.innerHeight - t.bottom - GAP - MARGIN;
    const above = t.top - GAP - MARGIN;
    const top = h <= below || below >= above
      ? t.bottom + GAP
      : Math.max(MARGIN, t.top - GAP - h);
    const left = Math.min(Math.max(MARGIN, t.left), window.innerWidth - w - MARGIN);
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  }, []);

  // Place before paint, again whenever the card's size changes (content
  // loading in), and follow the trigger while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const card = cardRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && card ? new ResizeObserver(place) : null;
    if (ro && card) ro.observe(card);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return (
    <div ref={triggerRef} className="relative" onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      {trigger}
      {open && createPortal(
        <div
          ref={cardRef}
          role="tooltip"
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className={cn('z-50 rounded-lg border border-border bg-card p-3 shadow-xl text-xs pointer-events-none', className)}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
