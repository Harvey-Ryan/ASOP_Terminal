import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes safely, resolving conflicts in favour of the last value. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
