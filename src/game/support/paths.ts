/**
 * Resolución de rutas para VECINOS en cualquier raíz de despliegue.
 *
 * En dev/servidor propio el juego vive en `/`; en GitHub Pages vive en `/VECINOS/`.
 * La variable NEXT_PUBLIC_BASE_PATH (la fija el build de export estático, ver
 * .github/workflows/deploy-pages.yml) guarda ese prefijo; aquí se centraliza para que
 * ningún fetch de contenido, arte o SW se deje sin prefijar.
 *
 * Importante: NEXT_PUBLIC_* se inlinea en tiempo de compilación — cero coste en runtime
 * y en dev vale '' (comportamiento idéntico al de siempre).
 */
export const BASE_PATH: string = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/** true cuando el build es export estático (sin servidor: sin /api/*). */
export const STATIC_EXPORT: boolean = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

/**
 * Prefija una ruta raíz-absoluta (`/content/...`) con el basePath del despliegue.
 * Idempotente: si la ruta ya empieza por el basePath (o no es raíz-absoluta), vuelve tal cual.
 * Con BASE_PATH vacío (dev) es la identidad — el juego local no cambia ni un byte de red.
 */
export function withBase(path: string): string {
  if (!path || !path.startsWith('/') || BASE_PATH === '') return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

/** Raíces de contenido que el normalizador profundo del catálogo debe prefijar. */
const CONTENT_ROOTS = ['/art/', '/assets/', '/sprites/', '/content/', '/icons/', '/audio/'];

/**
 * Normaliza EN PROFUNDIDAD un objeto de contenido ya validado por zod: toda cadena que
 * apunte a una raíz de assets raíz-absoluta pasa a ser relativa al despliegue actual.
 * Así los defaults de schemas.ts ('/art/interiors/raw/...') y los JSON de content/
 * funcionan igual en `/` que en `/VECINOS/` sin tocar cada campo.
 * Devuelve el mismo objeto (mutación in-place) para no duplicar el catálogo en memoria.
 */
export function absolutizeContent<T>(node: T): T {
  if (typeof node === 'string') {
    return (CONTENT_ROOTS.some((root) => node === root || node.startsWith(root)) ? withBase(node) : node) as unknown as T;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = absolutizeContent(node[i]);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const obj = node as Record<string, unknown>;
      obj[key] = absolutizeContent(obj[key]);
    }
  }
  return node;
}
