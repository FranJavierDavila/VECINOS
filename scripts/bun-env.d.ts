// FASE H (higiene): los scripts de QA se ejecutan con Bun, pero el tsconfig raíz
// compila con librerías estándar. Declaramos SOLO la superficie del runtime Bun
// que los scripts usan realmente (auditado: import.meta.dir / import.meta.url).
// Sin arrastrar bun-types completo para no chocar con @types/node del proyecto Next.
interface ImportMeta {
  /** Directorio absoluto del fichero actual (runtime Bun). */
  dir: string;
}
