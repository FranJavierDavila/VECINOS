/**
 * QA v1.81 — FASE T FINAL (ideas #4/#5/#6), motor real (?qaengine=1, headless chromium):
 *
 * A. Catálogo: rules.sim.roof/drunk/gamble + social.drunk/gamble viven.
 * B. TEJADO (idea #4): tormenta + roof_damage=1 → los áticos suben humedad con roof_leak
 *    (leakEveryTicks acortado por fixture) y, con el jugador en el pasillo de la planta
 *    alta, la E es repair_roof → el comando descuenta hucha, engorda arcas y seca el
 *    tejado (roof_damage=0). Fail 'poor' cubierto por smoke-nightlife (sim).
 * C. BORRACHO (idea #5): noche + chance=1 + un IA que vuelve de la calle → drunk_started
 *    (bocadillo del catálogo en el DOM) y, con staggerChance=0 para que no divague, llega
 *    a SU puerta, farolea (drunk_fumble) y entra (drunk_home limpia el estado).
 * D. JUEGO ILEGAL (idea #6): ventana nocturna + chancePerNight=1 → gamble_night con
 *    invitados plantados en casa del anfitrión (fondo_buitre); raidChancePerTick=1 →
 *    gamble_raid: multa a la hucha del anfitrión, parte a las arcas, invitados a casa.
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
  getContent: () => {
    archetypes: Record<string, { activities?: Record<string, unknown> }>;
    rules: { sim: Record<string, Record<string, unknown> | undefined> };
    social?: { drunk?: Record<string, unknown[]>; gamble?: Record<string, unknown[]> };
  };
  getWorld: () => {
    tick: number;
    playerId: string;
    clock: { minute: number; day: number };
    weather: { state: string };
    community: { funds: number };
    blocks: Record<string, { id: string; layer: string; defId: string; kind: string; cell: { floor: number }; params: Record<string, number> }>;
    residents: Record<string, { id: string; archetype: string; present: boolean; home: string; location: string | null; activity: string | null; controller: { type: string }; wallet: number; cooldowns: Record<string, number> }>;
  };
  getScene: () => { getMeshByName: (n: string) => unknown };
  getController: () => Record<string, unknown>;
  getLogic: () => { interactTarget: () => { kind: string } | null };
  getEcosystem: () => { state: { blackoutUntilTick: number | null; cooldowns: Record<string, number> }; isBlackout: () => boolean };
  getStore: () => { getState: () => { toasts: { text: string }[]; speed: number; setSpeed: (s: number) => void } };
};

const hold = () => page.evaluate(() => (window as unknown as { __vecinosQa?: { qaHold?: () => void } }).__vecinosQa?.qaHold?.());
const resume = () => page.evaluate(() => (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.());

/** Fixture: todos los IA dormidos en casa (plantas vacías, sin paseos del QA). */
const pinAllHome = () =>
  page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    for (const r of Object.values(w.residents)) {
      if (r.controller.type === 'human') continue;
      r.present = true;
      r.location = r.home;
      r.activity = 'sleep';
      r.cooldowns['hop'] = 99_999;
      r.cooldowns['drunk'] = 0;
      r.cooldowns['drunkDone'] = 0;
      r.cooldowns['drunkTries'] = 0;
    }
  });

/** Texto de los bocadillos vivos (capa DOM data-vecinos=bubbles). */
const bubbleTexts = () =>
  page.evaluate(() => {
    const layer = document.querySelector('[data-vecinos="bubbles"]');
    if (!layer) return [] as string[];
    return [...layer.querySelectorAll('span')].map((s) => s.textContent ?? '');
  });

/** Máxima humedad entre los áticos (viviendas de la planta residencial más alta). */
const atticHumidity = () =>
  page.evaluate(() => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    let top = 0;
    for (const b of Object.values(w.blocks)) if (b.kind === 'dwelling' && b.cell.floor > top) top = b.cell.floor;
    let max = 0;
    for (const b of Object.values(w.blocks)) if (b.kind === 'dwelling' && b.cell.floor === top) max = Math.max(max, b.params.humidity ?? 0);
    return max;
  });

