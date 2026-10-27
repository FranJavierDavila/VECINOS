/**
 * v1.21 — Assets del FONDO URBANO por sellos: toma las fachadas PNG del usuario
 * (upload/Fachada_fondo{1,2,3}.png, recortes RGBA) y genera las variantes por capa:
 *
 *   · fachada_1_cerca.png   (fondo 1, nitidez casi plena — la capa más próxima)
 *   · fachada_2_media.png   (fondo 2, desenfoque medio)
 *   · fachada_3_lejos.png   (fondo 3, desenfoque fuerte — la capa más lejana)
 *
 * La regla del catálogo es "cuanto más lejos, más desenfocada la fachada": el blur viaja
 * HORNEADO en el asset (cero coste en runtime). Se reescala a 900 px de ancho para no
 * inflar la GPU (los sellos del runtime los re-muestrea por capa). Determinista e idempotente.
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SRC = '/home/z/my-project/upload';
const OUT = '/home/z/my-project/public/content/backdrop';
mkdirSync(OUT, { recursive: true });

const JOBS: { src: string; out: string; blur: number }[] = [
  { src: `${SRC}/Fachada_fondo1.png`, out: `${OUT}/fachada_1_cerca.png`, blur: 0.6 },
  { src: `${SRC}/Fachada_fondo2.png`, out: `${OUT}/fachada_2_media.png`, blur: 2.2 },
  { src: `${SRC}/Fachada_fondo3.png`, out: `${OUT}/fachada_3_lejos.png`, blur: 4.5 },
];

for (const j of JOBS) {
  const img = sharp(j.src).resize({ width: 900, withoutEnlargement: true });
  const withBlur = j.blur > 0 ? img.blur(j.blur) : img;
  await withBlur.png({ compressionLevel: 9 }).toFile(j.out);
  const meta = await sharp(j.out).metadata();
  console.log(`ok ${j.out} ${meta.width}x${meta.height} blur=${j.blur}`);
}
console.log('backdrop assets listos');
