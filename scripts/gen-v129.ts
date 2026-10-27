/**
 * v1.29 "el ascensor de verdad" — arte del PASE DE INTERIORES (petición del vecino):
 *  · INTERIORES EN PARALLAX COMPLETOS: el diorama pasa a mapear TODAS las caras (fondo,
 *    laterales, techo y suelo) — hace falta arte para las caras nuevas.
 *  · ≥10 VARIACIONES por tipo de estancia: más paredes del fondo (planas, sin esquinas
 *    cocinadas), suelos alternativos, techos y laterales reutilizables + juegos de
 *    mobiliario con variantes nuevas.
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
/** PARED PLANA del fondo: llena el marco, SIN esquinas de habitación (los laterales y el
 *  techo son quads reales en 3D — el arte no debe pintarlos). */
const WALLFLAT =
  'a single flat interior wall filling the entire frame edge to edge, perfectly straight-on orthographic view, absolutely no perspective, no room corners, no side walls, no floor, no ceiling, only the wall surface with its decoration, even lighting, full frame texture';

interface Job {
  file: string;
  prompt: string;
  size: string;
}

const JOBS: Job[] = [
  // ── Paredes del fondo NUEVAS (planas, sin esquinas) ──
  {
    file: 'wall_salon_c.png',
    prompt: `a teal painted living room wall with a long low wooden sideboard cabinet with two closed doors and small round legs, a vintage radio and a small cactus on top of the sideboard, two framed abstract art prints above it, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_salon_d.png',
    prompt: `a sandy yellow living room wall with a tall wooden bookshelf full of colorful books and a small plant, a hanging wall clock, a guitar leaning against the wall, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_salon_e.png',
    prompt: `a dusty sage green living room wall with a white framed window with light curtains on the left half, a small wooden console table with a vase of flowers under the window, a round mirror on the right half, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_dormitorio_c.png',
    prompt: `a dusty blue-gray bedroom wall with two framed pictures of mountains, a small floating wooden nightstand with an alarm clock, a string of warm round light bulbs hanging across, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_dormitorio_d.png',
    prompt: `a soft terracotta pink bedroom wall with a round woven wall hanging, two small floating shelves with tiny plants and books, a butterfly wall sticker, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_bano_b.png',
    prompt: `a light aqua mint bathroom wall with white subway tiles on the lower half, a round mirror with a shelf, a towel hanging from a ring, a small porthole window, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_bano_c.png',
    prompt: `a soft lavender bathroom wall with a white panelled wainscot on the lower half, a brass wall lamp, a framed vintage bath poster, a hook with a blue bathrobe, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'wall_trasera_b.png',
    prompt: `a warm ochre storage room back wall with a wooden coat rack with two hanging jackets, a small shuttered window, a cork board with pinned notes, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  // ── LATERALES del diorama (genéricas, con puerta y con ventana) ──
  {
    file: 'side_wall_a.png',
    prompt: `a flat interior wall painted in plain light warm gray with a simple white six-panel interior door at the center and a light wooden baseboard along the bottom edge, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'side_wall_b.png',
    prompt: `a flat interior wall painted in plain light warm gray with a tall narrow window with four panes on the left half and a white radiator under it, light wooden baseboard along the bottom edge, ${WALLFLAT}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  // ── TECHOS del diorama ──
  {
    file: 'ceiling_a.png',
    prompt: `a flat white apartment ceiling filling the entire frame edge to edge, perfectly straight-on orthographic view, no perspective, no walls, with a small round ceiling rose in the center and a simple hanging pendant light with a warm glowing bulb, subtle soft shadow gradient, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'ceiling_b.png',
    prompt: `a flat light beige apartment ceiling with rustic wooden beams crossing evenly, filling the entire frame edge to edge, perfectly straight-on orthographic view, no perspective, no walls, one small warm glowing flush mount light at the center, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  // ── SUELOS alternativos ──
  {
    file: 'floor_madera_b.png',
    prompt: `a dark walnut wooden plank floor texture filling the entire frame edge to edge, perfectly straight-on orthographic top view, no perspective, horizontal planks with visible grain and subtle knots, seamless tileable pattern, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'floor_parket.png',
    prompt: `a honey oak herringbone parquet floor texture filling the entire frame edge to edge, perfectly straight-on orthographic top view, no perspective, seamless tileable pattern, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'floor_baldosa_b.png',
    prompt: `a cream and terracotta checkered ceramic tile floor texture filling the entire frame edge to edge, perfectly straight-on orthographic top view, no perspective, thin warm gray grout lines, seamless tileable pattern, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  // ── Mobiliario nuevo (variantes) ──
  {
    file: 'f_sofa_b.png',
    prompt: `a cozy teal blue fabric sofa with rounded armrests, two striped cushions and short wooden legs, seen from the front, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_cama_b.png',
    prompt: `a single iron frame bed with a white frame, a folded turquoise blanket and one round pillow, seen from the front side, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_mesa_b.png',
    prompt: `a round wooden dining table with a tablecloth and a fruit bowl with oranges on top, seen from the front, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_armario_b.png',
    prompt: `a tall light sage green wooden wardrobe with two doors and round wooden handles, a small round mirror hanging on its side, seen from the front, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_estanteria_b.png',
    prompt: `a tall industrial metal shelf unit with wooden planks holding paint cans, a toolbox and folded boxes, seen from the front, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
    size: '1024x1024',
  },
  {
    file: 'f_planta_b.png',
    prompt: `a tall monstera houseplant with big split leaves in a woven basket pot, seen from the front, ${STICKER}, flat cartoon vector style, clean bold outlines, ${STYLE}`,
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