// ══════════════ A. Catálogo vivo ══════════════
{
  const cat = await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const c = q.getContent();
    return {
      roof: (c.rules.sim.roof?.roofDef as string) ?? null,
      drunk: typeof c.rules.sim.drunk?.staggerChance === 'number',
      gamble: (c.rules.sim.gamble?.hostArchetype as string) ?? null,
      drunkLines: c.social?.drunk ? Object.values(c.social.drunk).reduce((a, v) => a + (v as unknown[]).length, 0) : 0,
      gambleLines: c.social?.gamble ? Object.values(c.social.gamble).reduce((a, v) => a + (v as unknown[]).length, 0) : 0,
    };
  });
  check('A1 rules.sim.roof llega vivo (roofDef tejado)', cat.roof === 'tejado', `roofDef=${cat.roof}`);
  check('A2 rules.sim.drunk llega vivo', cat.drunk);
  check('A3 rules.sim.gamble llega vivo (host fondo_buitre)', cat.gamble === 'fondo_buitre', `host=${cat.gamble}`);
  check('A4 social.drunk con líneas del catálogo', cat.drunkLines >= 6, `líneas=${cat.drunkLines}`);
  check('A5 social.gamble con líneas del catálogo', cat.gambleLines >= 4, `líneas=${cat.gambleLines}`);
}

// ══════════════ B. TEJADO: goteo a los áticos + repair_roof ══════════════
{
  // Aceleración + tormenta + daño sembrado + goteo cada 2 ticks (fixture del catálogo vivo).
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    q.getStore().getState().setSpeed(10);
    const w = q.getWorld();
    w.weather.state = 'storm';
    const cfg = q.getContent().rules.sim.roof!;
    cfg.leakEveryTicks = 2;
    cfg.damageChancePerTick = 0; // el daño lo siembra el fixture (determinista)
    const roof = Object.values(w.blocks).find((b) => b.defId === ((cfg.roofDef as string) ?? 'tejado'))!;
    roof.params.roof_damage = 1;
    roof.params.roof_last_leak = w.tick;
  });
  await pinAllHome();
  await resume();
  let leak = await atticHumidity();
  for (let i = 0; i < 30 && leak === 0; i++) {
    await page.waitForTimeout(500);
    leak = await atticHumidity();
  }
  check('B1 con el tejado dañado los áticos acumulan humedad (roof_leak)', leak > 0, `humedad=${leak}`);

  // Reparación E2E: jugador en SU puerta (planta alta), la E es repair_roof.
  await hold();
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
  check('B2 con el tejado dañado y en la planta alta, la E es repair_roof', target === 'repair_roof', `kind=${target}`);

  const funds0 = await page.evaluate(() => (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld().community.funds);
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    (q.getController() as unknown as { sendCommand: (cmd: { type: string }) => void }).sendCommand({ type: 'repair_roof' });
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const roofDef = (q.getContent().rules.sim.roof?.roofDef as string) ?? 'tejado';
    let damage = 0;
    for (const b of Object.values(w.blocks)) if (b.defId === roofDef) damage = Math.max(damage, b.params.roof_damage ?? 0);
    const toast = q.getStore().getState().toasts.some((t) => t.text.includes('Tejado reparado'));
    return { damage, funds: w.community.funds, toast };
  });
  check('B3 repair_roof seca el tejado (roof_damage 0)', after.damage === 0);
  check('B4 el coste pasa de la hucha a las arcas', after.funds === funds0 + 60, `arcas ${funds0}→${after.funds}`);
  check('B5 post-it «Tejado reparado» en pantalla', after.toast);
  await resume();
}

