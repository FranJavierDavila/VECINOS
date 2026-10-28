/**
 * v1.36 — Assets del FONDO URBANO por sellos: toma las fachadas PNG del usuario
 * (upload/Fachada_fondo{1,2,3}.png, recortes RGBA) y genera las variantes por capa:
 *
 *   · fachada_1_cerca.png   (fondo 1, nitidez plena — la capa más próxima)
 *   · fachada_2_media.png   (fondo 2, nitidez casi plena — antes blur 2.2 «manchón»)
 *   · fachada_3_lejos.png   (fondo 3, MUY definida también — antes blur 4.5 «manchón»)
 *
 * El vecino (v1.36): «me gustaría mejorar mucho los fondos, los veo muy poco definidos
 * y como manchones» — el blur fuerte horneado se CANCELA: queda solo un halo mínimo de
 * perspectiva aérea (la niebla del runtime ya funde las capas lejanas; el desenfoque
 * duplicaba el efecto y las volvía papilla). Se reescala a 1000 px de ancho.
 * Determinista e idempotente.
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SRC = '/home/z/my-project/upload';
const OUT = '/home/z/my-project/public/content/backdrop';
mkdirSync(OUT, { recursive: true });

const JOBS: { src: string; out: string; blur: number }[] = [
  { src: `${SRC}/Fachada_fondo1.png`, out: `${OUT}/fachada_1_cerca.png`, blur: 0.4 },
  { src: `${SRC}/Fachada_fondo2.png`, out: `${OUT}/fachada_2_media.png`, blur: 0.6 },
  { src: `${SRC}/Fachada_fondo3.png`, out: `${OUT}/fachada_3_lejos.png`, blur: 1.1 },
];

for (const j of JOBS) {
  const img = sharp(j.src).resize({ width: 1000, withoutEnlargement: true });
  const withBlur = j.blur > 0 ? img.blur(j.blur) : img;
  await withBlur.png({ compressionLevel: 9 }).toFile(j.out);
  const meta = await sharp(j.out).metadata();
  console.log(`ok ${j.out} ${meta.width}x${meta.height} blur=${j.blur}`);
}
console.log('backdrop assets listos');
