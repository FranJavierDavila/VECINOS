/**
 * QA v1.80 — LUZ DE PLANTA POR PRESENCIA (idea #2) + PROTESTA POR APAGÓN (idea #3),
 * motor real (?qaengine=1, headless chromium):
 *
 * A. Catálogo: rules.sim.protest + ecosystem.lights.corridorInterior + social.protest viven.
 * B. LUCES INTERIORES: noche forzada (minute=0, ventana 23:00→07:30) + un vecino IA en el
 *    pasillo de planta 1 (fixture getWorld) → la lámpara interior p1 sube su emissive y p2
 *    (vacía) no; vaciada la planta, el fundido la devuelve casi a cero (patrón escalera).
 * C. APAGÓN: blackoutUntilTick del cerebro a futuro lejano + lighting=0 → la interior se
 *    apaga AUNQUE la planta siga ocupada (circuito común caído); y el sim, que observa el
 *    param, ARMA la protesta él solo (protestTick en el motor real).
 * D. PROTESTA E2E: world.protest en ringing apuntando al jugador (fixture) + jugador en su
 *    puerta (visitHome) → interactTarget() = answer_protest; sendCommand answer_door →
 *    world.protest null + post-it «Protesta calmada».
 * E. Regresión: 0 errores JS.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:81/?qaengine=1';

let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=512', '--renderer-process-limit=1'],
});
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
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

// Cerrar diálogos que el arranque pueda abrir (bienvenida, teléfono del tutorial…).
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => {
    var dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 'none';
    var btns = dlg.querySelectorAll('button');
    if (btns.length > 0) btns[btns.length - 1].click();
    return 'clicked';
  })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(700);
  const still = await page.evaluate(() => !!document.querySelector('[role="dialog"]')).catch(() => false);
  if (still) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }
}
await page.evaluate(() => {
  (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.();
});
await page.waitForTimeout(6000);

/** Asa de QA (solo lectura + fixtures de test permitidos); siempre INLINE dentro de evaluate. */
type Qa = {
  getContent: () => { rules: { sim: { protest: { watchDef: string; watchParam: string } } }; ecosystem?: { lights: { corridorInterior?: { enabled: boolean } } }; social?: { protest?: { ringLines: unknown[] } } };
  getWorld: () => {
    tick: number;
    playerId: string;
    clock: { minute: number };
    blocks: Record<string, { id: string; layer: string; cell: { floor: number }; params: Record<string, number> }>;
    residents: Record<string, { id: string; present: boolean; home: string; location: string | null; activity: string | null; controller: { type: string }; cooldowns: Record<string, number> }>;
    protest: { startTick: number; protester: string | null; presidentId: string; phase: string; rings: number; lastActionTick: number } | null;
  };
  getScene: () => { getMeshByName: (n: string) => { material: { emissiveColor: { r: number; g: number; b: number } } } | null };
  getEcosystem: () => { state: { blackoutUntilTick: number | null; cooldowns: Record<string, number> }; isBlackout: () => boolean };
  getController: () => Record<string, unknown>;
  getLogic: () => { interactTarget: () => { kind: string } | null };
  getStore: () => { getState: () => { toasts: { text: string }[] } };
};

/** Emissive total (r+g+b) de una lámpara interior por nombre (corridorLight_p{floor}_{i}). */
const lampEmissive = (n: string) =>
  page.evaluate((name) => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const mesh = q.getScene().getMeshByName(name);
    if (!mesh) return -1;
    const c = mesh.material.emissiveColor;
    return c.r + c.g + c.b;
  }, n);

/** Fixture: todos los IA dormidos en casa (plantas vacías, sin paseos nocturnos del QA). */
const pinAllHome = () =>
  page.evaluate(() => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    for (const r of Object.values(w.residents)) {
      if (r.controller.type === 'human') continue;
      r.present = true;
      r.location = r.home;
      r.activity = 'sleep';
      r.cooldowns['hop'] = 99_999;
    }
  });

