/**
 * v1.27 "obra en fase ligera" — arte nuevo que pide el vecino:
 *  · Macetas de pasillo DETALLADAS (2 especies) — las dibujadas a canvas eran «cutres».
 *  · Puerta de vivienda full-bleed de una sola hoja (adiós arte con marco gordo de la v1.24).
 *  · Puerta de zonas comunes full-bleed para las hojas de escalera (encaje perfecto).
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
  // ── Macetas de pasillo DETALLADAS (especie 0: espad alto; especie 1: mata con flores) ──
  {
    file: 'maceta_a.png',
    prompt: `a lush tall snake plant (sansevieria) with many sword-shaped dark green leaves edged in yellow, growing from a wide terracotta clay pot with a visible rim and soil texture, richly detailed leaves with subtle shading, the whole pot fully visible and centered, wide white margins all around the plant, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  {
    file: 'maceta_b.png',
    prompt: `a lush bushy flowering plant with dense round green leaves and many small pink blossoms, growing from a sandy yellow ceramic pot with a decorative band pattern and visible soil, richly detailed foliage with subtle shading, the whole pot fully visible and centered, wide white margins all around the plant, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  // ── Puerta de vivienda full-bleed (una sola hoja, llena el lienzo) ──
  {
    file: 'door_casa_a.png',
    prompt: `a single warm walnut brown wooden apartment door with a vertical grain, two recessed rectangular panels (upper and lower), a golden brass lever handle with lock plate on the left side, a small round peephole at eye height, three small brass hinges on the right edge, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  // ── Puerta de zonas comunes full-bleed (hojas del cubo de escalera) ──
  {
    file: 'door_comunal.png',
    prompt: `a single sage green painted wooden community door with a vertical metal mail slot and a brushed steel lever handle on the left, two horizontal recessed panels, visible painted wood texture, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
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
      const res = await zai.images.generations.create({ prompt: job.prompt, size: job.size });
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
