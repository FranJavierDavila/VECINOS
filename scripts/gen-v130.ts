/**
 * v1.30 "los locales de todos" — arte de los LOCALES de la planta 0:
 *  · wall_junta_a/b — paredes del fondo de la SALA DE JUNTAS (mapeada como local de
 *    reuniones, no como vivienda: tablón de anuncios, banderín de la comunidad, ventana).
 *  · door_trastero — hoja metálica para las DOS puertas del TRASTERO COMUNITARIO.
 * Estilo ancla: el del juego — cartoon plano con contornos, paleta cálida.
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUT = path.join(import.meta.dir, '..', 'public', 'art', 'interiors', 'raw');
fs.mkdirSync(OUT, { recursive: true });

const STYLE =
  'flat cartoon vector illustration, clean bold dark outlines, cozy Spanish apartment game art, warm palette (terracotta orange, teal, sandy yellow, sage green), soft cel shading, high quality';
const WALLFLAT =
  'a single flat interior wall filling the entire frame edge to edge, perfectly straight-on orthographic view, absolutely no perspective, no room corners, no side walls, no floor, no ceiling, only the wall surface with its decoration, even lighting, full frame texture';
const DOORFLAT =
  'a single door leaf filling the frame edge to edge, perfectly straight-on orthographic front view, no perspective, no frame, no wall around it, the whole image is the door surface, even lighting';

interface Job {
  file: string;
  prompt: string;
  size: '1024x1024' | '768x1344' | '864x1152' | '1344x768' | '1152x864' | '1440x720' | '720x1440';
}

const JOBS: Job[] = [
  {
    file: 'wall_junta_a.png',
    prompt: `a warm ochre community meeting room wall with a large cork notice board full of pinned colorful notes and a paper banner that reads "JUNTA DE VECINOS", a small bookshelf with binders below the board, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_junta_b.png',
    prompt: `a sage green community meeting room wall with a white framed window with light curtains on the left half, a round wall clock, a folded Spanish flag fan decoration and a small potted plant on a wooden ledge, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'door_trastero.png',
    prompt: `a gray blue metal storage room door leaf with horizontal reinforcement ribs, a silver handle on the right side, a small lock plate and two tiny rivet rows at the edges, slightly scuffed matte paint, ${DOORFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
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