// ══════════════ A. Catálogo vivo ══════════════
{
  const cat = await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const c = q.getContent();
    return {
      protest: c.rules.sim.protest?.watchDef ?? null,
      interior: c.ecosystem?.lights?.corridorInterior?.enabled ?? false,
      ringLines: c.social?.protest?.ringLines?.length ?? 0,
    };
  });
  check('A1 rules.sim.protest llega vivo (watchDef pasillo_planta)', cat.protest === 'pasillo_planta', `watchDef=${cat.protest}`);
  check('A2 ecosystem.lights.corridorInterior activo', cat.interior === true);
  check('A3 social.protest.ringLines cargadas', cat.ringLines === 4, `líneas=${cat.ringLines}`);
}

// ══════════════ B. Luces interiores por presencia nocturna ══════════════
const MUSICO = 'res_musico_01';
{
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    w.clock.minute = 0; // medianoche: dentro de la ventana nocturna 23:00→07:30
    // Fixture antirrobo de teatro: la medianoche de prueba está DENTRO de la ventana del
    // ev_apagon_nocturno (23:00→05:30) — el cerebro podría disparar el apagón REAL y matar
    // la precondition de las luces. Cooldown eterno para ese evento en este QA (el apagón
    // de la prueba C se siembra a mano con blackoutUntilTick).
    q.getEcosystem().state.cooldowns['ev_apagon_nocturno'] = 1e12;
    q.getEcosystem().state.blackoutUntilTick = null;
  });
  await pinAllHome();
  await page.waitForTimeout(1500); // fundido de cierre: todo a cero con las plantas vacías
  const dark1 = await lampEmissive('corridorLight_p1_0');
  const dark2 = await lampEmissive('corridorLight_p2_0');
  check('B1 con las plantas vacías las interiores están apagadas', dark1 >= 0 && dark1 < 0.05 && dark2 < 0.05, `p1=${dark1.toFixed(3)} p2=${dark2.toFixed(3)}`);

  // Fixture: el músico sale al pasillo de planta 1 (la IA no lo saca con el hop pinned).
  await page.evaluate((who) => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const corridor1 = Object.values(w.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === 1)!.id;
    const r = w.residents[who]!;
    r.present = true;
    r.location = corridor1;
    r.activity = 'laundry';
    r.cooldowns['hop'] = 99_999;
  }, MUSICO);
  let lit1 = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    lit1 = await lampEmissive('corridorLight_p1_0');
    if (lit1 > 0.2) break;
  }
  const lit2 = await lampEmissive('corridorLight_p2_0');
  check('B2 la planta ocupada por la noche se enciende (fundido hacia nightIntensity)', lit1 > 0.2, `p1=${lit1.toFixed(3)}`);
  check('B3 la planta VACÍA sigue a oscuras', lit2 < 0.05, `p2=${lit2.toFixed(3)}`);

  // Vaciar la planta → el fundido devuelve la lámpara casi a cero (fadeSecs·2 del catálogo).
  await page.evaluate(() => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    w.residents['res_musico_01']!.location = null;
  });
  await page.waitForTimeout(2500);
  const decay1 = await lampEmissive('corridorLight_p1_0');
  check('B4 al vacarse la planta la lámpara se funde hacia 0', decay1 < 0.1 && decay1 < lit1 * 0.4, `${lit1.toFixed(3)}→${decay1.toFixed(3)}`);
}

