import type { BlockDef, TemplateDef } from './schemas';

export interface ExpandedBlock {
  id: string;
  defId: string;
  cell: { col: number; floor: number };
  size: { w: number; h: number };
  layer: 'main' | 'corridor';
}

/** Expande las filas de la plantilla en bloques con id `blk_p{planta}_{tag}`. */
export function expandTemplate(template: TemplateDef, blocks: Record<string, BlockDef>): ExpandedBlock[] {
  const out: ExpandedBlock[] = [];
  for (const row of template.rows) {
    for (let floor = row.floors[0]; floor <= row.floors[1]; floor++) {
      for (const b of row.blocks) {
        const def = blocks[b.defId];
        if (!def) continue; // el validador informa de defId desconocidos
        out.push({ id: `blk_p${floor}_${b.tag}`, defId: b.defId, cell: { col: b.col, floor }, size: def.size, layer: def.layer });
      }
    }
  }
  return out;
}
