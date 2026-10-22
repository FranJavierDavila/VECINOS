import type { Content, Issue } from './content';
import { expandTemplate, type ExpandedBlock } from './template';
import type { Effect } from './schemas';

/** Comprobaciones entre archivos: referencias por id, geometría de la plantilla y coherencia del escenario. */
export function validateContent(c: Content): Issue[] {
  const issues: Issue[] = [];
  const err = (file: string, path: string, message: string) => issues.push({ severity: 'error', file, path, message });

  const paramNames = new Set<string>();
  for (const b of Object.values(c.blocks)) Object.keys(b.params).forEach((p) => paramNames.add(p));
  const paramExists = (p: string) => paramNames.has(p);

  // Bloques → distribuciones → estancias
  for (const b of Object.values(c.blocks)) {
    if (b.container && !c.layouts[b.container.layout]) err(`blocks/${b.id}`, 'container.layout', `distribución desconocida "${b.container.layout}"`);
    if (b.kind === 'dwelling' && !b.container) err(`blocks/${b.id}`, 'container', 'una vivienda debe declarar un contenedor de estancias');
  }
  for (const l of Object.values(c.layouts))
    l.rooms.forEach((r, i) => !c.rooms[r.defId] && err(`layouts/${l.id}`, `rooms.${i}.defId`, `estancia desconocida "${r.defId}"`));

  // Influencias
  for (const r of Object.values(c.influences)) {
    if (r.attenuatedBy && !paramExists(r.attenuatedBy)) err(`influences/${r.id}`, 'attenuatedBy', `ningún bloque define el parámetro "${r.attenuatedBy}"`);
    const sp = r.onThreshold?.setParam?.param;
    if (sp && !paramExists(sp)) err(`influences/${r.id}`, 'onThreshold.setParam.param', `ningún bloque define el parámetro "${sp}"`);
  }

  // Plantillas: referencias, límites y solapes por capa
  const expanded: Record<string, ExpandedBlock[]> = {};
  for (const t of Object.values(c.templates)) {
    for (const row of t.rows) for (const b of row.blocks) if (!c.blocks[b.defId]) err(`templates/${t.id}`, 'rows', `defId desconocido "${b.defId}"`);
    const blocks = expandTemplate(t, c.blocks);
    expanded[t.id] = blocks;
    const occupied = new Map<string, string>();
    const ids = new Set<string>();
    for (const b of blocks) {
      if (ids.has(b.id)) err(`templates/${t.id}`, b.id, 'id de bloque duplicado (revisa los tag)');
      ids.add(b.id);
      if (b.cell.col + b.size.w > t.grid.cols || b.cell.floor + b.size.h > t.grid.floors) err(`templates/${t.id}`, b.id, 'el bloque se sale de la cuadrícula');
      for (let dc = 0; dc < b.size.w; dc++)
        for (let df = 0; df < b.size.h; df++) {
          const key = `${b.layer}:${b.cell.col + dc}:${b.cell.floor + df}`;
          const prev = occupied.get(key);
          if (prev) err(`templates/${t.id}`, b.id, `solapa con ${prev} en la capa ${b.layer}`);
          else occupied.set(key, b.id);
        }
    }
  }

  // Misiones: diálogos referenciados
  for (const m of Object.values(c.missions))
    m.steps.forEach((st) => st.type === 'phone_call' && !c.dialogs[st.dialog] && err(`missions/${m.id}`, `steps.${st.id}.dialog`, `diálogo desconocido "${st.dialog}"`));

  // Escenarios
  for (const s of Object.values(c.scenarios)) {
    const f = `scenarios/${s.id}`;
    const tpl = c.templates[s.building.template];
    if (!tpl) {
      err(f, 'building.template', `plantilla desconocida "${s.building.template}"`);
      continue;
    }
    const blocks = expanded[tpl.id] ?? [];
    const blockIds = new Set(blocks.map((b) => b.id));
    const dwellings = new Set(blocks.filter((b) => c.blocks[b.defId]?.kind === 'dwelling').map((b) => b.id));
    for (const [defId, st] of Object.entries(s.building.stateByDef)) {
      if (!c.blocks[defId]) err(f, `building.stateByDef.${defId}`, 'defId desconocido');
      else for (const p of Object.keys(st.params)) if (!c.blocks[defId].params[p]) err(f, `building.stateByDef.${defId}.params.${p}`, 'parámetro no definido en el bloque');
    }
    if (!blockIds.has(s.player.startBlock)) err(f, 'player.startBlock', `bloque desconocido "${s.player.startBlock}"`);
    if (!c.archetypes[s.player.archetype]) err(f, 'player.archetype', `arquetipo desconocido "${s.player.archetype}"`);
    const reserved = new Set(s.residents.map((r) => r.home));
    s.player.homeCandidates.forEach((id, i) => {
      if (!dwellings.has(id)) err(f, `player.homeCandidates.${i}`, `"${id}" no es una vivienda de la plantilla`);
      if (reserved.has(id)) err(f, `player.homeCandidates.${i}`, `"${id}" está reservada para un vecino`);
    });
    const allResidents = new Set(s.residents.map((r) => r.id));
    s.residents.forEach((r, i) => {
      r.parentOf.forEach((k, j) => !allResidents.has(k) && err(f, `residents.${i}.parentOf.${j}`, `residente desconocido "${k}"`));
      if (!c.archetypes[r.archetype]) err(f, `residents.${i}.archetype`, `arquetipo desconocido "${r.archetype}"`);
      if (!dwellings.has(r.home)) err(f, `residents.${i}.home`, `"${r.home}" no es una vivienda de la plantilla`);
    });
    s.startMissions.forEach((m, i) => !c.missions[m] && err(f, `startMissions.${i}`, `misión desconocida "${m}"`));

    // Misiones vistas desde este escenario
    const residentIds = new Set([s.player.residentId, ...s.residents.map((r) => r.id)]);
    const refs = new Set<string>([...blockIds, ...blocks.map((b) => b.defId)]);
    for (const b of blocks) if (c.blocks[b.defId]?.alignGroup) refs.add(c.blocks[b.defId]!.alignGroup!);
    for (const m of Object.values(c.missions)) {
      const mf = `missions/${m.id}`;
      const roles = new Set(Object.keys(m.roles ?? {}));
      const actors = new Set<string>(['player', ...residentIds, ...roles]);
      const effects: Effect[] = [...(m.onComplete ?? []), ...(m.choices ?? []).flatMap((x) => x.effects)];
      for (const e of effects) checkEffect(e, mf);
      function checkEffect(e: Effect, file: string) {
        switch (e.op) {
          case 'setParam': {
            const [ref, p] = e.param ? [e.target, e.param] : (e.target.split('.') as [string, string | undefined]);
            if (!refs.has(ref)) err(file, 'setParam.target', `referencia desconocida "${ref}"`);
            else if (!p || !paramExists(p)) err(file, 'setParam.target', `parámetro desconocido "${p}"`);
            break;
          }
          case 'unlock':
            if (!blockIds.has(e.target)) err(file, 'unlock.target', `bloque desconocido "${e.target}"`);
            if (e.resident && !residentIds.has(e.resident)) err(file, 'unlock.resident', `residente desconocido "${e.resident}"`);
            break;
          case 'addRelation':
            for (const k of [e.a, e.b]) if (!actors.has(k)) err(file, 'addRelation', `actor desconocido "${k}"`);
            break;
          case 'grantFavor':
            if (!actors.has(e.from)) err(file, 'grantFavor.from', `actor desconocido "${e.from}"`);
            break;
          case 'startMission':
            if (!c.missions[e.id]) err(file, 'startMission.id', `misión desconocida "${e.id}"`);
            break;
          case 'revealParams':
          case 'hideParams':
            for (const p of e.params ?? []) if (!paramExists(p)) err(file, `${e.op}.params`, `parámetro desconocido "${p}"`);
            break;
          default:
            break;
        }
      }
      for (const [name, r] of Object.entries(m.roles ?? {})) {
        if (r.archetype && !c.archetypes[r.archetype]) err(mf, `roles.${name}.archetype`, `arquetipo desconocido "${r.archetype}"`);
        if (r.of && !roles.has(r.of)) err(mf, `roles.${name}.of`, `rol desconocido "${r.of}"`);
      }
      const trig = m.trigger ? ('all' in m.trigger ? m.trigger.all : m.trigger.any) : [];
      for (const cnd of trig) {
        if ('mission' in cnd && !c.missions[cnd.mission]) err(mf, 'trigger', `misión desconocida "${cnd.mission}"`);
        if ('role' in cnd && !roles.has(cnd.role)) err(mf, 'trigger', `rol desconocido "${cnd.role}"`);
      }
    }
  }
  return issues;
}