// ══════════════ C. APAGÓN: las interiores nuevas NO encienden ══════════════
{
  // Planta 1 otra vez ocupada (de noche): sin apagón encendería…
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const corridor1 = Object.values(w.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === 1)!.id;
    const r = w.residents['res_musico_01']!;
    r.present = true;
    r.location = corridor1;
    r.activity = 'laundry';
  });
  await page.waitForTimeout(1500);
  const before = await lampEmissive('corridorLight_p1_0');
  check('C1 noche + ocupada vuelve a encender ( precondition del apagón)', before > 0.2, `p1=${before.toFixed(3)}`);

  // APAGÓN: cerebro a futuro lejano + param lighting = 0 (como ev_apagon_nocturno).
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    q.getEcosystem().state.blackoutUntilTick = 1e12;
    const w = q.getWorld();
    for (const b of Object.values(w.blocks)) {
      if (b.layer === 'corridor' && typeof b.params.lighting === 'number') b.params.lighting = 0;
    }
  });
  await page.waitForTimeout(5000); // fundido exponencial de 1.2 → ~0.005 (objetivo 0 seco con apagón)
  const out1 = await lampEmissive('corridorLight_p1_0');
  check('C2 con APAGÓN la interior queda a 0 aunque la planta esté ocupada', out1 < 0.02, `p1=${out1.toFixed(3)}`);

  // El sim OBSERVA el param: la protesta se arma sola en el motor real (idea #3, mitad sim).
  let armed = false;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    armed = await page.evaluate(() => (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld().protest !== null);
    if (armed) break;
  }
  check('C3 el sim arma world.protest al ver lighting bajo umbral', armed);

  // Limpieza: quitar el apagón (y su protesta) para la prueba E2E.
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    q.getEcosystem().state.blackoutUntilTick = null;
    const w = q.getWorld();
    for (const b of Object.values(w.blocks)) {
      if (b.layer === 'corridor' && typeof b.params.lighting === 'number') b.params.lighting = 90;
    }
    w.protest = null;
  });
  await page.waitForTimeout(400);
}

// ══════════════ D. Protesta E2E: timbrazo → prompt → answer_door ══════════════
{
  // Congela el bucle: el fixture de world.protest no lo disuelve protestTick (luz normal).
  await page.evaluate(() => {
    (window as unknown as { __vecinosQa?: { qaHold?: () => void } }).__vecinosQa?.qaHold?.();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const myFloor = w.blocks[w.residents[w.playerId]!.home]!.cell.floor;
    const corridor = Object.values(w.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === myFloor)!.id;
    const r = w.residents['res_musico_01']!;
    r.present = true;
    r.location = corridor; // plantado en mi pasillo, ante mi puerta
    w.protest = { startTick: w.tick, protester: 'res_musico_01', presidentId: w.playerId, phase: 'ringing', rings: 1, lastActionTick: w.tick };
  });
  // El jugador a SU puerta (vía real del editor/QA: teleportTo queda delante de la puerta).
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const home = w.residents[w.playerId]!.home;
    (q.getController() as unknown as { visitHome: (id: string) => void }).visitHome(home);
  });
  await page.waitForTimeout(600);
  const target = await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const t = q.getLogic().interactTarget();
    return t ? t.kind : null;
  });
  check('D1 con la protesta timbrando, la E en TU puerta es answer_protest', target === 'answer_protest', `kind=${target}`);

  // Vía REAL del comando: sendCommand (privado; acceso por corchetes permitido SOLO en QA).
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    (q.getController() as unknown as { sendCommand: (cmd: { type: string }) => void }).sendCommand({ type: 'answer_door' });
  });
  let calmed = false;
  let protestGone = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => {
      const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
      return {
        toast: q.getStore().getState().toasts.some((t) => t.text.includes('Protesta calmada')),
        protest: q.getWorld().protest,
      };
    });
    calmed = st.toast;
    protestGone = st.protest === null;
    if (calmed && protestGone) break;
  }
  check('D2 answer_door disuelve world.protest', protestGone);
  check('D3 post-it «Protesta calmada» en pantalla', calmed);
  // El mundo vuelve a correr para el cierre limpio del navegador.
  await page.evaluate(() => {
    (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.();
  });
}

// ══════════════ E. Regresión ══════════════
{
  const errs = errors.filter((e) => !e.includes('favicon') && !e.includes('the server responded with a status of 500') && !e.includes('Failed to load resource'));
  check('E1 0 errores JS', errs.length === 0, errs.slice(0, 3).join(' | '));
}

console.log(fails === 0 ? '\nTODO VERDE' : `\n${fails} FALLOS`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
