/**
 * v1.25 "la casa de todos" — regeneración del arte que pide el usuario:
 *  · Puerta de ASCENSOR full-bleed (dos hojas metálicas con partida central) → F1.
 *  · Candado dibujado (silueta de candado real, NO una caja) → F4.
 *  · Macetas de pasillo como recortes billboard (2 especies) → F10.
 *  · Paredes alternativas de salón y dormitorio (variedad aleatoria entre viviendas) → F7.
 *  · Muebles regenerados con recorte limpio (lavabo SIN azulejos, alfombra SIN suelo,
 *    fogones como pieza única conectada) → F6.
 * Estilo ancla: el del juego — cartoon plano con contornos, paleta cálida.
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUT = path.join(import.meta.dir, '..', 'public', 'art', 'interiors', 'raw');
fs.mkdirSync(OUT, { recursive: true });

const STYLE =
  'flat cartoon vector illustration, clean bold dark outlines, cozy Spanish apartment game art, warm palette (terracotta orange, teal, sandy yellow, sage green), soft cel shading, high quality';
const STICKER =
  'perfectly frontal orthographic elevation view, straight-on symmetrical front view, no perspective, no three-quarter view, no isometric, isolated on pure white background, no shadow, no floor, no ground shadow, single connected object, nothing behind it';
const FULLBLEED =
  'the door fills the entire frame edge to edge, perfectly frontal orthographic elevation view, straight-on symmetrical, no perspective, full frame texture, no background visible, no wall around it, even lighting';

interface Job {
  file: string;
  prompt: string;
  size: string;
}

const JOBS: Job[] = [
  // ── F1: puertas metálicas del ascensor (full-bleed, partida central) ──
  {
    file: 'door_ascensor.png',
    prompt: `closed elevator doors of two brushed steel panels with a thin dark center split line between them, horizontal seam lines on each panel, small round call button panel on the right, warm light grey metal, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  // ── F4: candado de silueta real (se recorta al vuelo) ──
  {
    file: 'candado.png',
    prompt: `a small classic padlock seen from the front, golden brass rectangular body with rounded corners, round keyhole in the middle, closed steel shackle arch on top, the whole padlock small and centered with wide white margins around it, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '512x512',
  },
  // ── F10: macetas de pasillo (recortes billboard) ──
  {
    file: 'maceta_a.png',
    prompt: `a small houseplant with tall sword-shaped green leaves growing from a wide terracotta clay pot, the whole pot fully visible and centered, wide white margins all around the plant, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '512x512',
  },
  {
    file: 'maceta_b.png',
    prompt: `a small bushy plant with dense round green leaves in a sandy yellow ceramic pot, the whole pot fully visible and centered, wide white margins all around the plant, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '512x512',
  },
  // ── F7: paredes alternativas (variedad aleatoria) ──
  {
    file: 'wall_salon_b.png',
    prompt: `living room wall interior backdrop, sage teal green painted wall with a light wooden bookshelf full of books mounted on it, a framed mountain landscape picture, a small string of family photos, white painted skirting board at the bottom, perfectly frontal flat view of the wall only, no furniture on the floor, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_dormitorio_b.png',
    prompt: `bedroom wall interior backdrop, warm dusty rose painted wall with a round paper lantern lamp hanging from the ceiling, two small framed botanical prints, a narrow wooden shelf with a tiny cactus, white painted skirting board at the bottom, perfectly frontal flat view of the wall only, no furniture, ${STYLE}`,
    size: '1024x1024',
  },
  // ── F6: muebles regenerados con recorte limpio ──
  {
    file: 'f_lavabo.png',
    prompt: `a white ceramic pedestal washbasin with a round wooden-framed mirror hanging above it and a small towel ring beside, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_alfombra.png',
    prompt: `a rectangular woven area rug with a simple geometric border pattern in terracotta and cream, seen from directly above laid flat, the rug fills the whole frame edge to edge with only a thin cream margin, no floor visible around it, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_fogones.png',
    prompt: `a compact kitchen range unit: white counter with four-burner stovetop, two pans resting on it, an oven below with a round window, and a small attached backsplash shelf with two jars directly connected above the counter, all one connected piece of furniture, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
];

async function generate(zai: Awaited<ReturnType<typeof ZAI.create>>, job: Job): Promise<void> {
  const outPath = path.join(OUT, job.file);
  if (fs.existsSync(outPath) && !process.env.FORCE) {
    console.log(`↷ ya existe ${job.file}`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // el SDK tipa `size` como unión de literales; aquí se usan también 512x512, cast mínimo
      const res = await zai.images.generations.create({ prompt: job.prompt, size: job.size as '1024x1024' });
      const b64 = res.data[0]?.base64;
      if (!b64) throw new Error('sin base64');
      fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
      console.log(`✓ ${job.file}`);
      return;
    } catch (e) {
      console.warn(`✗ ${job.file} intento ${attempt}: ${(e as Error).message}`);
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function main(): Promise<void> {
  const zai = await ZAI.create();
  const jobs = [...JOBS];
  const WORKERS = 2;
  let cursor = 0;
  let fail = 0;
  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]!;
      try {
        await generate(zai, job);
      } catch {
        fail++;
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  console.log(`LISTO: ${jobs.length - fail}/${jobs.length} piezas (fallos: ${fail})`);
  if (fail > 0) process.exit(1);
}

void main();
