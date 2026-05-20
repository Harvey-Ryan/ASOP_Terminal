export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function requireStr(val: unknown, field: string, max = 500): string {
  if (typeof val !== 'string' || !val.trim()) throw new ValidationError(`${field} is required`);
  if (val.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return val.trim();
}

export function optStr(val: unknown, field: string, max = 500): string | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val !== 'string') throw new ValidationError(`${field} must be a string`);
  if (val.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return val.trim() || null;
}

export function requireEnum<T extends string>(val: unknown, field: string, allowed: readonly T[]): T {
  if (typeof val !== 'string' || !allowed.includes(val as T))
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return val as T;
}

export function optEnum<T extends string>(val: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (val === undefined || val === null) return undefined;
  return requireEnum(val, field, allowed);
}

export function requireNonNegInt(val: unknown, field: string): number {
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${field} must be a non-negative integer`);
  return n;
}

export function optNonNegInt(val: unknown, field: string): number | undefined {
  if (val === undefined || val === null) return undefined;
  return requireNonNegInt(val, field);
}

export function requirePosInt(val: unknown, field: string): number {
  const n = Number(val);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${field} must be a positive integer`);
  return n;
}

export function optPosInt(val: unknown, field: string): number | undefined {
  if (val === undefined || val === null) return undefined;
  return requirePosInt(val, field);
}

export function requireStrArr(val: unknown, field: string, maxItems = 50, maxItemLen = 100): string[] {
  if (!Array.isArray(val)) throw new ValidationError(`${field} must be an array`);
  if (val.length > maxItems) throw new ValidationError(`${field} must have at most ${maxItems} items`);
  return val.map((v, i) => {
    if (typeof v !== 'string') throw new ValidationError(`${field}[${i}] must be a string`);
    if (v.length > maxItemLen) throw new ValidationError(`${field}[${i}] must be ${maxItemLen} characters or fewer`);
    return v;
  });
}

export function optStrArr(val: unknown, field: string, maxItems = 50, maxItemLen = 100): string[] | undefined {
  if (val === undefined || val === null) return undefined;
  return requireStrArr(val, field, maxItems, maxItemLen);
}