// ══════════════ C. BORRACHO: vuelta errática con faroleo en la puerta ══════════════
{
  // Sujeto de prueba: un IA cuyo arquetipo DUERME de noche (si su deseo nocturno fuera
  // 'out', el borracho se quedaría en el bucle calle↔portal y el faroleo jamás llega).
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    w.clock.minute = 0; // medianoche: dentro de la ventana nocturna
    const cfg = q.getContent().rules.sim.drunk!;
    cfg.chance = 1;
    cfg.staggerChance = 0; // que no divague: el faroleo lo pone la PUERTA (fumble)
    q.getContent().rules.sim.gamble!.chancePerNight = 0; // sin mesas nocturnas: el anfitrión NO secuestra al sujeto (pasa de verdad: con medianoche en ventana, la partida se lo lleva a p3_b)
    q.getEcosystem().state.cooldowns['ev_apagon_nocturno'] = 1e12; // higiene: sin apagón de teatro
    q.getStore().getState().setSpeed(10); // el paseo completo son ~10-20 ticks: a 1 tick/s se comería la ventana
    let subject = 'res_jubilada_01';
    for (const r of Object.values(w.residents)) {
      if (r.controller.type !== 'human' && q.getContent().archetypes[r.archetype]?.activities?.['sleep']) {
        subject = r.id;
        break;
      }
    }
    (window as unknown as { __qaDrunk: string }).__qaDrunk = subject;
  });
  await pinAllHome();
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const r = w.residents[(window as unknown as { __qaDrunk: string }).__qaDrunk]!;
    r.present = true;
    r.location = null; // vuelve de la calle: aquí salta la juerga (drunk roll con chance=1)
    r.activity = 'idle';
    r.cooldowns['hop'] = 0;
    r.cooldowns['drunkDone'] = 0;
    r.cooldowns['drunkTries'] = 0;
  });
  await resume();
  // drunk_started: cooldown activo.
  let started = false;
  for (let i = 0; i < 12 && !started; i++) {
    await page.waitForTimeout(500);
    started = await page.evaluate(() => {
      const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
      const w = q.getWorld();
      const r = w.residents[(window as unknown as { __qaDrunk: string }).__qaDrunk]!;
      return (r.cooldowns['drunk'] ?? 0) > w.tick;
    });
  }
  check('C1 la vuelta nocturna lo pilla borracho (drunk_started)', started);
  let startBubble = false;
  for (let i = 0; i < 8 && !startBubble; i++) {
    await page.waitForTimeout(400);
    const txts = await bubbleTexts();
    startBubble = txts.some((t) => /(?:tambor|zigzag|una y dos|copas|brindis|acorde|escalera|caracol|pareo|debate)/i.test(t));
  }
  check('C2 el bocadillo de borrachera (línea del catálogo) sale en el DOM', startBubble);

  // Camino a casa → faroleo (fumble mueve al vecino) → entrada (drunk_home limpia).
  // El bucle además CIERRA modales que aparezcan (teléfonos de misión): un modal congelaría
  // el mundo y el paseo jamás terminaría.
  let home = false;
  for (let i = 0; i < 90 && !home; i++) {
    await page.waitForTimeout(600);
    await page.evaluate(`(() => { var dlg = document.querySelector('[role="dialog"]'); if (!dlg) return; var b = dlg.querySelectorAll('button'); if (b.length > 0) b[b.length - 1].click(); })()`).catch(() => undefined);
    home = await page.evaluate(() => {
      const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
      const w = q.getWorld();
      const r = w.residents[(window as unknown as { __qaDrunk: string }).__qaDrunk]!;
      return r.location === r.home && (r.cooldowns['drunk'] ?? 0) <= w.tick;
    });
  }
  if (!home) {
    const dbg = await page.evaluate(() => {
      const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
      const w = q.getWorld();
      const r = w.residents[(window as unknown as { __qaDrunk: string }).__qaDrunk]!;
      return { id: r.id, arch: r.archetype, loc: r.location, home: r.home, act: r.activity, drunk: r.cooldowns['drunk'] ?? 0, tries: r.cooldowns['drunkTries'] ?? 0, hops: r.cooldowns['drunkHops'] ?? 0, tick: w.tick, minute: w.clock.minute };
    });
    console.log('   [C3 DEBUG]', JSON.stringify(dbg));
  }
  check('C3 tras los faroleos el borracho entra en SU casa (drunk_home)', home);
}

