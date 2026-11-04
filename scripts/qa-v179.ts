/**
 * QA v1.79 — CAPA SOCIAL (motor real, ?qaengine=1): ideas #1 y #7 del backlog FASE T.
 *
 * A. Catálogo: rules.sim.social + social.json llegan vivos al cliente (6 temas).
 * B. COTILLEO EN PASILLOS: chance forzada a 1 (fixture via getContent) y dos vecinos IA
 *    co-localizados en un pasillo → en ≤6 s hay bocadillo de cotilleo (DOM de bubbles)
 *    y el registro del vecindario anota «{a} y {b} cotillean en el pasillo»; la afinidad
 *    mutua de la pareja sube gossipAffinityDelta (leído del mundo, no del DOM).
 * C. CONFIANZA POR CONVERSACIÓN: co-localizado el jugador, chatWith (vía real de la E)
 *    abre el modal de temas ([role=dialog] con 6 botones); al pulsar el primero se manda
 *    el comando `talk`, el modal se cierra y llega el post-it «confía (más|menos)» con la
 *    confianza del vecino movida en el mundo (±trustGain/trustLoss del tema t_clima).
 * D. Regresión: 0 errores JS.
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
  getContent: () => { rules: { sim: { social: { gossipChance: number; gossipAffinityDelta: number } } }; social?: { topics: unknown[] } };
  getWorld: () => {
    playerId: string;
    blocks: Record<string, { id: string; layer: string; cell: { floor: number } }>;
    residents: Record<string, { id: string; present: boolean; location: string | null; activity: string | null; controller: { type: string }; cooldowns: Record<string, number>; relations: { with: string; affinity: number; trust: number }[] }>;
  };
  getController: () => Record<string, unknown>;
  getStore: () => { getState: () => { log: { text: string }[]; toasts: { text: string }[]; talk: unknown } };
};

// ══════════════ A. Catálogo vivo ══════════════
let topics = 0;
{
  const cat = await page.evaluate(() => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    return { sim: !!q.getContent().rules.sim.social, topics: q.getContent().social?.topics.length ?? 0 };
  });
  topics = cat.topics;
  check('A1 rules.sim.social llega vivo en el cliente', cat.sim);
  check('A2 social.json cargado con 6 temas', cat.topics === 6, `topics=${cat.topics}`);
}

// ══════════════ B. Cotilleo en pasillos ══════════════
const PAIR = ['res_musico_01', 'res_presidente_01']; // ambos presentes en el slice
{
  await page.evaluate((pair) => {
    const q = (window as unknown as { __vecinosQa: Qa }).__vecinosQa;
    q.getContent().rules.sim.social.gossipChance = 1; // fixture de test: el cotilleo es seguro
    const w = q.getWorld();
    // Pinares la pareja EN el pasillo (fixture: la IA no los saca) y a nadie más en él.
    for (const r of Object.values(w.residents)) {
      if (r.controller.type === 'human') continue;
      if (pair.includes(r.id)) {
        r.present = true;
        r.location = Object.values(w.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === 1)!.id;
        r.activity = null;
        r.cooldowns['gossip'] = 0;
        r.cooldowns['hop'] = 99_999;
      } else {
        r.location = null;
        r.cooldowns['hop'] = 99_999;
      }
    }
    (window as unknown as { __qaCorridor?: string }).__qaCorridor = Object.values(w.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === 1)!.id;
  }, PAIR);
  const before = await page.evaluate((pair) => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    return {
      ab: w.residents[pair[0]]!.relations.find((x) => x.with === pair[1])?.affinity ?? 0,
      ba: w.residents[pair[1]]!.relations.find((x) => x.with === pair[0])?.affinity ?? 0,
    };
  }, PAIR);
  // El mundo corre a 1 tick/segundo: en ≤6 s reales debe caer el cotilleo.
  let logHit = false;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500);
    logHit = await page.evaluate(() => (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getStore().getState().log.some((l) => l.text.includes('cotillean en el pasillo')));
    if (logHit) break;
  }
  check('B1 el registro anota el cotilleo (ev.gossip)', logHit);
  const bubbles = await page.evaluate(() => document.querySelector('[data-vecinos="bubbles"]')?.children.length ?? 0);
  check('B2 bocadillo en el DOM de bubbles', bubbles >= 1, `nodos=${bubbles}`);
  const after = await page.evaluate((pair) => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    const delta = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getContent().rules.sim.social.gossipAffinityDelta;
    return {
      ab: w.residents[pair[0]]!.relations.find((x) => x.with === pair[1])?.affinity ?? 0,
      ba: w.residents[pair[1]]!.relations.find((x) => x.with === pair[0])?.affinity ?? 0,
      delta,
    };
  }, PAIR);
  check('B3 afinidad +gossipAffinityDelta en ambos sentidos', after.ab - before.ab === after.delta && after.ba - before.ba === after.delta, `${before.ab}→${after.ab} / ${before.ba}→${after.ba} (Δ=${after.delta})`);
}

// ══════════════ C. Confianza por conversación (talk) ══════════════
{
  // Congela el bucle (qaHold): sin frame ni reconcile, el fixture de location del jugador
  // en el sim NO lo sobreescribe la sincronización de posición visual (portal→pasillo).
  await page.evaluate(() => {
    (window as unknown as { __vecinosQa?: { qaHold?: () => void } }).__vecinosQa?.qaHold?.();
  });
  await page.waitForTimeout(400);
  // Co-localiza al jugador con la pareja del pasillo (fixture: location del sim directo).
  await page.evaluate(() => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    w.residents[w.playerId]!.location = (window as unknown as { __qaCorridor?: string }).__qaCorridor ?? '';
    w.residents[w.playerId]!.cooldowns['talk:res_musico_01'] = 0;
  });
  const trustBefore = await page.evaluate((who) => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    return w.residents[who]!.relations.find((x) => x.with === w.playerId)?.trust ?? 0;
  }, PAIR[0]);
  // Vía REAL de la E (chatWith es privado: acceso por corchetes, permitido solo en QA).
  await page.evaluate((who) => {
    const c = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getController() as unknown as { chatWith: (id: string) => void };
    c.chatWith(who);
  }, PAIR[0]);
  await page.waitForTimeout(600);
  const modal = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return { open: !!dlg, groupBtns: dlg ? dlg.querySelectorAll('[role="group"] button').length : 0 };
  });
  check('C1 chatWith abre el modal de temas', modal.open && modal.groupBtns > 0, `botones=${modal.groupBtns}`);
  check('C2 el picker ofrece los 6 temas del catálogo', modal.groupBtns === topics);
  // Pulsa el PRIMER tema (t_clima) → talkChoose manda el comando al sim.
  await page.evaluate(() => {
    const btn = document.querySelector('[role="dialog"] [role="group"] button') as HTMLButtonElement | null;
    btn?.click();
  });
  let toastHit = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    toastHit = await page.evaluate(() => (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getStore().getState().toasts.some((t) => t.text.includes('confía')));
    if (toastHit) break;
  }
  check('C3 post-it «confía (más|menos)» tras la charla', toastHit);
  const afterTalk = await page.evaluate((who) => {
    const w = (window as unknown as { __vecinosQa: Qa }).__vecinosQa.getWorld();
    return {
      modalGone: !document.querySelector('[role="dialog"]'),
      trust: w.residents[who]!.relations.find((x) => x.with === w.playerId)?.trust ?? null,
    };
  }, PAIR[0]);
  check('C4 el modal se cierra al elegir tema', afterTalk.modalGone);
  const moved = afterTalk.trust !== null && (afterTalk.trust === trustBefore + 3 || afterTalk.trust === trustBefore - 2); // t_clima: +3/−2
  check('C5 la confianza del vecino se movió según el tema', moved, `trust ${trustBefore}→${afterTalk.trust}`);
  // El mundo vuelve a correr para el cierre limpio del navegador.
  await page.evaluate(() => {
    (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.();
  });
}

// ══════════════ D. Regresión ══════════════
{
  const errs = errors.filter((e) => !e.includes('favicon') && !e.includes('the server responded with a status of 500') && !e.includes('Failed to load resource'));
  check('D1 0 errores JS', errs.length === 0, errs.slice(0, 3).join(' | '));
}

console.log(fails === 0 ? '\nTODO VERDE' : `\n${fails} FALLOS`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
