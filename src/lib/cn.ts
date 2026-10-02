type ClassValue = string | number | false | null | undefined | ClassValue[];

/** Joins truthy class names. Deliberately tiny: no merge semantics needed. */
export function cn(...values: ClassValue[]): string {
  let out = '';
  for (const v of values) {
    if (!v) continue;
    const s = Array.isArray(v) ? cn(...v) : String(v);
    if (s) out = out ? `${out} ${s}` : s;
  }
  return out;
}
