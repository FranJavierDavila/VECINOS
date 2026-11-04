/**
 * QA v1.64 — TIMBRE QUE ABRE + IDENTIDAD DEL INVITADO + POSES + ESCALERA (bugs P0).
 *
 * Un SOLO navegador (memoria: dos escenas Babylon OOM-mataban el sandbox de 4 GB) + un
 * ANFITRIÓN simulado con socket.io (protocolo v1 exacto, hermano de test-pose.ts):
 *  A. TIMBRE (un jugador): llamar a la puerta de un vecino PRESENTE aunque no esté dentro
 *     de su vivienda ABRE (antes exigía owner.location === block: timbre eterno). Vacía
 *     sigue cerrada (norma del barrio) y E dentro te deja salir (flujo intacto).
 *  B. SEED/IDENTIDAD: el invitado (navegador) controla SU residente res_guest_N — su
 *     PlayerLogic nace ANTES de conocer su id; el mundo converge con el del servidor.
 *  C. POSES: el anfitrión-simulado emite mp:pose y el avatar anda en la pantalla del
 *     invitado; el invitado emite las suyas y el anfitrión las recibe (Δ > 0,3 m).
 *  D. INVITADO ENTRA EN SU CASA: E en su puerta = entrar (no timbre) y el servidor
 *     confirma la ubicación (session:state del anfitrión).
 *  E. ESCALERA→ENTRADA: subir por el cubo NO devuelve al portal; el servidor confirma
 *     el pozo de la planta superior.
 *  F. Cero errores JS en la página.
 */
import { chromium } from 'playwright-core';
import { io, type Socket } from 'socket.io-client';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:81/?qaengine=1';
const SERVER = 'http://127.0.0.1:3010';

let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};

// ─────────────── Anfitrión simulado (socket.io puro) ───────────────
interface StateMsg { seq: number; world: { tick: number; seed: number; residents: Record<string, { location: string | null; home: string }>; playerId: string } }
type CreateAck = { ok: true; code: string; yourResidentId: string } | { ok: false; error: string };

// v1.71 (higiene): el server sirve socket.io en path '/' (contrato de Caddy, ver index.ts);
// el cliente DEBE pedir el mismo path — el default '/socket.io/' solo chocaba con una
// instancia vieja del server y hacía caer el suite con TransportError.
const host = io(SERVER, { path: '/', transports: ['websocket', 'polling'], forceNew: true }) as Socket;
await new Promise<void>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout conectando al servidor')), 8000);
  host.on('connect', () => { clearTimeout(t); res(); });
  host.on('connect_error', (e) => { clearTimeout(t); rej(e); });
});
// `as StateMsg | null` evita que TS estreche la variable a `null` (se asigna desde el callback):
let hostState = null as StateMsg | null;
host.on('session:state', (s: StateMsg) => { hostState = s; });
const hostId: string = await new Promise<string>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout en session:create')), 8000);
  host.emit('session:create', {}, (r: CreateAck) => {
    clearTimeout(t);
    if (r.ok) res(r.yourResidentId);
    else rej(new Error('session:create falló: ' + r.error));
  });
});
const code: string = await new Promise<string>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout esperando session:joined')), 8000);
  host.once('session:joined', (j: { code: string }) => { clearTimeout(t); res(j.code); });
});
check('H0 anfitrión-simulado creó la sesión', /^[A-Z2-9]{4}$/.test(code), `código ${code} · host=${hostId}`);