// ══════════════ D. JUEGO ILEGAL: mesa nocturna + redada ══════════════
{
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const cfg = q.getContent().rules.sim.gamble!;
    cfg.chancePerNight = 1;
    cfg.raidChancePerTick = 0; // primero la mesa, la redada viene después (determinista)
    w.clock.minute = 23 * 60; // 23:00, dentro de 22:00→03:00
    const host = Object.values(w.residents).find((r) => r.archetype === cfg.hostArchetype)!;
    let awaked = 0;
    for (const r of Object.values(w.residents)) {
      if (r.controller.type === 'human' || r.id === host.id) continue;
      if (awaked >= 3) break;
      r.present = true;
      r.activity = 'idle';
      r.location = r.home;
      r.cooldowns['hop'] = 0;
      awaked++;
    }
    host.present = true;
    host.activity = 'idle';
    host.location = host.home;
    host.cooldowns['hop'] = 99_999;
    host.cooldowns['gamble'] = 0;
    host.cooldowns['gambleDay'] = -1;
    host.cooldowns['gambleRaidDay'] = -9999;
  });
  await resume();
  let table = false;
  for (let i = 0; i < 16 && !table; i++) {
    await page.waitForTimeout(500);
    table = await page.evaluate(() => {
      const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
      const w = q.getWorld();
      const host = Object.values(w.residents).find((r) => r.archetype === 'fondo_buitre')!;
      const guests = Object.values(w.residents).filter((r) => r.location === host.home && r.id !== host.id);
      return guests.length > 0 && (host.cooldowns['gamble'] ?? 0) > w.tick;
    });
  }
  check('D1 la mesa se monta: invitados en casa del anfitrión (gamble_night)', table);

  // Hucha ANTES de armar la redada: con raidChance=1 y speed 10 la redada salta en el
  // primer tick — entre este check y el siguiente evaluate ya habría multado (lección del
  // diagnóstico diag-d2: el snapshot posterior medía la hucha POST-redada).
  const raid = await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    const w = q.getWorld();
    const host = Object.values(w.residents).find((r) => r.archetype === 'fondo_buitre')!;
    return { wallet: host.wallet, funds: w.community.funds };
  });

  // REDADA: raidChancePerTick=1 a toda velocidad → multa + invitados a casa.
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    q.getContent().rules.sim.gamble!.raidChancePerTick = 1;
    q.getStore().getState().setSpeed(10);
  });
  let raided = false;
  let allHome = false;
  for (let i = 0; i < 24 && !raided; i++) {
    await page.waitForTimeout(500);
    const now = await page.evaluate(() => {
      const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
      const w = q.getWorld();
      const host = Object.values(w.residents).find((r) => r.archetype === 'fondo_buitre')!;
      const guests = Object.values(w.residents).filter((r) => r.controller.type !== 'human' && r.id !== host.id && r.location !== null);
      return { wallet: host.wallet, home: guests.every((g) => g.location === g.home), party: (host.cooldowns['gamble'] ?? 0) > w.tick };
    });
    raided = now.wallet < raid.wallet && !now.party;
    allHome = now.home;
  }
  check('D2 la redada multa al anfitrión (hucha cae, fiesta fuera)', raided, `hucha ${raid.wallet}→anterior`);
  check('D3 los invitados acaban en sus camas', allHome);
  await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    q.getStore().getState().setSpeed(1);
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
