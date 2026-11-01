/**
 * QA v1.68 — LA PUERTA MANDA (bug del vecino, planta 3):
 *   «si voy pegado a la pared de la planta 3 y llego a la altura del tabique de mi
 *   vivienda, ME METO DENTRO SIN ENTRAR POR LA PUERTA».
 *
 * CAUSA: doorInFront() devolvía la vivienda con `within` (TODA su fachada), así que la
 * auto-entrada v1.40 saltaba al CRUZAR EL BORDE del bloque — el tabique con el vecino —
 * y landInside() teletransportaba a cx: dentro sin puerta.
 * ARREGLO: la vivienda solo «está delante» en su ZONA DE PUERTA (hoja central
 * privacy.doorW centrada en el bloque + doorPad, la misma caja que dibuja building.ts).
 *
 * Recorrido headless (sin navegador): tabique → fachada → puerta → entrada → salida →
 * re-armado → timbre del vecino → regresión v1.64 D2 (teleportTo) → locales intactos.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import type { BlockInstance, Command, CommandResult, Input } from '@/game/core/types';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;
const world = createWorld(content, content.rules.startScenario);

// Gancho de comandos: cuenta approach/doorbell/move y guarda el utter más reciente.
const log: { cmd: Command; res: CommandResult | void }[] = [];
const logic = new PlayerLogic(world, content, {
  send: (cmd: Command): CommandResult | void => {
    const res = (logic as unknown as { exec(cmd: Command): CommandResult | void });
    void res;
    log.push({ cmd, res: undefined });
    return undefined; // en remoto el resultado llega después; la presentación sigue igual
  },
});
const STEP = 1 / 60;
const INPUT = (o: Partial<Input>): Input => ({ left: false, right: false, up: false, down: false, run: false, ...o });
const run = (frames: number, input: Input): void => {
  for (let i = 0; i < frames; i++) logic.update(STEP, input);
};

// ── Escenario: la vivienda del JUGADOR y su fachada ──
const me = world.residents[world.playerId]!;
const home: BlockInstance = world.blocks[me.home]!;
const homeFloor = home.cell.floor;
const a = home.cell.col * v.cellW; // borde izq. del bloque (el tabique con el vecino)
const b = (home.cell.col + home.size.w) * v.cellW;
const cx = (a + b) / 2;
const zoneHalf = v.privacy.doorW / 2 + (v.locals.walkIn?.doorPad ?? 0.05);
const innerZ = v.corridorZ; // carril interior = pegado a la pared (onOuterLane false)
console.log(`· vivienda del jugador: ${home.id} (planta ${homeFloor}), fachada [${a.toFixed(2)}, ${b.toFixed(2)}], puerta cx=${cx.toFixed(2)}, zona ±${zoneHalf.toFixed(2)} m`);

// Colocación directa en el pasillo (la QA v1.121 hace lo mismo: x/z/floor son públicos).
const place = (x: number): void => {
  logic.mode = 'corridor';
  logic.floor = homeFloor;
  logic.x = x;
  logic.z = innerZ;
};

console.log('── A. El tabique ya no mete en casa ──');
place(a + 0.05);
check('A1 pegado a la pared EN el tabique: nada delante', logic.doorInFront() === null, `x=${(a + 0.05).toFixed(2)}`);
run(30, INPUT({}));
check('A2 30 frames quieto en el tabique: sigues en el pasillo', logic.mode === 'corridor' && logic.position().insideBlock === null, `modo=${logic.mode}`);
place(a + 0.3);
run(30, INPUT({}));
check('A3 a media fachada (x=cx−2.2): tampoco', logic.mode === 'corridor', `x=${(a + 0.3).toFixed(2)} modo=${logic.mode}`);
place(b - 0.05);
check('A4 tabique DERECHO: nada delante', logic.doorInFront() === null, `x=${(b - 0.05).toFixed(2)}`);
const approachesHome = (): number => log.filter((e) => e.cmd.type === 'approach' && e.cmd.block === home.id).length;
const before = approachesHome();
run(20, INPUT({}));
check('A5 approach de TU vivienda no salta en la fachada', approachesHome() === before, `eventos=${approachesHome() - before}`);

console.log('── B. La puerta SÍ (auto-entrada v1.40 intacta) ──');
place(cx);
const door = logic.doorInFront();
check('B1 en la puerta: TU vivienda delante', door?.id === home.id, `doorInFront=${door?.id ?? 'null'}`);
run(2, INPUT({}));
check('B2 auto-entrada al plantarte ante tu puerta', logic.mode === 'inside' && logic.position().insideBlock === home.id, `modo=${logic.mode} dentro=${logic.position().insideBlock}`);
check('B3 aterrizaje por la hoja central (cx, umbral 0.45)', Math.abs(logic.x - cx) < 1e-6 && Math.abs(logic.z - 0.45) < 1e-6, `x=${logic.x.toFixed(2)} z=${logic.z.toFixed(2)}`);

console.log('── C. Salir andando y re-armado (sin bucle entrar/salir) ──');
run(1, INPUT({ down: true })); // armOnEnter: el primer S en el umbral te deja fuera
check('C1 S en el umbral te devuelve al pasillo', logic.mode === 'corridor', `modo=${logic.mode}`);
run(60, INPUT({}));
check('C3 60 frames en la puerta tras salir: NO re-entra solo', logic.mode === 'corridor', `modo=${logic.mode}`);
run(120, INPUT({ right: true })); // te alejas por la fachada (>1 s fuera de la zona)
const walkedAway = logic.x > cx + zoneHalf + 0.1;
check('C4 el paseo te saca de la zona de puerta', walkedAway, `x=${logic.x.toFixed(2)} (zona hasta ${(cx + zoneHalf).toFixed(2)})`);
run(10, INPUT({}));
check('C5 fuera de la zona: sigues en el pasillo', logic.mode === 'corridor', `modo=${logic.mode}`);

console.log('── C6. La salida ANDANDO también exige SU vano (v1.68, simétrico del informe) ──');
// Antes ownHome eximía la salida del chequeo de hueco: dentro de casa, empujar S junto al
// tabique (z ≤ exitZ) te echaba al pasillo ATRAVESANDO la pared. Ahora la salida andando
// exige el vano; la E sigue valiendo desde cualquier punto (salida clásica).
let backFrames = 0;
while (logic.mode === 'corridor' && logic.x > cx && backFrames < 400) {
  logic.update(STEP, INPUT({ left: true }));
  backFrames++;
}
check('C6a re-entrada por la puerta (auto-entrada v1.40 intacta)', logic.mode === 'inside', `modo=${logic.mode} x=${logic.x.toFixed(2)}`);
run(40, INPUT({ up: true })); // adentrarse de verdad (z > armZ: armado clásico)
let cornerFrames = 0;
while (logic.x > a + v.margin + 0.01 && cornerFrames < 400) {
  logic.update(STEP, INPUT({ left: true }));
  cornerFrames++;
}
run(140, INPUT({ down: true })); // al frente en la esquina (z ≤ exitZ), LEJOS del vano
const cornerX = logic.x;
check('C6b S en la esquina del tabique NO sale (antes: salías por la pared)',
  logic.mode === 'inside' && cornerX < cx - zoneHalf - 0.02,
  `x=${cornerX.toFixed(2)} (vano desde ${(cx - zoneHalf).toFixed(2)}) modo=${logic.mode}`);
let back2Frames = 0;
while (logic.x < cx && back2Frames < 400) {
  logic.update(STEP, INPUT({ right: true }));
  back2Frames++;
}
run(1, INPUT({ down: true })); // S DENTRO del vano → fuera por la puerta
check('C6c S en el vano sí sale', logic.mode === 'corridor', `x=${logic.x.toFixed(2)} modo=${logic.mode}`);

console.log('── D. El aviso (approach) vive EN la puerta ──');
place(cx - zoneHalf - 0.4); // justo FUERA de la zona, margen de 0.4 m
const approachXs: number[] = [];
let mark = log.length;
for (let i = 0; i < 240 && logic.mode === 'corridor'; i++) {
  const xBefore = logic.x; // la entrada automática TELETRANSPORTA en el mismo frame: mide antes
  logic.update(STEP, INPUT({ right: true }));
  // el approach comparte frame con el move de la auto-entrada: escanear TODO el delta
  const newHome = log.slice(mark).some((e) => e.cmd.type === 'approach' && (e.cmd as { block: string }).block === home.id);
  mark = log.length;
  if (newHome) approachXs.push(xBefore);
}
const firstApproachX = approachXs[0];
// xBefore se mide ANTES del avance del frame (≈0.05 m a walkSpeed): un paso de margen.
check('D1 el primer approach de TU vivienda llega DENTRO de la zona de puerta',
  approachXs.length > 0 && firstApproachX! >= cx - zoneHalf - 0.07,
  `x=${firstApproachX?.toFixed(2) ?? '—'} (zona desde ${(cx - zoneHalf).toFixed(2)}, el punto medido va un frame por detrás)`);
check('D2 y la entrada automática llega con él (misma puerta)', logic.mode === 'inside', `modo=${logic.mode}`);

console.log('── E. El timbre del vecino también vive EN su puerta ──');
const neighbor = Object.values(world.blocks).find(
  (bl) => bl.kind === 'dwelling' && bl.id !== home.id && bl.cell.floor === homeFloor && bl.occupancy === 'occupied',
);
if (neighbor) {
  const na = neighbor.cell.col * v.cellW;
  const nb = (neighbor.cell.col + neighbor.size.w) * v.cellW;
  const ncx = (na + nb) / 2;
  place(na + 0.05); // su tabique
  check('E1 ante la fachada AJENA (en su tabique): nada que activar', logic.doorInFront() === null, `x=${(na + 0.05).toFixed(2)}`);
  const r1 = logic.interact();
  check('E2 E en su tabique NO toca el timbre', r1.type !== 'doorbell', `interact=${r1.type}`);
  place(ncx);
  check('E3 ante SU puerta: la vivienda ajena delante', logic.doorInFront()?.id === neighbor.id, `doorInFront=${logic.doorInFront()?.id ?? 'null'}`);
  const r2 = logic.interact();
  check('E4 E en su puerta toca el TIMBRE (flujo v1.40 intacto)', r2.type === 'doorbell', `interact=${r2.type}`);
} else {
  console.log('· E sin vecino ocupado en la misma planta: prueba omitida');
}

console.log('── F. Regresiones: teleportTo (v1.64 D2) y locales ──');
logic.mode = 'corridor';
logic.floor = 0;
logic.x = 1;
logic.z = innerZ;
check('F1 teleportTo(home) planta ante la puerta y doorInFront la ve', logic.teleportTo(home.id) && logic.doorInFront()?.id === home.id, `x=${logic.x.toFixed(2)}`);
const portal = Object.values(world.blocks).find((bl) => bl.defId === 'portal');
if (portal) {
  const slideHalf = (v.locals.portalDoors?.slide ?? 0.96) + (v.locals.walkIn?.doorPad ?? 0.05);
  logic.mode = 'corridor';
  logic.floor = portal.cell.floor;
  logic.x = (portal.cell.col + portal.size.w) * v.cellW - 0.1; // cristal fijo lateral
  logic.z = innerZ;
  check('F2 el portal sigue SIN puerta en el cristal fijo (v1.47 intacta)', logic.doorInFront()?.id !== portal.id, `x=${logic.x.toFixed(2)} (vano hasta ${(portal.cell.col + portal.size.w / 2 + slideHalf).toFixed(2)})`);
}

console.log(`\n${pass} pasan, ${fail} fallan`);
process.exit(fail === 0 ? 0 : 1);