// ─────────────── Página del invitado (único navegador) ───────────────
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  // v1.64 — el sandbox tiene 4 GB y el next-dev devora ~1,2 GB: sin techo de heap el
  // renderer de Chrome crece hasta que el kernel lo OOM-mata a mitad del QA. Cap 512 MB
  // (NullEngine no necesita más) + un solo renderer para las pestañas que abrimos.
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=512', '--renderer-process-limit=1'],
});
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, locale: 'es-ES' });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
let qaOk = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try {
    qaOk = await page.evaluate(() => !!(window as unknown as { __vecinosQa?: unknown }).__vecinosQa);
    if (qaOk) break;
  } catch { /* boot ocupado */ }
}
if (!qaOk) {
  console.log('FALLO: __vecinosQa no apareció en 240 s');
  await browser.close();
  process.exit(1);
}
for (let i = 0; i < 12; i++) {
  const open = await page.evaluate(`(() => {
    var dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return false;
    var btns = dlg.querySelectorAll('button');
    if (btns.length > 0) btns[btns.length - 1].click();
    return true;
  })()`).catch(() => false);
  if (!open) break;
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(600);
}
// v1.64 (blindaje): un 502 transitorio del dev durante el arranque programa el AUTO-RELOAD
// del apagón de assets (~6-10 s) y destruye el contexto a mitad del QA. Ventana de gracia:
// esperamos aquí, re-verificamos el hook y re-cerramos diálogos si la página recargó.
await page.waitForTimeout(9000);
{
  let reQa = false;
  for (let i = 0; i < 30 && !reQa; i++) {
    await page.waitForTimeout(2000);
    try { reQa = await page.evaluate(() => !!(window as unknown as { __vecinosQa?: unknown }).__vecinosQa); } catch { reQa = false; }
  }
  if (!reQa) { console.log('FALLO: __vecinosQa desapareció tras la ventana de gracia'); await browser.close(); process.exit(1); }
  for (let i = 0; i < 8; i++) {
    const open = await page.evaluate(`(() => {
      var dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return false;
      var btns = dlg.querySelectorAll('button');
      if (btns.length > 0) btns[btns.length - 1].click();
      return true;
    })()`).catch(() => false);
    if (!open) break;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }
}
// Helper de posición de actor (cápsula o rig glTF): raíz del nodo que casa con el id.
await page.evaluate(`(() => {
  var w = window;
  w.__qaNodePos = function (id) {
    var sc = w.__vecinosQa.getScene();
    var n = sc.meshes.find(function (m) { return m.name === id || m.name.indexOf(id + '_') === 0; })
      || sc.transformNodes.find(function (m) { return m.name === id || m.name.indexOf(id + '_') === 0; });
    if (!n) return null;
    while (n.parent) n = n.parent;
    return { x: +n.position.x.toFixed(2), y: +n.position.y.toFixed(2), z: +n.position.z.toFixed(2) };
  };
})()`).catch(() => undefined);
const ev = async <T,>(fn: string, tries = 6): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return (await page.evaluate(fn)) as T;
    } catch (e) {
      last = e;
      await page.waitForTimeout(500);
    }
  }
  throw last;
};

const PHASE = process.env.QA_PHASE ?? 'a'; // 'a' = timbre+mp+poses+casa · 'e' = solo escalera (página fresca)
// ════════════════ A. TIMBRE (aún sin sesión: partida clásica) ════════════════
console.log('· [A] timbre en partida clásica');
const SKIP_A = PHASE === 'e';
interface DoorInfo { id: string; owner: string; ownerInside: boolean }
const target = await ev<DoorInfo | null>(`(() => {
  var w = window.__vecinosQa.getWorld();
  var me = w.playerId;
  for (var id in w.blocks) {
    var b = w.blocks[id];
    if (b.kind !== 'dwelling' || b.occupancy !== 'occupied' || !b.ownerId || b.ownerId === me) continue;
    var o = w.residents[b.ownerId];
    if (!o || !o.present) continue;
    return { id: id, owner: o.id, ownerInside: o.location === id };
  }
  return null;
})()`);
if (!SKIP_A) check('A1 hay vivienda ajena habitada para la prueba', !!target, target ? `${target.id} dueño ${target.owner} dentro=${target.ownerInside}` : '');
if (target && !SKIP_A) {
  const outside = await ev<boolean>(`(() => {
    var o = window.__vecinosQa.getWorld().residents[${JSON.stringify(target.owner)}];
    var was = o.location;
    o.location = 'blk_p0_lavanderia'; // en el local: NO está dentro de casa
    return was !== o.location;
  })()`);
  check('A2 dueño colocado FUERA de su vivienda (condición del bug)', outside);
  await ev<string>(`window.__vecinosQa.getLogic().teleportTo(${JSON.stringify(target.id)}), 'ok'`);
  await ev<void>(`window.__vecinosQa.getController().interact()`);
  await page.waitForTimeout(400);
  const after = await ev<{ inside: string | null; mode: string }>(`(() => {
    var p = window.__vecinosQa.getLogic().position();
    return { inside: p.insideBlock ?? null, mode: p.mode };
  })()`);
  check('A3 timbre con dueño fuera ABRE (dentro de la vivienda)', after.inside === target.id, `insideBlock=${after.inside} modo=${after.mode}`);
  await ev<void>(`window.__vecinosQa.getController().interact()`); // E dentro = salir
  await page.waitForTimeout(300);
  const out = await ev<string>(`window.__vecinosQa.getLogic().position().mode`);
  check('A4 E dentro te deja salir (flujo completo del timbre intacto)', out !== 'inside', `modo=${out}`);
  const vacant = await ev<string | null>(`(() => {
    var w = window.__vecinosQa.getWorld();
    for (var id in w.blocks) {
      var b = w.blocks[id];
      if (b.kind === 'dwelling' && b.occupancy === 'vacant') return id;
    }
    return null;
  })()`);
  if (vacant) {
    await ev<string>(`window.__vecinosQa.getLogic().teleportTo(${JSON.stringify(vacant)}), 'ok'`);
    await ev<void>(`window.__vecinosQa.getController().interact()`);
    await page.waitForTimeout(300);
    const stillOut = await ev<{ inside: string | null; mode: string }>(`(() => {
      var p = window.__vecinosQa.getLogic().position();
      return { inside: p.insideBlock ?? null, mode: p.mode };
    })()`);
    check('A5 vivienda VACÍA sigue cerrada (norma del barrio)', stillOut.mode !== 'inside' && stillOut.inside !== vacant, `modo=${stillOut.mode}`);
  } else {
    console.log('· A5 sin viviendas vacías: prueba omitida');
  }
} else if (!SKIP_A) {
  fails++;
  console.log('✗ A1 sin vivienda ajena habitada: no hay prueba posible');
}

