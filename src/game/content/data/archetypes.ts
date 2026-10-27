import type { ArchetypeDef } from '@/game/core/types';

/**
 * Arquetipos de residente. Las actividades emiten influencias; `say` son las frases
 * que sueltan cuando llamas a su puerta. El humor vive aquí (y en los diálogos).
 */
export const ARCHETYPE_DEFS: ArchetypeDef[] = [
  {
    id: 'jugador_base',
    name: 'El recién llegado',
    tagline: 'Viniste por el precio. Te quedas por el drama.',
    traits: { sociability: 0.5, tidiness: 0.5, noisiness: 0.3 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: {},
      sleep: {},
      work: { at: 'home', say: ['Reuniones... desde el salón.', 'Si me buscan en la oficina, estoy en la nevera.'] },
    },
    view: { color: '#ff7043', accent: '#ffd166', hat: 'cap', prop: 'phone', height: 1.3 },
  },
  {
    id: 'cotilla',
    name: 'Dolores, la Cotilla',
    tagline: 'Lo sabe todo. Y lo cuenta.',
    traits: { gossip: 0.9, sociability: 0.8, tidiness: 0.5, noisiness: 0.2, generosity: 0.4 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home' },
      sleep: { at: 'home' },
      watch_corridor: { at: 'corridor', say: ['Yo lo vi todo desde la ventana. TODO.', '¿Que si tengo azúcar? Tengo historias.'], emits: {} },
      tv_loud: { at: 'home', emits: { noise: 0.5 }, say: ['¡Está en el minuto clave del concurso!'] },
    },
    view: { color: '#e255a0', accent: '#ffca3a', hat: 'bun', prop: 'binoculars', height: 1.28 },
  },
  {
    id: 'fiestero',
    name: 'Kevin, el Fiestero',
    tagline: 'Siempre hay un motivo para celebrar.',
    traits: { sociability: 0.9, tidiness: 0.2, noisiness: 0.95, generosity: 0.6 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home' },
      sleep: { at: 'home' },
      out: { at: 'out', say: ['Estoy en el gimnasio. O en el bar. Uno de los dos.'] },
      party: { at: 'home', emits: { noise: 0.9 }, say: ['¡Pásate! Hay ice-cream en la nevera y confeti en el suelo.', '¿Esto es ruido? Esto es CULTURA.'] },
    },
    view: { color: '#2ec4b6', accent: '#ff9f1c', hat: 'sunglasses', prop: 'none', height: 1.34 },
  },
  {
    id: 'jubilada',
    name: 'Esperanza, la Jubilada',
    tagline: 'Ruta silla y paciencia.',
    traits: { gossip: 0.6, sociability: 0.7, tidiness: 0.9, noisiness: 0.1, generosity: 0.8 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home', say: ['A ver si arreglan ya la lavadora que tiro de balcón.', 'Yo a tu edad ya tenía tres pisos... de crisis.'] },
      sleep: { at: 'home' },
      chair: { at: 'corridor', say: ['Buenos días. Llevo aquí desde los buenos días anteriores.'] },
      laundry: { at: 'home', emits: { water: 0.55 }, say: ['La lavadora hace un ruido raro, pero hace su vida.'] },
    },
    view: { color: '#7fa65a', accent: '#f2cc8f', hat: 'bun', prop: 'cart', height: 1.2 },
  },
  {
    id: 'presidente',
    name: 'Don Ramón, el Presidente',
    tagline: 'La comunidad es su vida. Literalmente.',
    traits: { gossip: 0.5, sociability: 0.6, tidiness: 0.8, noisiness: 0.2, generosity: 0.3 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home', say: ['¿Firmas la convocatoria? Es la número 47 del año.', 'Recuerde: la junta es sagrada. Y eterna.'] },
      sleep: { at: 'home' },
      stroll: { at: 'corridor', say: ['Inspecciono el pasillo. Hay una mancha en el 1A. Hay SIEMPRE una mancha.'] },
    },
    view: { color: '#4a4a55', accent: '#e63946', hat: 'none', prop: 'briefcase', height: 1.32 },
  },
  {
    id: 'estudiante',
    name: 'Laia, la Estudiante',
    tagline: 'Suena, estudia (y hace ruido).',
    traits: { gossip: 0.4, sociability: 0.6, tidiness: 0.4, noisiness: 0.6, generosity: 0.5 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home' },
      sleep: { at: 'home', say: ['Zzz... el examen es a las 8... zzz...'] },
      out: { at: 'out', say: ['En clase. Digo yo. Mejor no preguntes.'] },
      study_music: { at: 'home', emits: { noise: 0.45 }, say: ['Estudio con música. Mozart, pero en versión techno.'] },
    },
    view: { color: '#8e6fd8', accent: '#ffca3a', hat: 'headphones', prop: 'phone', height: 1.26 },
  },
  {
    id: 'nino_grafitero',
    name: 'Pinturillas, el Niño',
    tagline: 'El ascensor es su lienzo. Su madre, su coartada.',
    traits: { mischief: 0.9, sociability: 0.6, noisiness: 0.5 },
    needs: ['fun', 'social'],
    activities: {
      idle: { at: 'home', say: ['Yo no he sido. Pero quedó bonito.', '¿Has visto mi obra en la cabina? Arte urbano.'] },
      sleep: { at: 'home' },
      roam: { at: 'core', say: ['La escalera es mi circuito de karts. En modo andando.'] },
      paint_cabin: { at: 'core', say: ['Esto no es una pintada. Es un mural.'] },
    },
    view: { color: '#f2a93b', accent: '#06d6a0', hat: 'cap', prop: 'spray', height: 0.85 },
  },
  {
    id: 'fondo_buitre',
    name: 'Sr. Vulture, del Fondo Buitre',
    tagline: 'Compra, reforma, revende. Sonríe.',
    traits: { gossip: 0.1, sociability: 0.5, tidiness: 1.0, noisiness: 0.1, generosity: 0.05 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home', say: ['Este edificio tiene mucho potencial. El suyo.', '¿Reforma integral? Tengo precios. Y un ábaco.'] },
      sleep: { at: 'home' },
      stroll: { at: 'corridor', say: ['Medo el pasillo. Para una próxima reforma. La suya, claro.'] },
    },
    view: { color: '#232323', accent: '#ffd60a', hat: 'sunglasses', prop: 'briefcase', height: 1.36 },
  },
  {
    id: 'inquilino',
    name: 'Mateo, el Erasmus',
    tagline: 'Alquila, pregunta, imprime.',
    traits: { gossip: 0.3, sociability: 0.9, tidiness: 0.3, noisiness: 0.4, generosity: 0.5 },
    needs: ['sleep', 'social', 'fun', 'money'],
    activities: {
      idle: { at: 'home', say: ['Hola! ¿Cómo se dice "derrama" en mi idioma? Ah, igual.', '¿El wifi llega al baño? Pregunta importante.'] },
      sleep: { at: 'home' },
    },
    view: { color: '#46b5c9', accent: '#ff70a6', hat: 'cap', prop: 'phone', height: 1.28 },
  },
];
