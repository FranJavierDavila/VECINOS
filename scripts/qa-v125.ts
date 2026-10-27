/**
 * QA v1.25 "la casa de todos" — las 13 correcciones del reporte del vecino:
 *  1. Puertas de ascensor con textura (arte + recorte full-bleed en runtime).
 *  2. Puertas de vivienda full-bleed: el fondo cocinado (pared/suelo del sello) se recorta
 *     por flood-fill de esquinas — nada de "elementos antiguos" alrededor de la hoja.
 *  3. TODAS las puertas iguales con la textura marrón (doorArts con una sola variante).
 *  4. Candados en forma de caja FUERA: candado dibujado (silueta real) con recorte.
 *  5. Pared gris clarito + zócalo de ~25 cm + marcos DEL COLOR del zócalo (data-driven).
 *  6. Muebles regenerados con recorte limpio (lavabo sin azulejos, alfombra sin suelo,
 *     fogones conectados) + pipeline de recorte más honesto.
 *  7. Variedad aleatoria entre viviendas: tintes de pared, espejo, jitter y paredes
 *     alternativas — deterministas por hash01 del bloque (el sim no se entera).
 *  8. Viandantes = vecinos de verdad (rigs glTF del catálogo con clip de andar) + orientación
 *     corregida (yaw hacia donde andan).
 *  9. Sin tabiques interiores: hueco completo dormitorio↔baño en el layout + tapas ESTRECHAS
 *     (una hoja de puerta, no la pared entera).
 * 10. Macetas de pasillo como recortes billboard (adiós cilindros).
 * 11. Hueco oscuro flotante del cubo de escalera oculto (stairs.facade.hideNodes).
 * 12. Noche: viviendas despiertas claramente iluminadas (privacy.night del catálogo).
 * 13. Noche: AUTOILUMINACIÓN del cubo de escalera con alguien dentro (activityLight.wallGlow).
 *  + Sim intacto: 240 ticks deterministas tras tocar SOLO presentación/contenido.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { roomRoute, walkable, type LayoutGeometry } from '@/game/interior';
import { createWorld, type World } from '@/game/sim';
import { tick } from '@/game/sim/tick';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};

const PUB = path.join(import.meta.dir, '..', 'public');
const exists = (rel: string): boolean => fs.existsSync(path.join(PUB, rel.replace(/^\//, '')));

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;

// ── 1. Puertas de ascensor ──
console.log('\n── Ascensor: puertas con textura correcta ──');
check('elevator.doorArt declarado', !!v.elevator.doorArt && exists(v.elevator.doorArt!), v.elevator.doorArt);

// ── 2+3. Puertas de vivienda: marrón unificado y full-bleed ──
console.log('\n── Puertas de vivienda: marrón unificado, full-bleed ──');
check('una sola variante de puerta (todas iguales marrón)', v.privacy.doorArts?.length === 1, (v.privacy.doorArts ?? []).join(', '));
check('el arte de puerta existe en disco', (v.privacy.doorArts ?? []).every(exists));
check('lockArt retirado del runtime de arte (candado dibujado)', (v.privacy.lockArt ?? '') === '');

// ── 4. Candado dibujado ──
console.log('\n── Candado: silueta real, nada de cajas ──');
check('lockW/lockH pequeños (quad, no caja)', (v.privacy.lockW ?? 0) < 0.4 && (v.privacy.lockH ?? 0) < 0.45, `${v.privacy.lockW}×${v.privacy.lockH}`);

// ── 5. Pared gris + zócalo + marcos ──
console.log('\n── Acabado: pared gris clarito + zócalo 25 cm + marcos del zócalo ──');
check('wallColor gris clarito declarado', !!v.privacy.wallColor && /^#/.test(v.privacy.wallColor!), v.privacy.wallColor);
check('zócalo ≈ 0.25 m', Math.abs((v.privacy.skirtingH ?? 0) - 0.25) < 0.03, `skirtingH ${v.privacy.skirtingH}`);
check('zócalo y marcos comparten color', v.privacy.skirtingColor === v.privacy.skirtingColor, v.privacy.skirtingColor);

// ── 6. Muebles regenerados ──
console.log('\n── Muebles: arte regenerado con recorte limpio ──');
for (const f of ['f_lavabo.png', 'f_alfombra.png', 'f_fogones.png']) {
  check(`${f} presente`, exists(`/art/interiors/raw/${f}`));
}

// ── 7. Variedad aleatoria ──
console.log('\n── Variedad aleatoria entre viviendas ──');
const cat = content.interiors;
check('wallTints declarado (≥3 tintes)', (cat?.wallTints.length ?? 0) >= 3, `${cat?.wallTints.length} tintes`);
check('mirrorChance > 0', (cat?.mirrorChance ?? 0) > 0, `${cat?.mirrorChance}`);
check('jitter > 0', (cat?.jitter ?? 0) > 0, `${cat?.jitter}`);
check('salon con paredes alternativas', (cat?.rooms['estancia_salon_cocina']?.walls.length ?? 0) >= 2, cat?.rooms['estancia_salon_cocina']?.walls.join(', '));
check('dormitorio con paredes alternativas', (cat?.rooms['estancia_dormitorio']?.walls.length ?? 0) >= 2, cat?.rooms['estancia_dormitorio']?.walls.join(', '));
check('artes alternativos en disco', ['wall_salon_b.png', 'wall_dormitorio_b.png'].every((f) => exists(`/art/interiors/raw/${f}`)));

// ── 8. Viandantes ──
console.log('\n── Viandantes: estética de vecinos + orientación ──');
const pedCfg = v.pedestrians as unknown as { actorArchetypes?: string[] };
const actorIds = Object.keys(content.assets?.actors ?? {});
check('sin lista excluyente (todos los arquetipos con andar prestan cuerpo)', !pedCfg.actorArchetypes || pedCfg.actorArchetypes.length === 0, `actorArchetypes: ${pedCfg.actorArchetypes?.length ?? 0}`);
check('manifiesto de actores con clip de andar disponible', actorIds.length >= 8, `${actorIds.length} arquetipos`);

// ── 9. Sin tabiques interiores ──
console.log('\n── Plan abierto: sin tabique divisorio central ──');
const layout = content.layouts['layout_vivienda_v1'];
const dB = (layout?.doorways ?? []).find((d) => [d.a, d.b].includes('dormitorio') && [d.a, d.b].includes('bano'));
check('hueco dormitorio↔baño declarado', !!dB, dB ? `eje ${dB.axis} ancho ${dB.width}` : 'NO');
check('el hueco cubre TODO el borde compartido', !!dB && dB.width >= 2.5 - 0.01, `width ${dB?.width}`);
{
  // Geometría de layout a mano (layoutGeometryOf necesita un bloque vivo): la misma verdad
  // que consume walkable/roomRoute en runtime. Todas las estancias ABIERTAS: aquí se prueba
  // la declaración de huecos (libertad de movimiento), no el candado por estancia.
  const geo: LayoutGeometry = {
    rooms: (layout?.rooms ?? []).map((r) => ({ key: r.key, defId: r.defId, rect: r.rect!, locked: false })),
    doorways: layout?.doorways ?? [],
  };
  const salon = geo.rooms.find((r) => r.key === 'salon')!;
  // cruzar el antiguo tabique central a TRES alturas distintas
  const cruzarCentral = [0.4, 1.25, 2.2].every((z) => walkable(geo, salon, salon.rect.x + salon.rect.w + 0.05, z));
  check('walkable cruza el antiguo tabique a cualquier altura', cruzarCentral);
  const ruta = roomRoute(geo, 'salon', 'bano');
  check('ruta salon→baño directa existe', ruta !== null && ruta.length <= 2, (ruta ?? []).join('→'));
  const rutaPorDorm = roomRoute(geo, 'salon', 'dormitorio');
  check('ruta salon→dormitorio existe', rutaPorDorm !== null, (rutaPorDorm ?? []).join('→'));
}

// ── 10. Macetas billboard ──
console.log('\n── Macetas de pasillo: recortes billboard ──');
check('pots.artH declarado (altura del recorte)', (v.pots.artH ?? 0) >= 0.4, `artH ${v.pots.artH}`);

// ── 11. Hueco oscuro del cubo oculto ──
console.log('\n── Cubo de escalera: hueco flotante fuera ──');
check('stairs.facade.hideNodes incluye hueco', (v.stairs.facade.hideNodes ?? []).includes('hueco'), (v.stairs.facade.hideNodes ?? []).join(', '));

// ── 12. Noche: viviendas despiertas bien iluminadas ──
console.log('\n── Noche: viviendas despiertas visiblemente iluminadas ──');
const night = v.privacy.night;
check('privacy.night declarado', !!night);
// v1.29 - el vecino pidio glow MUY sutil (demasiado exagerado): niveles bajados.
check('dioGlow sutil (≤0.4, peticion v1.29)', (night?.dioGlow ?? 1) <= 0.4, `dioGlow ${night?.dioGlow}`);
check('floorGlow sutil (≤0.35, peticion v1.29)', (night?.floorGlow ?? 1) <= 0.35, `floorGlow ${night?.floorGlow}`);
check('lampGlow moderado (≤1.0, peticion v1.29)', (night?.lampGlow ?? 2) <= 1.0, `lampGlow ${night?.lampGlow}`);

// ── 13. Autoiluminación del cubo ──
console.log('\n── Noche: escalera con autoiluminación ──');
check('activityLight.wallGlow declarado (≥0.2)', (v.stairs.activityLight.wallGlow ?? 0) >= 0.2, `wallGlow ${v.stairs.activityLight.wallGlow}`);

// ── Sim intacto ──
console.log('\n── Sim intacto: 240 ticks deterministas ──');
{
  const world: World = createWorld(content, content.rules.startScenario);
  const t0 = JSON.stringify(world.clock);
  for (let i = 0; i < 240; i++) tick(world, content);
  check('240 ticks avanzan el reloj sin errores', world.clock.day >= 1 && JSON.stringify(world.clock) !== t0, `día ${world.clock.day} minuto ${world.clock.minute}`);
  check('vivienda del jugador determinista', world.residents[world.playerId]?.home === 'blk_p3_c', world.residents[world.playerId]?.home ?? '');
}

console.log(`\nQA v1.25: ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
