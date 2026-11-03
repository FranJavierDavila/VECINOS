import type { NextConfig } from "next";

/**
 * Dos modos de build, elegidos por ENTORNO (nunca editando este fichero a mano):
 *
 *  · NORMAL (sandbox/desarrollo): `output: "standalone"`, tal cual siempre.
 *
 *  · PAGES (NEXT_PAGES=1): export estático para GitHub Pages. Solo lo usa el
 *    despliegue (remoto o `NEXT_PAGES=1 bunx next build` local): exige basePath
 *    del repositorio (`/VECINOS`) porque Pages sirve proyectos en subpath,
 *    imágenes sin optimizar (no hay runtime de Next) y distDir PROPIO para no
 *    pisar el `.next` del dev server si el build corre en la misma máquina.
 *    El runtime del juego no toca rutas de servidor: las llamadas que hacían
 *    falta (/api/save) tienen caída a localStorage en controller.ts.
 */
const pagesMode = process.env.NEXT_PAGES === "1";

const nextConfig: NextConfig = {
  ...(pagesMode
    ? {
        output: "export",
        basePath: "/VECINOS",
        images: { unoptimized: true },
        distDir: ".next-pages",
      }
    : {
        output: "standalone",
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
