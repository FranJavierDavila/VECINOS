import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

/**
 * POST /api/artref-save — guarda los PNG de referencia de arte (?artref=1) como archivos
 * estáticos bajo public/art/preview/ para que se puedan descargar por URL directa.
 * Herramienta de QA/dev (data-driven: escribe solo en esa carpeta, nombres saneados).
 * Body: { name: string, dataUrl: string } — dataUrl 'data:image/png;base64,...'.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { name?: string; dataUrl?: string };
    const name = (body.name ?? '').replace(/[^a-z0-9_-]+/gi, '_');
    const dataUrl = body.dataUrl ?? '';
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!name || !m) {
      return NextResponse.json({ ok: false, error: 'name/dataUrl inválidos' }, { status: 400 });
    }
    if (m[1].length > 14_000_000) {
      return NextResponse.json({ ok: false, error: 'PNG demasiado grande' }, { status: 413 });
    }
    const dir = join(process.cwd(), 'public', 'art', 'preview');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${basename(name)}.png`);
    await writeFile(file, Buffer.from(m[1], 'base64'));
    return NextResponse.json({ ok: true, path: `/art/preview/${basename(name)}.png`, bytes: m[1].length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
