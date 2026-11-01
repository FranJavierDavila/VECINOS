/**
 * Genera el arte de los dioramas interiores (v1.23): paredes, suelos, puerta trasera
 * y sprites de mobiliario para las capas de billboards con paralaje.
 * Estilo ancla: cartoon plano con contornos, paleta cálida del juego
 * (terracota #f4a261, teal #a8dadc, arena #e9c46a, marrón #b08968, salvia #8ab17d).
 * Los sprites salen sobre blanco puro → el runtime les recorta el fondo por
 * flood-fill desde los bordes (canvas, sin dependencias nativas).
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUT = path.join(import.meta.dir, '..', 'public', 'art', 'interiors', 'raw');
fs.mkdirSync(OUT, { recursive: true });

const STYLE =
  'flat cartoon vector illustration, clean bold outlines, cozy Spanish apartment game art, warm palette (terracotta orange, teal, sandy yellow, sage green), soft shading, high quality';

interface Job {
  file: string;
  prompt: string;
  size: '1024x1024' | '768x1344' | '864x1152' | '1344x768' | '1152x864' | '1440x720' | '720x1440';
}

const WALL = (es: string, en: string): string => `front view of an interior back wall, ${en}, flat painted wall filling the entire frame edge to edge, no floor, no ceiling, no furniture, ${STYLE}`;

const JOBS: Job[] = [
  // ── Paredes del fondo (full-bleed) ──
  { file: 'wall_salon.png', prompt: WALL('salón-cocina', 'warm terracotta painted wall, lower half covered in white kitchen metro tiles, one small framed picture of a paella, a floating wooden shelf with jars'), size: '1024x1024' },
  { file: 'wall_dormitorio.png', prompt: WALL('dormitorio', 'soft teal painted wall, string of warm fairy lights, two small framed landscape prints, subtle striped wainscot'), size: '1024x1024' },
  { file: 'wall_bano.png', prompt: WALL('baño', 'aqua blue ceramic tiles covering the whole wall, white grout, one small round mirror and a towel hook with a yellow towel'), size: '1024x1024' },
  { file: 'wall_trasera.png', prompt: WALL('cuarto de lavado', 'warm sandy beige plaster wall, wooden clothes line with two hanging garments, small window with closed wooden shutters'), size: '1024x1024' },
  { file: 'wall_trastero.png', prompt: WALL('trastero', 'bare greyish concrete plaster wall with water stains, one dangling bare light bulb with cord from top, chalk tally marks in a corner'), size: '1024x1024' },
  // ── Suelos (full-bleed, top-down) ──
  { file: 'floor_madera.png', prompt: 'top-down seamless texture of warm wooden floor planks, terracotta honey tone, flat cartoon style, even lighting, no objects, fills entire frame edge to edge', size: '1024x1024' },
  { file: 'floor_baldosa.png', prompt: 'top-down seamless texture of cream and terracotta checkered ceramic floor tiles, flat cartoon style, even lighting, no objects, fills entire frame edge to edge', size: '1024x1024' },
  { file: 'floor_hormigon.png', prompt: 'top-down seamless texture of smooth grey concrete floor with subtle cracks and stains, flat cartoon style, even lighting, no objects, fills entire frame edge to edge', size: '1024x1024' },
  // ── Puerta decorativa (pared del fondo con bloque trasero) ──
  { file: 'door_rear.png', prompt: 'a single closed wooden apartment door with frame, brass handle and small sign, straight front view, centered, isolated on pure white background, flat cartoon vector style, clean bold outlines, warm brown wood', size: '768x1344' },
  // ── Mobiliario (sprites, fondo blanco → alpha por flood-fill) ──
  { file: 'f_sofa.png', prompt: 'cozy three-seat terracotta orange sofa with cushions, three-quarter front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_tv.png', prompt: 'flat screen television on a low wooden media stand with a small game console, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_mesa.png', prompt: 'round wooden dining table with two chairs and a fruit bowl on top, three-quarter front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_nevera.png', prompt: 'retro sage green refrigerator with chrome handle, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '768x1344' },
  { file: 'f_fogones.png', prompt: 'kitchen counter with stovetop, two pans and a hanging utensil rail, three-quarter front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_planta.png', prompt: 'tall green potted monstera plant in a terracotta pot, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '768x1344' },
  { file: 'f_lampara.png', prompt: 'warm floor lamp with beige fabric shade and slim wooden legs, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '768x1344' },
  { file: 'f_cama.png', prompt: 'double bed with teal blanket, white pillows and wooden frame, three-quarter front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_armario.png', prompt: 'tall wooden wardrobe with two doors and round handles, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '768x1344' },
  { file: 'f_mesita.png', prompt: 'small wooden nightstand with a tiny alarm clock on top, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_lavabo.png', prompt: 'white ceramic wash basin on a light wooden cabinet with a small mirror above it, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '768x1344' },
  { file: 'f_lavadora.png', prompt: 'white washing machine with round porthole door and buttons, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_cajas.png', prompt: 'stack of three cardboard moving boxes with tape, one open, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_estanteria.png', prompt: 'tall wooden storage shelf filled with paint cans, tools, books and a watering can, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '768x1344' },
  { file: 'f_trastos.png', prompt: 'pile of household junk: yellow mop bucket with mop, old radio and broken umbrella, front view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
  { file: 'f_bici.png', prompt: 'red bicycle leaning against nothing, side view slightly angled, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1344x768' },
  { file: 'f_alfombra.png', prompt: 'round woven rug with concentric terracotta and sand rings, perfect top-down view, isolated on pure white background, flat cartoon vector style, clean bold outlines', size: '1024x1024' },
];

async function main(): Promise<void> {
  const zai = await ZAI.create();
  const pending = [...JOBS];
  let ok = 0;
  let fail = 0;
  const CONC = 1;
  const worker = async (wid: number): Promise<void> => {
    while (pending.length > 0) {
      const job = pending.shift();
      if (!job) break;
      const dest = path.join(OUT, job.file);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) {
        console.log(`· ${job.file} ya existe, salto`);
        ok++;
        continue;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await zai.images.generations.create({ prompt: job.prompt, size: job.size });
          const b64 = res.data[0]?.base64;
          if (!b64) throw new Error('respuesta sin base64');
          fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
          console.log(`✓ [w${wid}] ${job.file} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
          ok++;
          break;
        } catch (err) {
          console.warn(`✗ [w${wid}] intento ${attempt} ${job.file}: ${err instanceof Error ? err.message : err}`);
          if (attempt === 3) fail++;
          else await new Promise((r) => setTimeout(r, 6000 * attempt));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
  console.log(`GENERACIÓN TERMINADA: ${ok} ok, ${fail} fallos de ${JOBS.length}`);
  if (fail > 0) process.exit(2);
}

void main();
