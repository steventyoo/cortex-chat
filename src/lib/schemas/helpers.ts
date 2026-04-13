import { z } from 'zod';

/**
 * Preprocessor that coerces JSONB values that may be stored as
 * pipe-delimited or comma-delimited strings into a proper string array.
 * Handles: string[], "A|B|C", "A,B,C", single string, null/undefined.
 */
export const normalizeStringArray = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    if (val.includes('|')) return val.split('|').map(s => s.trim()).filter(Boolean);
    if (val.includes(',')) return val.split(',').map(s => s.trim()).filter(Boolean);
    if (val.length > 0) return [val];
  }
  return null;
}, z.array(z.string()).nullable());

/**
 * Preprocessor that coerces JSONB values that may be stored as
 * a stringified JSON object into a proper object.
 */
export const normalizeJsonObject = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return null; }
  }
  return null;
}, z.record(z.string(), z.unknown()).nullable());

/**
 * Preprocessor that coerces JSONB values that may be stored as
 * a stringified JSON array of objects into a proper array.
 */
export const normalizeJsonArray = z.preprocess((val) => {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}, z.array(z.unknown()));
