/**
 * QA v1.2 — credibilidad 2.5D: rotación de actores + estados sociales.
 * Comprueba, sin abrir navegador:
 *   1. Todos los modelos de actor del catálogo traen los clips sociales
 *      (run/talk/laugh/argue/phone/sit) además de idle/walk.
 *   2. La zancada (walk) rota las piernas sobre el eje Z (perfil creíble), no sobre X.
 *   3. El manifiesto assets.json expone stateAnimations con los seis estados por actor.
 *   4. rules.view declara actorTurnSpeed/runSpeed/runMultiplier/seatAnchors.
 *   5. El contenido usa el nuevo canal de cutscenes: beats line con who+gesture resuelven
 *      a refs válidas ($event.resident / $role.<rol> / id de residente del escenario base).
 * Ejecutar: bun scripts/qa-25d.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let fails = 0;
let total = 0;
const check = (name: string, ok: boolean, detail = ''): boolean => {
  total += 1;
  if (!ok) fails += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
};

const ROOT = resolve(process.cwd(), 'public');
const assets = JSON.parse(readFileSync(resolve(ROOT, 'content/assets.json'), 'utf8')) as {
  actors: Record<string, { model: string; stateAnimations?: Record<string, string> }>;
};
const rules = JSON.parse(readFileSync(resolve(ROOT, 'content/rules.json'), 'utf8')) as {
  view: { actorTurnSpeed?: number; runSpeed?: number; runMultiplier?: number; seatAnchors?: string[] };
};
const cutscenes = JSON.parse(readFileSync(resolve(ROOT, 'content/cutscenes.json'), 'utf8')) as {
  id: string;
  beats: { type: string; who?: string; gesture?: string }[];
}[];
const scenarios = JSON.parse(readFileSync(resolve(ROOT, 'content/scenarios.json'), 'utf8')) as {
  residents: { archetype: string; id: string }[];
}[];
const rolesResolvable = new Set<string>(); // $role se resuelve en runtime: solo comprobamos sintaxis

const STATES = ['run', 'talk', 'laugh', 'argue', 'phone', 'sit'];

// ── 1 + 2: cada modelo de actor trae los clips sociales y una zancada sobre Z ──
const nodesOf = (g: { nodes: { name?: string }[] }): (string | undefined)[] => g.nodes.map((n) => n.name);
for (const [arch, def] of Object.entries(assets.actors)) {
  const g = JSON.parse(readFileSync(resolve(ROOT, 'assets', def.model), 'utf8')) as {
    animations: { name?: string; channels: { target: { node: number; path: string }; sampler: number }[]; samplers: { output: number }[] }[];
    nodes: { name?: string }[];
    buffers: { uri: string }[];
    bufferViews: { byteOffset: number; byteLength: number }[];
    accessors: { bufferView: number; type: string }[];
  };
  const names = new Set(g.animations.map((a) => a.name));
  check(`${arch}: clips base idle+walk`, names.has('idle') && names.has('walk'));
  const missing = STATES.filter((s) => !names.has(s));
  check(`${arch}: clips sociales (run/talk/laugh/argue/phone/sit)`, missing.length === 0, `faltan: ${missing.join(',')}`);

  // walk: canal de rotación de legL — los cuaterniones deben ser de eje Z (x≈0, y≈0)
  const nodeNames = nodesOf(g);
  const walk = g.animations.find((a) => a.name === 'walk');
  const legCh = walk?.channels.find((c) => (nodeNames[c.target.node] ?? '').startsWith('legL') && c.target.path === 'rotation');
  const hasLegCh = check(`${arch}: walk tiene rotación de legL`, !!legCh);
  if (hasLegCh && legCh) {
    const acc = g.accessors[walk!.samplers[legCh.sampler].output]!;
    const bv = g.bufferViews[acc.bufferView]!;
    const b64 = g.buffers[0]!.uri.split(',')[1]!;
    const raw = Buffer.from(b64, 'base64').subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
    // tomar el cuaternión con |w| mínimo (máximo ángulo): ahí se ve el eje
    let best = [0, 0, 0, 1];
    let bestW = 2;
    for (let off = 0; off + 16 <= raw.length; off += 16) {
      const q = [raw.readFloatLE(off), raw.readFloatLE(off + 4), raw.readFloatLE(off + 8), raw.readFloatLE(off + 12)];
      if (Math.abs(q[3]!) < bestW) {
        bestW = Math.abs(q[3]!);
        best = q;
      }
    }
    check(`${arch}: zancada sobre eje Z (perfil)`, Math.abs(best[0]!) < 0.01 && Math.abs(best[1]!) < 0.01 && Math.abs(best[2]!) > 0.01, `quat=(${best.map((x) => x.toFixed(3)).join(',')})`);
  }
}

// ── 3: stateAnimations declarado por actor ──
for (const [arch, def] of Object.entries(assets.actors)) {
  const sa = def.stateAnimations ?? {};
  const missing = STATES.filter((s) => !sa[s]);
  check(`${arch}: stateAnimations con los 6 estados`, missing.length === 0, `faltan: ${missing.join(',')}`);
}

// ── 4: rules.view del 2.5D ──
const v = rules.view;
check('rules.view.actorTurnSpeed > 0', (v.actorTurnSpeed ?? 0) > 0);
check('rules.view.runSpeed > walk (correr es más rápido que andar)', (v.runSpeed ?? 0) > 3);
check('rules.view.runMultiplier ≥ 1.2', (v.runMultiplier ?? 0) >= 1.2);
check('rules.view.seatAnchors incluye bed/tv/desk', ['bed', 'tv', 'desk'].every((a) => (v.seatAnchors ?? []).includes(a)));

// ── 5: beats line con who+gesture bien formados ──
const residentIds = new Set<string>();
const archetypes = new Set<string>();
for (const s of scenarios) for (const r of s.residents) {
  residentIds.add(r.id);
  archetypes.add(r.archetype);
}
// El jugador también es residente (v1.18: cutscenes con línea del protagonista).
for (const s of scenarios) if (s.player?.residentId) residentIds.add(s.player.residentId);
let lineGestures = 0;
for (const c of cutscenes) {
  for (const b of c.beats) {
    if (b.type !== 'line' || !b.who) continue;
    lineGestures += 1;
    const okRef = b.who === '$event.resident' || b.who.startsWith('$role.') || residentIds.has(b.who);
    check(`${c.id}: who "${b.who}" es ref válida`, okRef);
    check(`${c.id}: gesture "${b.gesture}" es un estado social`, !!b.gesture && STATES.includes(b.gesture));
  }
}
check('hay al menos 5 líneas de cutscene con gesto', lineGestures >= 5, `solo ${lineGestures}`);
void rolesResolvable;

console.log(fails === 0 ? `\nQA 2.5D OK (${total} checks)` : `\nQA 2.5D FALLÓ: ${fails}/${total} checks`);
process.exit(fails === 0 ? 0 : 1);