// ════════════════ B. El invitado (navegador) se une a la sesión ════════════════
console.log('· [B] el invitado se une con el código');
await ev<void>(`window.__vecinosQa.getController().joinSession(${JSON.stringify(code)})`);
let guestId = '';
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(500);
  guestId = (await page.evaluate(`(window.__vecinosQa.getController() ?? {}).myResidentId ?? ''`).catch(() => '')) as string;
  if (guestId) break;
}
check('B2 invitado aceptado (myResidentId = res_guest_N)', /^res_guest_\d+$/.test(guestId), guestId);

const logicId = await ev<string>(`window.__vecinosQa.getLogic().controlledId()`);
check('B3 PlayerLogic del invitado controla SU residente (rebind)', logicId === guestId, `logic=${logicId} sesión=${guestId}`);

await page.waitForTimeout(2500);
const seedB = await ev<number>(`window.__vecinosQa.getWorld().seed`);
const seedHost = hostState?.world.seed ?? -1;
check('B4 misma seed que el servidor (mundo compartido)', seedB === seedHost, `página=${seedB} servidor=${seedHost}`);
const guestInHost = !!hostState?.world.residents[guestId];
check('B5 el invitado existe en el mundo del anfitrión', guestInHost);
await page.waitForTimeout(2500);
const tickB = await ev<number>(`window.__vecinosQa.getWorld().tick`);
const tickH = hostState?.world.tick ?? -1;
check('B6 ticks convergen (la página ejecuta el mundo del SERVIDOR)', Math.abs(tickB - tickH) <= 3, `página=${tickB} servidor=${tickH}`);

// ════════════════ C. Poses (10 Hz) ════════════════
console.log('· [C] poses de avatar');
const bBefore = await ev<{ x: number; z: number } | null>(`window.__qaNodePos(${JSON.stringify(hostId)})`);
// El anfitrión simulado "anda" 2 s hacia +x a 10 Hz (relay puro del servidor).
for (let i = 0; i < 20; i++) {
  host.emit('mp:pose', { x: 1.2 + i * 0.1, z: -2, floor: 0 });
  await page.waitForTimeout(100);
}
await page.waitForTimeout(1200);
const bAfter = await ev<{ x: number; z: number } | null>(`window.__qaNodePos(${JSON.stringify(hostId)})`);
const dHost = bBefore && bAfter ? Math.hypot(bAfter.x - bBefore.x, bAfter.z - bBefore.z) : 0;
check('C1 el avatar del anfitrión ANDA en la pantalla del invitado (pose remota)', dHost > 0.3, `Δ=${dHost.toFixed(2)} m (poses sintéticas +x)`);

const poses: { x: number; z: number; floor: number }[] = [];
const onPose = (p: { from: string; x: number; z: number; floor: number }) => {
  if (p.from === guestId) poses.push({ x: p.x, z: p.z, floor: p.floor });
};
host.on('mp:pose', onPose);
await ev<void>(`window.__vecinosQa.setTouch({ left: true })`);
await page.waitForTimeout(2200);
await ev<void>(`window.__vecinosQa.setTouch({ up: false, down: false, left: false, right: false })`);
await page.waitForTimeout(600);
host.off('mp:pose', onPose);
const dPose = poses.length >= 2 ? Math.hypot(poses[poses.length - 1]!.x - poses[0]!.x, poses[poses.length - 1]!.z - poses[0]!.z) : 0;
check('C2 el invitado emite sus poses (el anfitrión las recibe con Δ real)', poses.length >= 8 && dPose > 0.3, `n=${poses.length} Δ=${dPose.toFixed(2)} m`);

