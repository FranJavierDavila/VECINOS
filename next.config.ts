import type { NextConfig } from "next";

/**
 * Dos modos de build, mismos fuentes:
 *  - Estándar (dev + servidor propio): output "standalone" como siempre.
 *  - Export estático (VECINOS_STATIC_EXPORT=1, lo usa el workflow de GitHub Pages):
 *    output "export" + trailingSlash — no hay servidor, el juego vive en /VECINOS/
 *    y las rutas /api/* no existen (el cliente degrada: guardado local, sin telemetría).
 * El basePath llega por NEXT_PUBLIC_BASE_PATH (build de Pages: /VECINOS) y lo consumen
 * el helper src/game/support/paths.ts y PwaRegister; aquí solo le enseña a Next dónde montar.
 */
const isStaticExport = process.env.VECINOS_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        trailingSlash: true as const,
        images: { unoptimized: true },
        // Solo basePath: Next ya antepone el basePath a los assets — un assetPrefix igual
        // lo duplicaría (/VECINOS/VECINOS/_next/...).
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      }
    : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
