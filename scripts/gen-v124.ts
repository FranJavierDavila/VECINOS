/**
 * v1.24 "el barrio ilustrado" — regeneración del arte:
 *  · 17 sprites de mobiliario con VISTA TOTALMENTE FRONTAL (elevación de orthographic
 *    front view — nada de 3/4 ni isométrico) y fondo blanco puro para el recorte.
 *  · 3 puertas de vivienda full-bleed (la textura ES la puerta, sin fondo) + 1 puerta
 *    de zonas comunes para los cubos de escalera (recibirá el número de planta encima).
 *  · 4 árboles recortados (billboards 2D) para el exterior, sobre blanco puro.
 * Estilo ancla: el del juego — cartoon plano con contornos, paleta cálida.
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUT = path.join(import.meta.dir, '..', 'public', 'art', 'interiors', 'raw');
const OUT_TREES = path.join(import.meta.dir, '..', 'public', 'art', 'trees');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT_TREES, { recursive: true });

const STYLE =
  'flat cartoon vector illustration, clean bold dark outlines, cozy Spanish apartment game art, warm palette (terracotta orange, teal, sandy yellow, sage green), soft cel shading, high quality';
const STICKER =
  'perfectly frontal orthographic elevation view, straight-on symmetrical front view, no perspective, no three-quarter view, no isometric, isolated on pure white background, no shadow, no floor, no ground shadow';
const FULLBLEED =
  'the door fills the entire frame edge to edge, perfectly frontal orthographic elevation view, straight-on symmetrical, no perspective, full frame texture, no background visible, no wall around it, even lighting';

interface Job {
  file: string;
  out: string;
  prompt: string;
  size: string;
}

const FURN: Array<[string, string, string]> = [
  ['f_sofa.png', 'cozy three-seat sofa with rounded armrests and two cushions', 'terracotta orange fabric'],
  ['f_tv.png', 'flat screen television on a low wooden media stand with a tiny console below', 'dark screen with soft reflection, walnut stand'],
  ['f_mesa.png', 'rectangular wooden dining table with a fruit bowl on top', 'honey wood, bowl with oranges'],
  ['f_nevera.png', 'retro refrigerator with vertical chrome handle and rounded corners', 'sage green'],
  ['f_fogones.png', 'kitchen counter with stovetop, two pans and a small utensil rail on the wall above', 'white counter, steel pans'],
  ['f_planta.png', 'tall potted monstera plant with many leaves', 'terracotta pot'],
  ['f_lampara.png', 'floor lamp with fabric shade and slim wooden legs', 'beige shade, warm glow'],
  ['f_cama.png', 'double bed seen perfectly from the front, headboard facing the viewer, blanket and two pillows visible', 'teal blanket, wooden headboard'],
  ['f_armario.png', 'tall two-door wardrobe with round handles', 'warm oak wood'],
  ['f_mesita.png', 'small nightstand with one drawer and a tiny alarm clock on top', 'walnut wood'],
  ['f_lavabo.png', 'pedestal washbasin with mirror above and a towel hook', 'white ceramic, aqua tiles strip'],
  ['f_lavadora.png', 'washing machine with round porthole door and small detergent box on top', 'white body, teal buttons'],
  ['f_cajas.png', 'stack of two cardboard moving boxes with tape, one labeled fragile', 'cardboard brown'],
  ['f_estanteria.png', 'tall metal shelving unit with jars, books and a folded blanket on the shelves', 'grey steel, colorful items'],
  ['f_trastos.png', 'pile of old junk: dusty fan, broken chair and paint bucket', 'muted greys and browns'],
  ['f_bici.png', 'bicycle leaning against the wall seen perfectly from the side, wheels in profile', 'red frame, basket'],
  ['f_alfombra.png', 'rectangular woven rug with simple geometric border pattern, laid flat seen from directly above', 'terracotta and cream pattern'],
];

const TREES: Array<[string, string]> = [
  ['tree_round.png', 'leafy street tree with a wide rounded canopy and slender brown trunk, lush sage green foliage with darker clumps, straight vertical trunk, cartoon park tree'],
  ['tree_pine.png', 'tall Mediterranean pine with an umbrella-shaped canopy of dark green foliage clusters on a curved brown trunk, cartoon park tree'],
  ['tree_poplar.png', 'tall narrow poplar tree with an elongated oval bright green canopy and straight trunk, cartoon park tree'],
  ['tree_bushy.png', 'small bushy orange tree with dense rounded canopy of fresh green leaves and a few tiny orange fruits on a short sturdy trunk, cartoon park tree'],
];

const JOBS: Job[] = [
  ...FURN.map<Job>(([file, subject, detail]) => ({
    file,
    out: OUT,
    prompt: `${subject}, ${detail}, ${STICKER}, ${STYLE}`,
    size: '1024x1024',
  })),
  ...TREES.map<Job>(([file, subject]) => ({
    file,
    out: OUT_TREES,
    prompt: `${subject}, ${STICKER}, ${STYLE}`,
    size: '1024x1024',
  })),
  // ── Puertas de vivienda: full-bleed (la textura ES la hoja) ──
  {
    file: 'door_casa_a.png',
    out: OUT,
    prompt: `a wooden apartment front door with two recessed panels, brass peephole and handle plate, warm walnut brown, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  {
    file: 'door_casa_b.png',
    out: OUT,
    prompt: `a painted apartment front door with vertical groove lines, mail slot and round knob, deep teal green, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  {
    file: 'door_casa_c.png',
    out: OUT,
    prompt: `an apartment front door with a small glazed grid window at the top and lower panel, terracotta red paint, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
  // ── Puerta de zonas comunes (cubo de escalera): full-bleed, el número va encima en runtime ──
  {
    file: 'door_comunal.png',
    out: OUT,
    prompt: `a plain sturdy common-area stairwell door of a Spanish apartment building, greyish sage green painted metal with a kick plate at the bottom and a simple handle, slightly worn paint, ${FULLBLEED}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '768x1344',
  },
];

async function generate(zai: Awaited<ReturnType<typeof ZAI.create>>, job: Job): Promise<void> {
  const outPath = path.join(job.out, job.file);
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
