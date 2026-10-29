// Validación de formularios en el cliente (el servidor valida de nuevo con restricciones y RLS).
type Check = (v: any) => string | null;

class Rule {
  checks: Check[] = []; isOptional = false;
  constructor(base: Check) { this.checks.push(base); }
  optional() { this.isOptional = true; return this; }
  test(v: any): string | null {
    if (this.isOptional && (v === undefined || v === null || v === '')) return null;
    for (const c of this.checks) { const e = c(v); if (e) return e; }
    return null;
  }
}
class Str extends Rule {
  constructor() { super((v) => (typeof v === 'string' ? null : 'Valor inválido')); }
  min(n: number, msg?: string) { this.checks.push((v) => (String(v).trim().length >= n ? null : msg || `Mínimo ${n} caracteres`)); return this; }
  max(n: number, msg?: string) { this.checks.push((v) => (String(v).length <= n ? null : msg || `Máximo ${n} caracteres`)); return this; }
  regex(r: RegExp, msg = 'Formato inválido') { this.checks.push((v) => (r.test(String(v)) ? null : msg)); return this; }
}
class Num extends Rule {
  constructor() { super((v) => (v !== '' && v !== null && isFinite(Number(v)) ? null : 'Debe ser un número')); }
  min(n: number, msg?: string) { this.checks.push((v) => (Number(v) >= n ? null : msg || `Debe ser mayor o igual a ${n}`)); return this; }
  positive(msg = 'Debe ser mayor que cero') { this.checks.push((v) => (Number(v) > 0 ? null : msg)); return this; }
}

export const z = {
  string: () => new Str(),
  number: () => new Num(),
  enum: (vals: readonly string[]) => new Rule((v) => (vals.includes(v) ? null : 'Opción inválida')),
  date: () => new Rule((v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : 'Fecha inválida')),
  object: (shape: Record<string, Rule>) => ({
    safeParse(v: Record<string, any>) {
      const errors: Record<string, string> = {};
      for (const [k, r] of Object.entries(shape)) { const e = r.test(v[k]); if (e) errors[k] = e; }
      return { success: Object.keys(errors).length === 0, errors, data: v };
    },
  }),
};