// ════════════════ D. El invitado entra en SU casa ════════════════
console.log('· [D] la puerta propia del invitado');
const guestHome = await ev<string>(`window.__vecinosQa.getWorld().residents[${JSON.stringify(guestId)}].home`);
check('D1 el invitado tiene vivienda asignada', !!guestHome, guestHome);
const doorInFront = await ev<string>(`(() => {
  var L = window.__vecinosQa.getLogic();
  L.teleportTo(${JSON.stringify(guestHome)});
  var d = L.doorInFront();
  return d ? d.id : '';
})()`);
check('D2 teleportTo planta al invitado ante SU puerta', doorInFront === guestHome, doorInFront);
await page.waitForTimeout(2800); // v1.64: el servidor aplica la cadena de hops del teleport (≈4 movimientos)
const bInside = await ev<{ inside: string | null; mode: string }>(`(() => {
  var p = window.__vecinosQa.getLogic().position();
  return { inside: p.insideBlock ?? null, mode: p.mode };
})()`);
check('D3 su propia puerta ENTRA (auto-entrada v1.40 — antes: timbre eterno)', bInside.inside === guestHome, `insideBlock=${bInside.inside} modo=${bInside.mode}`);
await page.waitForTimeout(1500);
check('D4 el servidor confirma al invitado DENTRO de su vivienda (round trip)', hostState?.world.residents[guestId]?.location === guestHome, `location=${hostState?.world.residents[guestId]?.location}`);
await ev<void>(`window.__vecinosQa.getController().interact()`); // E dentro = salir (respaldo clásico intacto)
await page.waitForTimeout(500);
const bOut = await ev<string>(`window.__vecinosQa.getLogic().position().mode`);
check('D3b E dentro de su vivienda te deja salir', bOut !== 'inside', `modo=${bOut}`);

// ════════════════ E. Escalera: subir NO devuelve al portal ════════════════
console.log('· [E] escalera vs reconciliación');
await page.waitForTimeout(400);
const tp = await ev<{ floor: number; x: number; mode: string }>(`(() => {
  var L = window.__vecinosQa.getLogic();
  L.teleportTo('blk_p2_escalera');
  var p = L.position();
  return { floor: p.floor, x: +p.x.toFixed(2), mode: p.mode };
})()`);
await page.waitForTimeout(3000); // el servidor aplica la cadena de hops hasta el pozo p2
check('E1 invitado plantado en el pozo de la escalera (planta 2)', tp.floor === 2 && tp.x > 20, `floor=${tp.floor} x=${tp.x}`);
let sawClimbing = false;
const timeline: string[] = [];
const sample = async (tag: string) => {
  const s = await ev<{ f: number; x: number; z: number; m: string; c: boolean; dlg: number }>(`(() => {
    var p = window.__vecinosQa.getLogic().position();
    return { f: p.floor, x: +p.x.toFixed(2), z: +p.z.toFixed(2), m: p.mode, c: !!p.climbing, dlg: document.querySelectorAll('[role="dialog"]').length };
  })()`).catch(() => null);
  if (s) timeline.push(`${tag} floor=${s.f} x=${s.x} z=${s.z} ${s.m} climb=${s.c} dlg=${s.dlg} srv=${hostState?.world.residents[guestId]?.location}`);
  return s;
};
await sample('pre-W');
await ev<void>(`window.__vecinosQa.setTouch({ up: true })`);
for (let i = 0; i < 14 && !sawClimbing; i++) {
  await page.waitForTimeout(400);
  const s = await sample('W');
  sawClimbing = !!s?.c;
}
await ev<void>(`window.__vecinosQa.setTouch({ up: false, down: false, left: false, right: false })`); // soltar TODO (merge, no replace)
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500);
  const s = await sample('post');
  if (s && !s.c) break;
}
await page.waitForTimeout(1200);
await sample('fin');
console.log('· línea temporal E:'); for (const l of timeline) console.log('   ' + l);
const afterClimb = await ev<{ floor: number; x: number; mode: string }>(`(() => {
  var p = window.__vecinosQa.getLogic().position();
  return { floor: p.floor, x: +p.x.toFixed(2), mode: p.mode };
})()`);
check('E2 la escalada arrancó (subida por el cubo real)', sawClimbing || afterClimb.floor > 2, `saw=${sawClimbing}`);
check('E3 tras subir: planta 3 y SIGUE en el pozo (no lo devuelve al portal)', afterClimb.floor === 3 && afterClimb.x > 20 && afterClimb.mode !== 'outside', `floor=${afterClimb.floor} x=${afterClimb.x} modo=${afterClimb.mode}`);
await page.waitForTimeout(2500);
check('E4 el servidor confirma el pozo de la planta 3', hostState?.world.residents[guestId]?.location === 'blk_p3_escalera', `location=${hostState?.world.residents[guestId]?.location}`);

// ════════════════ F. Errores JS ════════════════
if (errors.length > 0) {
  console.log('✗ errores JS en la página:');
  for (const e of errors.slice(0, 6)) console.log('   ' + e.slice(0, 220));
}
check('F1 cero errores JS en la página del invitado', errors.length === 0, `${errors.length}`);

host.disconnect();
await browser.close();
console.log(fails === 0 ? '\nQA v1.64 TODO VERDE' : `\nQA v1.64 con ${fails} fallos`);
process.exit(fails === 0 ? 0 : 1);
