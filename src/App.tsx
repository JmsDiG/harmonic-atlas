import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

type Vec3 = [number, number, number];
type Proj = { x: number; y: number; z: number };
type TonnetzTri = { id: string; kind: 'up' | 'down'; points: { x: number; y: number }[]; notes: string[] };
type DemoEvent = { notes: string[]; ms: number; harmony: string[]; label?: string };
type Demo = { id: string; composer: string; title: string; subtitle: string; audioUrl: string; sourceLabel: string; events: DemoEvent[] };
type MatchItem = { face: number | null; tonnetzId: string | null; harmony: string[] };
type SectionProps = { title: string; subtitle?: string; children: React.ReactNode };
type MetricProps = { title: string; top: string; bottom: string };
type ScoreNote = { midi: number; name: string; time: number; duration: number; velocity: number; track: number };
type MidiPilot = { fileName: string; bpm: number | null; duration: number; noteCount: number; notes: ScoreNote[]; events: DemoEvent[]; eventTimes: number[] };

const TITLE = 'Harmonic Atlas';
const SUBTITLE = 'Icosahedron and Tonnetz Audio Edition';
const ICONS = { intro: '🎼', ico: '🔺', tonnetz: '🕸️', path: '🧭', audio: '🎹', compare: '🧠', map: '🗺️', midi: '📁', exact: '🎯' };

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
const PHI = 1.618033988749895;
const SQRT3 = Math.sqrt(3);
const DEFAULT_ROT_X = -0.22;
const DEFAULT_ROT_Y = 0.84;
const FIXED_ZOOM = 2.1;
const DEFAULT_PATH = [0, 8, 9, 10, 16, 17, 4, 6, 5, 15, 19, 18, 12, 11, 7, 1, 3, 2, 14, 13];
const SYMMETRY: Record<number, number> = { 0: 0, 1: 7, 2: 1, 3: 11, 4: 5, 5: 3, 6: 2, 7: 8, 8: 6, 9: 9, 10: 4, 11: 10 };
const RACH_ID = 'rachmaninoff';

const RAW_VERTICES: Vec3[] = ([
  [0, -1, -PHI], [-1, -PHI, 0], [-PHI, 0, -1], [0, -1, PHI],
  [-1, PHI, 0], [-PHI, 0, 1], [0, 1, PHI], [1, PHI, 0],
  [PHI, 0, 1], [0, 1, -PHI], [1, -PHI, 0], [PHI, 0, -1],
] as Vec3[]).map(normalize);

const FACES: number[][] = [
  [0, 1, 2], [2, 4, 6], [0, 6, 8], [0, 2, 6], [1, 3, 7],
  [0, 7, 8], [0, 1, 7], [2, 4, 5], [1, 2, 5], [1, 3, 5],
  [3, 5, 9], [4, 5, 9], [4, 9, 10], [4, 6, 10], [6, 8, 10],
  [7, 8, 11], [3, 9, 11], [3, 7, 11], [9, 10, 11], [8, 10, 11],
];

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
function mod12(n: number): number { return ((n % 12) + 12) % 12; }
function pitchClass(note: string): string { const m = note.match(/^([A-G]#?)/); return m ? m[1] : note; }
function pcFromMidi(midi: number): string { return NOTES[mod12(midi)]; }
function withOct(note: string, oct: number): string { return `${note}${oct}`; }
function latticePitch(i: number, j: number): string { return NOTES[mod12(7 * i + 3 * j)]; }

function rotatePoint(v: Vec3, rx: number, ry: number): Vec3 {
  const [x, y, z] = v;
  const cosy = Math.cos(ry);
  const siny = Math.sin(ry);
  const x1 = x * cosy + z * siny;
  const z1 = -x * siny + z * cosy;
  const cosx = Math.cos(rx);
  const sinx = Math.sin(rx);
  const y2 = y * cosx - z1 * sinx;
  const z2 = y * sinx + z1 * cosx;
  return [x1, y2, z2];
}
function projectPoint(v: Vec3, rx: number, ry: number, zoom: number): Proj {
  const [x, y, z] = rotatePoint(v, rx, ry);
  const perspective = 305 / (3.3 - z);
  const s = perspective * zoom;
  return { x: x * s, y: y * s, z };
}
function faceCentroid(faceIndex: number, projected: Proj[]): Proj {
  const pts = FACES[faceIndex].map((i) => projected[i]);
  return { x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3, z: (pts[0].z + pts[1].z + pts[2].z) / 3 };
}
function chordForFace(faceIndex: number, noteMap: string[]): string[] { return FACES[faceIndex].map((v) => noteMap[v]); }
function mutate(noteMap: string[]): string[] { const out = Array(noteMap.length).fill(''); Object.entries(SYMMETRY).forEach(([from, to]) => { out[Number(to)] = noteMap[Number(from)]; }); return out; }
function noteVoicing(notes: string[]): string[] {
  const sorted = [...new Set(notes)].sort((a, b) => NOTES.indexOf(pitchClass(a)) - NOTES.indexOf(pitchClass(b)));
  const hasOct = sorted.every((n) => /\d$/.test(n));
  if (hasOct) return sorted;
  const octaves = sorted.length <= 3 ? [3, 4, 5] : [2, 4, 4, 5, 5, 6];
  return sorted.map((n, i) => `${pitchClass(n)}${octaves[Math.min(i, octaves.length - 1)]}`);
}

function buildTonnetzTriangles(cols = 7, rows = 5, size = 68): TonnetzTri[] {
  const tris: TonnetzTri[] = [];
  const dx = size;
  const dy = (size * SQRT3) / 2;
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const ax = i * dx;
      const ay = j * 2 * dy;
      tris.push({ id: `u-${i}-${j}`, kind: 'up', points: [{ x: ax, y: ay }, { x: ax + dx, y: ay }, { x: ax + dx / 2, y: ay - dy }], notes: [latticePitch(i, j), latticePitch(i + 1, j), latticePitch(i, j - 1)] });
      tris.push({ id: `d-${i}-${j}`, kind: 'down', points: [{ x: ax, y: ay }, { x: ax + dx / 2, y: ay + dy }, { x: ax + dx, y: ay }], notes: [latticePitch(i, j), latticePitch(i, j + 1), latticePitch(i + 1, j)] });
    }
  }
  return tris;
}
function getTonnetzBounds(triangles: TonnetzTri[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  triangles.forEach((tri) => tri.points.forEach((p) => { xs.push(p.x); ys.push(p.y); }));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
function commonTones(a: string[], b: string[]): number {
  const A = new Set(a.map(pitchClass));
  const B = new Set(b.map(pitchClass));
  let c = 0;
  A.forEach((x) => { if (B.has(x)) c += 1; });
  return c;
}
function voiceLeadingProxy(a: string[], b: string[]): number {
  const ai = [...new Set(a.map((n) => NOTES.indexOf(pitchClass(n))))].sort((x, y) => x - y);
  const bi = [...new Set(b.map((n) => NOTES.indexOf(pitchClass(n))))].sort((x, y) => x - y);
  let total = 0;
  for (let i = 0; i < Math.min(ai.length, bi.length); i += 1) {
    const d = Math.abs(ai[i] - bi[i]);
    total += Math.min(d, 12 - d);
  }
  return total;
}
function bestGeometryMatch(target: string[], items: Array<{ id: string | number; notes: string[] }>): string | number | null {
  let best: { id: string | number; score: number } | null = null;
  for (const item of items) {
    const overlap = commonTones(target, item.notes);
    const distance = voiceLeadingProxy(target, item.notes);
    const score = overlap * 100 - distance;
    if (!best || score > best.score) best = { id: item.id, score };
  }
  return best ? best.id : null;
}
function summarizeProgression(chords: string[][]): { avgCommon: string; avgDistance: string } {
  if (chords.length < 2) return { avgCommon: '0.00', avgDistance: '0.00' };
  let common = 0;
  let dist = 0;
  for (let i = 1; i < chords.length; i += 1) {
    common += commonTones(chords[i - 1], chords[i]);
    dist += voiceLeadingProxy(chords[i - 1], chords[i]);
  }
  return { avgCommon: (common / (chords.length - 1)).toFixed(2), avgDistance: (dist / (chords.length - 1)).toFixed(2) };
}

function buildFullArpBars(prog: string[][], ms: number, prefix: string): DemoEvent[] {
  return prog.flatMap((pcs, i) => {
    const [r, t, f] = pcs;
    const seq = [[withOct(r, 2), withOct(t, 4)], [withOct(f, 4)], [withOct(t, 4)], [withOct(r, 5)], [withOct(t, 4)], [withOct(f, 4)], [withOct(t, 4)], [withOct(r, 2), withOct(f, 5)]];
    return seq.map((notes, k) => ({ notes, ms, harmony: pcs, label: k === 0 ? `${prefix} ${i + 1}` : undefined }));
  });
}
function buildLegatoProgression(prog: string[][], ms: number, prefix: string): DemoEvent[] {
  return prog.flatMap((pcs, i) => [
    { notes: [withOct(pcs[0], 2), withOct(pcs[1], 4), withOct(pcs[2], 5)], ms: ms * 1.2, harmony: pcs, label: `${prefix} ${i + 1}` },
    { notes: [withOct(pcs[1], 4), withOct(pcs[2], 5)], ms: ms * 0.8, harmony: pcs },
  ]);
}
function buildBellProgression(prog: string[][], ms: number, prefix: string): DemoEvent[] {
  return prog.flatMap((pcs, i) => [
    { notes: [withOct(pcs[0], 2), withOct(pcs[1], 3), withOct(pcs[2], 4)], ms: ms * 1.1, harmony: pcs, label: `${prefix} ${i + 1}` },
    { notes: [withOct(pcs[1], 4), withOct(pcs[2], 5)], ms: ms * 0.9, harmony: pcs },
    { notes: [withOct(pcs[0], 2), withOct(pcs[2], 4)], ms: ms * 0.8, harmony: pcs },
  ]);
}

function buildEventsFromMidiNotes(notes: ScoreNote[]): { events: DemoEvent[]; eventTimes: number[] } {
  if (!notes.length) return { events: [], eventTimes: [] };
  const onsets = [...new Set(notes.map((n) => Number(n.time.toFixed(5))))].sort((a, b) => a - b);
  const events: DemoEvent[] = [];
  const eventTimes: number[] = [];
  for (let i = 0; i < onsets.length; i += 1) {
    const t = onsets[i];
    const nextT = i < onsets.length - 1 ? onsets[i + 1] : t + 0.25;
    const active = notes.filter((n) => n.time <= t + 1e-6 && (n.time + n.duration) > t + 1e-6);
    const harmony = [...new Set(active.map((n) => pcFromMidi(n.midi)))];
    if (!harmony.length) continue;
    const attackNotes = active.map((n) => n.name);
    events.push({ notes: attackNotes.length ? attackNotes : noteVoicing(harmony), ms: Math.max(60, (nextT - t) * 1000), harmony, label: `t=${t.toFixed(2)}s` });
    eventTimes.push(t);
  }
  return { events, eventTimes };
}

const DEMOS: Demo[] = [
  { id: 'bach-c-major', composer: 'J.S. Bach', title: 'Prelude in C major, BWV 846', subtitle: 'Wikimedia Commons full audio', sourceLabel: 'Wikimedia Commons audio', audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/02/Kevin_MacLeod_-_J_S_Bach_Prelude_in_C_-_BWV_846.ogg', events: buildFullArpBars([['C','E','G'],['D','F','A'],['G','B','D'],['C','E','G'],['A','C','F'],['G','B','D'],['C','E','G'],['D','F','A'],['G','B','D'],['C','E','G'],['F','A','C'],['C','E','G'],['D','F','A'],['G','B','D'],['C','E','G'],['A','C','E'],['D','F','A'],['G','B','D'],['C','E','G'],['F','A','C'],['B','D','G'],['E','G','C'],['A','C','F'],['D','F','A'],['G','B','D'],['C','E','G'],['F','A','C'],['D','F','B'],['E','G','C'],['A','C','F'],['D','F','A'],['G','B','D'],['C','E','G'],['G','B','D'],['C','E','G']], 165, 'Bar') },
  { id: 'bach-suite', composer: 'J.S. Bach', title: 'Cello Suite No. 1 Prelude, BWV 1007', subtitle: 'Wikimedia Commons full audio', sourceLabel: 'Wikimedia Commons audio', audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/Bach_-_Cello_Suite_no._1_in_G_major%2C_BWV_1007_-_I._Pr%C3%A9lude.ogg', events: buildFullArpBars([['G','B','D'],['A','C','E'],['B','D','F#'],['C','E','G'],['D','F#','A'],['G','B','D'],['C','E','G'],['D','F#','A'],['G','B','D'],['E','G','B'],['A','C','E'],['D','F#','A'],['G','B','D'],['C','E','G'],['A','C','E'],['D','F#','A'],['G','B','D'],['B','D','F#'],['C','E','G'],['D','F#','A'],['G','B','D'],['C','E','G'],['A','C','E'],['D','F#','A']], 175, 'Section') },
  { id: 'chopin-em', composer: 'Frédéric Chopin', title: 'Prelude in E minor, Op. 28 No. 4', subtitle: 'Wikimedia Commons full audio', sourceLabel: 'Wikimedia Commons audio', audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e8/FChopinPreludeOp28n4.OGG', events: buildLegatoProgression([['E','G','B'],['C','E','G'],['A','C','E'],['B','D#','F#'],['E','G','B'],['C','E','G'],['A','C','E'],['B','D#','F#'],['G','B','D'],['C','E','G'],['F#','A','C#'],['B','D#','F#'],['E','G','B'],['C','E','G'],['A','C','E'],['B','D#','F#'],['E','G','B'],['D','F#','A'],['C','E','G'],['B','D#','F#'],['E','G','B'],['C','E','G'],['A','C','E'],['B','D#','F#']], 340, 'Phrase') },
  { id: 'chopin-nocturne', composer: 'Frédéric Chopin', title: 'Nocturne in E-flat major, Op. 9 No. 2', subtitle: 'Wikimedia Commons full audio', sourceLabel: 'Wikimedia Commons audio', audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/04/Chopin_Nocturne_No._2_in_E_Flat_Major%2C_Op._9.ogg', events: buildLegatoProgression([['E','G#','B'],['C#','E','G#'],['F#','A','C#'],['B','D#','F#'],['E','G#','B'],['A','C#','E'],['F#','A','C#'],['B','D#','F#'],['G#','B','D#'],['C#','E','G#'],['F#','A','C#'],['B','D#','F#'],['E','G#','B'],['C#','E','G#'],['A','C#','E'],['B','D#','F#'],['E','G#','B'],['G#','B','D#'],['C#','E','G#'],['F#','A','C#'],['B','D#','F#'],['E','G#','B'],['A','C#','E'],['B','D#','F#']], 320, 'Phrase') },
  { id: RACH_ID, composer: 'Sergei Rachmaninoff', title: 'Prelude in C-sharp minor, Op. 3 No. 2', subtitle: 'Wikimedia Commons full audio', sourceLabel: 'Wikimedia Commons audio', audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Sergei_Rachmaninoff_performs_Rachmaninoff%27s_Prelude_in_C_sharp_minor%2C_Op._3.ogg', events: buildBellProgression([['C#','E','G#'],['G#','B','D#'],['C#','F#','A'],['G#','C#','E'],['C#','E','G#'],['A','C#','E'],['F#','A','C#'],['G#','B','D#'],['C#','E','G#'],['G#','B','D#'],['C#','F#','A'],['G#','C#','E'],['C#','E','G#'],['A','C#','E'],['F#','A','C#'],['G#','B','D#'],['C#','E','G#'],['G#','B','D#'],['C#','F#','A'],['G#','C#','E'],['C#','E','G#'],['A','C#','E'],['F#','A','C#'],['G#','B','D#']], 300, 'Bell') },
];

function useSampledPiano() {
  const samplerRef = useRef<Tone.Sampler | null>(null);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const [samplerReady, setSamplerReady] = useState(false);

  useEffect(() => {
    const fallback = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.003, decay: 0.16, sustain: 0.06, release: 1.2 },
    }).toDestination();
    fallback.volume.value = -10;
    synthRef.current = fallback;

    const sampler = new Tone.Sampler({
      urls: { A2: 'A2.mp3', A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3' },
      release: 1.4,
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
      onload: () => setSamplerReady(true),
    }).toDestination();
    sampler.volume.value = -4;
    samplerRef.current = sampler;

    return () => {
      sampler.dispose();
      fallback.dispose();
      samplerRef.current = null;
      synthRef.current = null;
      setSamplerReady(false);
    };
  }, []);

  const ensureStarted = useCallback(async () => { await Tone.start(); }, []);
  const playChord = useCallback(async (notes: string[], ms: number) => {
    await ensureStarted();
    const voiced = noteVoicing(notes);
    if (samplerReady && samplerRef.current) {
      samplerRef.current.releaseAll();
      samplerRef.current.triggerAttackRelease(voiced, Math.max(0.08, ms / 1000), undefined, 0.94);
      return;
    }
    if (synthRef.current) {
      synthRef.current.releaseAll();
      synthRef.current.triggerAttackRelease(voiced, Math.max(0.08, ms / 1000), undefined, 0.86);
    }
  }, [ensureStarted, samplerReady]);
  const scheduleNote = useCallback(async (note: string, duration: number, time: number, velocity: number) => {
    await ensureStarted();
    if (samplerReady && samplerRef.current) {
      samplerRef.current.triggerAttackRelease(note, Math.max(0.03, duration), time, Math.min(1, Math.max(0.15, velocity)));
      return;
    }
    synthRef.current?.triggerAttackRelease(note, Math.max(0.03, duration), time, Math.min(1, Math.max(0.15, velocity)));
  }, [ensureStarted, samplerReady]);
  const stop = useCallback(() => { samplerRef.current?.releaseAll(); synthRef.current?.releaseAll(); }, []);
  return { playChord, scheduleNote, stop, samplerReady, ensureStarted };
}

function Section({ title, subtitle, children }: SectionProps) {
  return <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl space-y-4"><div><div className="text-lg font-medium">{title}</div>{subtitle ? <div className="text-sm text-slate-400 mt-1">{subtitle}</div> : null}</div>{children}</div>;
}
function MetricCard({ title, top, bottom }: MetricProps) {
  return <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5 text-sm"><div className="text-slate-400 mb-1">{title}</div><div>{top}</div><div>{bottom}</div></div>;
}

function IcosahedronView(props: {
  projected: Proj[]; faceCentroidsMap: Record<number, Proj>; currentFace: number | null; path: number[]; step: number; showPath: boolean; showNumbers: boolean; onFaceClick: (faceIndex: number) => void; noteMap: string[]; rotX: number; rotY: number; setRotX: React.Dispatch<React.SetStateAction<number>>; setRotY: React.Dispatch<React.SetStateAction<number>>;
}) {
  const visited = useMemo(() => new Set(props.path.slice(0, props.step + 1)), [props.path, props.step]);
  const drawOrder = useMemo(() => [...FACES.keys()].sort((a, b) => props.faceCentroidsMap[a].z - props.faceCentroidsMap[b].z), [props.faceCentroidsMap]);
  const vertexOrder = useMemo(() => [...RAW_VERTICES.keys()].sort((a, b) => props.projected[a].z - props.projected[b].z), [props.projected]);
  const dragRef = useRef({ active: false, x: 0, y: 0, rx: props.rotX, ry: props.rotY });
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => { dragRef.current = { active: true, x: e.clientX, y: e.clientY, rx: props.rotX, ry: props.rotY }; };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    props.setRotY(dragRef.current.ry + dx * 0.008);
    props.setRotX(Math.max(-1.35, Math.min(1.35, dragRef.current.rx + dy * 0.008)));
  };
  const onPointerUp = () => { dragRef.current.active = false; };
  const pathPolyline = props.path.map((f) => { const c = props.faceCentroidsMap[f]; return `${c.x},${c.y}`; }).join(' ');
  return (
    <div className="w-full aspect-square rounded-3xl bg-slate-900/90 border border-white/5 overflow-hidden touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <svg viewBox="-400 -400 800 800" className="w-full h-full select-none">
        <rect x="-400" y="-400" width="800" height="800" fill="#0f172a" />
        {drawOrder.map((faceIndex) => {
          const pts = FACES[faceIndex].map((i) => `${props.projected[i].x},${props.projected[i].y}`).join(' ');
          const active = props.currentFace === faceIndex;
          const cls = active ? 'fill-amber-300/90' : visited.has(faceIndex) ? 'fill-violet-300/45' : 'fill-white/10';
          return <polygon key={`face-${faceIndex}`} points={pts} onClick={() => props.onFaceClick(faceIndex)} className={`${cls} stroke-white/45 stroke-[1.5] cursor-pointer hover:fill-fuchsia-300/40 transition-all duration-150`} />;
        })}
        {drawOrder.map((faceIndex) => {
          const face = FACES[faceIndex];
          const pts = [face[0], face[1], face[2], face[0]].map((i) => `${props.projected[i].x},${props.projected[i].y}`).join(' ');
          return <polyline key={`edge-${faceIndex}`} points={pts} fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.4" />;
        })}
        {props.showPath && props.path.length > 1 ? <polyline points={pathPolyline} fill="none" stroke="#f472b6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" /> : null}
        {props.showPath ? props.path.map((faceIndex, idx) => {
          const c = props.faceCentroidsMap[faceIndex];
          return <g key={`mark-${faceIndex}-${idx}`}><circle cx={c.x} cy={c.y} r={idx === props.step ? 8 : 5} fill={idx <= props.step ? '#34d399' : '#f8fafc'} opacity={idx <= props.step ? 1 : 0.45} />{props.showNumbers ? <text x={c.x + 12} y={c.y - 10} fontSize="12" fill="#e2e8f0">{idx + 1}</text> : null}</g>;
        }) : null}
        {vertexOrder.map((i) => {
          const p = props.projected[i];
          const r = 12 + Math.max(0, p.z) * 2;
          return <g key={`vertex-${i}`}><circle cx={p.x} cy={p.y} r={r} fill="#111827" stroke="#e2e8f0" strokeWidth="1.4" /><text x={p.x} y={p.y - 18} textAnchor="middle" fontSize="11" fill="#cbd5e1">{i + 1}</text><text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fill="#f8fafc">{props.noteMap[i]}</text></g>;
        })}
      </svg>
    </div>
  );
}

function TonnetzView(props: { triangles: TonnetzTri[]; currentId: string | null; activePathIds: string[]; step: number; onTriangleClick: (tri: TonnetzTri) => void; }) {
  const bounds = useMemo(() => getTonnetzBounds(props.triangles), [props.triangles]);
  const currentSet = useMemo(() => new Set(props.activePathIds.slice(0, props.step + 1)), [props.activePathIds, props.step]);
  const padding = 44;
  const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;
  return (
    <div className="w-full rounded-3xl bg-slate-900/90 border border-white/5 overflow-hidden">
      <div className="h-[640px] w-full bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.15),transparent_35%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.15),transparent_35%)]">
        <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
          <rect x={bounds.minX - padding} y={bounds.minY - padding} width={bounds.width + padding * 2} height={bounds.height + padding * 2} rx="28" fill="#0f172a" />
          {props.triangles.map((tri) => {
            const pts = tri.points.map((p) => `${p.x},${p.y}`).join(' ');
            const active = tri.id === props.currentId;
            const inPath = currentSet.has(tri.id);
            const fill = active ? 'rgba(251,191,36,0.95)' : inPath ? 'rgba(167,139,250,0.50)' : tri.kind === 'up' ? 'rgba(99,102,241,0.16)' : 'rgba(34,197,94,0.14)';
            const cx = (tri.points[0].x + tri.points[1].x + tri.points[2].x) / 3;
            const cy = (tri.points[0].y + tri.points[1].y + tri.points[2].y) / 3;
            return <g key={tri.id} onClick={() => props.onTriangleClick(tri)} className="cursor-pointer"><polygon points={pts} fill={fill} stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" /><text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill="#f8fafc">{tri.notes.join(' · ')}</text></g>;
          })}
        </svg>
      </div>
    </div>
  );
}

export default function MusicalIcosahedraLab() {
  const [noteMap, setNoteMap] = useState<string[]>(NOTES.slice());
  const [compareSymmetry, setCompareSymmetry] = useState(false);
  const [selectedDemoId, setSelectedDemoId] = useState<string>(DEMOS[0].id);
  const [showPath, setShowPath] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);
  const [rotX, setRotX] = useState(DEFAULT_ROT_X);
  const [rotY, setRotY] = useState(DEFAULT_ROT_Y);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempoScale, setTempoScale] = useState(1);
  const [manualIcoSequence, setManualIcoSequence] = useState<number[]>([]);
  const [manualTonnetzSequence, setManualTonnetzSequence] = useState<string[]>([]);
  const [selectedTonnetzId, setSelectedTonnetzId] = useState<string | null>(null);
  const [tonnetzMode, setTonnetzMode] = useState<'chromatic' | 'fifths'>('chromatic');
  const [durationSec, setDurationSec] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [midiPilot, setMidiPilot] = useState<MidiPilot | null>(null);
  const [useMidiGeometry, setUseMidiGeometry] = useState(false);
  const [midiPlaying, setMidiPlaying] = useState(false);
  const [midiProgressSec, setMidiProgressSec] = useState(0);
  const [midiError, setMidiError] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clickPiano = useSampledPiano();
  const midiPartRef = useRef<Tone.Part<any> | null>(null);

  const selectedDemo = useMemo(() => DEMOS.find((d) => d.id === selectedDemoId) || DEMOS[0], [selectedDemoId]);
  const activeMap = useMemo(() => compareSymmetry ? mutate(noteMap) : noteMap, [compareSymmetry, noteMap]);
  const projected = useMemo(() => RAW_VERTICES.map((v) => projectPoint(v, rotX, rotY, FIXED_ZOOM)), [rotX, rotY]);
  const faceCentroidsMap = useMemo(() => { const out: Record<number, Proj> = {}; FACES.forEach((_, i) => { out[i] = faceCentroid(i, projected); }); return out; }, [projected]);
  const tonnetzTrianglesRaw = useMemo(() => buildTonnetzTriangles(), []);
  const tonnetzTriangles = useMemo(() => tonnetzTrianglesRaw.map((tri) => ({ ...tri, notes: tri.notes.map((n) => tonnetzMode === 'fifths' ? FIFTHS[NOTES.indexOf(n)] : n) })), [tonnetzTrianglesRaw, tonnetzMode]);
  const geometryItemsIco = useMemo(() => FACES.map((_, i) => ({ id: i, notes: chordForFace(i, activeMap) })), [activeMap]);
  const geometryItemsTonnetz = useMemo(() => tonnetzTriangles.map((tri) => ({ id: tri.id, notes: tri.notes })), [tonnetzTriangles]);

  const analysisEvents = useMemo(() => (useMidiGeometry && midiPilot && selectedDemo.id === RACH_ID ? midiPilot.events : selectedDemo.events), [useMidiGeometry, midiPilot, selectedDemo]);
  const analysisEventTimes = useMemo(() => (useMidiGeometry && midiPilot && selectedDemo.id === RACH_ID ? midiPilot.eventTimes : []), [useMidiGeometry, midiPilot, selectedDemo]);

  const piecePathItems: MatchItem[] = useMemo(() => analysisEvents.map((ev) => ({
    face: bestGeometryMatch(ev.harmony, geometryItemsIco) as number | null,
    tonnetzId: bestGeometryMatch(ev.harmony, geometryItemsTonnetz) as string | null,
    harmony: ev.harmony,
  })), [analysisEvents, geometryItemsIco, geometryItemsTonnetz]);

  const dedupeKeepOrder = (arr: Array<number | string | null>) => {
    const out: Array<number | string> = [];
    const seen = new Set<number | string>();
    arr.forEach((item) => {
      if (item === null) return;
      if (!seen.has(item)) { seen.add(item); out.push(item); }
    });
    return out;
  };

  const piecePathFaces = useMemo(() => dedupeKeepOrder(piecePathItems.map((x) => x.face)) as number[], [piecePathItems]);
  const piecePathTonnetz = useMemo(() => dedupeKeepOrder(piecePathItems.map((x) => x.tonnetzId)) as string[], [piecePathItems]);
  const activeFacePath = manualIcoSequence.length ? dedupeKeepOrder(manualIcoSequence) as number[] : (piecePathFaces.length ? piecePathFaces : DEFAULT_PATH);
  const activeTonnetzPath = manualTonnetzSequence.length ? dedupeKeepOrder(manualTonnetzSequence) as string[] : piecePathTonnetz;

  const audioAutoIndex = useMemo(() => {
    const total = analysisEvents.length;
    if (!durationSec || total <= 1 || useMidiGeometry) return currentIndex;
    const idx = Math.floor((currentSec / durationSec) * total);
    return Math.max(0, Math.min(total - 1, idx));
  }, [analysisEvents.length, durationSec, currentSec, currentIndex, useMidiGeometry]);

  const midiAutoIndex = useMemo(() => {
    if (!(useMidiGeometry && midiPilot && selectedDemo.id === RACH_ID)) return currentIndex;
    if (!analysisEventTimes.length) return 0;
    let idx = 0;
    for (let i = 0; i < analysisEventTimes.length; i += 1) {
      if (analysisEventTimes[i] <= midiProgressSec + 1e-6) idx = i;
      else break;
    }
    return idx;
  }, [useMidiGeometry, midiPilot, selectedDemo.id, analysisEventTimes, midiProgressSec, currentIndex]);

  const effectiveIndex = useMidiGeometry && midiPilot && selectedDemo.id === RACH_ID ? midiAutoIndex : (isPlaying ? audioAutoIndex : currentIndex);
  const currentFace = piecePathItems[effectiveIndex]?.face ?? activeFacePath[0] ?? null;
  const currentTonnetz = piecePathItems[effectiveIndex]?.tonnetzId ?? activeTonnetzPath[0] ?? null;
  const faceStep = currentFace === null ? 0 : Math.max(0, activeFacePath.indexOf(currentFace));
  const tonnetzStep = currentTonnetz === null ? 0 : Math.max(0, activeTonnetzPath.indexOf(currentTonnetz));
  const currentEvent = analysisEvents[effectiveIndex] || analysisEvents[0] || { notes: [], ms: 0, harmony: [], label: '' };
  const stats = useMemo(() => summarizeProgression(analysisEvents.map((e) => e.harmony)), [analysisEvents]);

  useEffect(() => {
    const audio = new Audio(selectedDemo.audioUrl);
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.playbackRate = tempoScale;
    audioRef.current = audio;

    const onLoaded = () => setDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onTime = () => setCurrentSec(audio.currentTime || 0);
    const onEnded = () => { setIsPlaying(false); setCurrentSec(audio.duration || 0); };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);

    setIsPlaying(false);
    setCurrentIndex(0);
    setCurrentSec(0);
    setDurationSec(0);
    setManualIcoSequence([]);
    setManualTonnetzSequence([]);
    setSelectedTonnetzId(null);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
    };
  }, [selectedDemoId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (midiPlaying) setMidiProgressSec(Tone.Transport.seconds);
    }, 50);
    return () => window.clearInterval(id);
  }, [midiPlaying]);

  useEffect(() => {
    return () => {
      midiPartRef.current?.dispose();
      Tone.Transport.stop();
      Tone.Transport.cancel();
      clickPiano.stop();
    };
  }, [clickPiano]);

  const rebuildMidiPart = useCallback(async (pilot: MidiPilot) => {
    await clickPiano.ensureStarted();
    midiPartRef.current?.dispose();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    Tone.Transport.seconds = 0;
    if (pilot.bpm) Tone.Transport.bpm.value = pilot.bpm;
    const part = new Tone.Part((time, value: ScoreNote) => {
      clickPiano.scheduleNote(value.name, value.duration, time, value.velocity);
    }, pilot.notes.map((n) => [n.time, n] as [number, ScoreNote]));
    part.start(0);
    midiPartRef.current = part;
    setMidiProgressSec(0);
    setMidiPlaying(false);
  }, [clickPiano]);

  const handleMidiUpload = useCallback(async (file: File | null) => {
    if (!file) return;
    setMidiError('');
    try {
      const buffer = await file.arrayBuffer();
      const midi = new Midi(buffer);
      const notes: ScoreNote[] = midi.tracks.flatMap((track, ti) => track.notes.map((n) => ({ midi: n.midi, name: n.name, time: n.time, duration: n.duration, velocity: n.velocity, track: ti }))).sort((a, b) => a.time - b.time || a.midi - b.midi);
      const built = buildEventsFromMidiNotes(notes);
      const pilot: MidiPilot = {
        fileName: file.name,
        bpm: midi.header.tempos.length ? midi.header.tempos[0].bpm : null,
        duration: midi.duration,
        noteCount: notes.length,
        notes,
        events: built.events,
        eventTimes: built.eventTimes,
      };
      setMidiPilot(pilot);
      setUseMidiGeometry(true);
      await rebuildMidiPart(pilot);
    } catch (err) {
      setMidiError('Could not parse the MIDI file. Please try another .mid or .midi file.');
    }
  }, [rebuildMidiPart]);

  const handleMidiPlayPause = useCallback(async () => {
    if (!midiPilot) return;
    await clickPiano.ensureStarted();
    if (!midiPartRef.current) await rebuildMidiPart(midiPilot);
    if (midiPlaying) {
      Tone.Transport.pause();
      setMidiPlaying(false);
      setMidiProgressSec(Tone.Transport.seconds);
      return;
    }
    Tone.Transport.start();
    setMidiPlaying(true);
  }, [midiPilot, midiPlaying, clickPiano, rebuildMidiPart]);

  const handleMidiRestart = useCallback(async () => {
    if (!midiPilot) return;
    await rebuildMidiPart(midiPilot);
    setMidiProgressSec(0);
    setCurrentIndex(0);
  }, [midiPilot, rebuildMidiPart]);

  const handleMidiStop = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    Tone.Transport.seconds = 0;
    setMidiPlaying(false);
    setMidiProgressSec(0);
  }, []);

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentSec(0);
    setCurrentIndex(0);
    setIsPlaying(false);
  }, []);

  const nudgeFrame = useCallback((delta: number) => {
    const total = analysisEvents.length;
    const nextIndex = Math.max(0, Math.min(total - 1, effectiveIndex + delta));
    setCurrentIndex(nextIndex);
    if (useMidiGeometry && midiPilot && selectedDemo.id === RACH_ID) {
      const t = analysisEventTimes[nextIndex] ?? 0;
      Tone.Transport.seconds = t;
      setMidiProgressSec(t);
      Tone.Transport.pause();
      setMidiPlaying(false);
      return;
    }
    const audio = audioRef.current;
    if (!audio || !durationSec) return;
    const t = (nextIndex / Math.max(1, total - 1)) * durationSec;
    audio.currentTime = t;
    setCurrentSec(t);
    audio.pause();
    setIsPlaying(false);
  }, [analysisEvents.length, effectiveIndex, useMidiGeometry, midiPilot, selectedDemo.id, analysisEventTimes, durationSec]);

  const scrub = useCallback((value: number) => {
    const total = analysisEvents.length;
    const safe = Math.max(0, Math.min(total - 1, value));
    setCurrentIndex(safe);
    if (useMidiGeometry && midiPilot && selectedDemo.id === RACH_ID) {
      const t = analysisEventTimes[safe] ?? 0;
      Tone.Transport.seconds = t;
      setMidiProgressSec(t);
      Tone.Transport.pause();
      setMidiPlaying(false);
      return;
    }
    const audio = audioRef.current;
    if (!audio || !durationSec) return;
    const t = (safe / Math.max(1, total - 1)) * durationSec;
    audio.currentTime = t;
    setCurrentSec(t);
    audio.pause();
    setIsPlaying(false);
  }, [analysisEvents.length, useMidiGeometry, midiPilot, selectedDemo.id, analysisEventTimes, durationSec]);

  const handleFaceClick = useCallback(async (faceIndex: number) => {
    await clickPiano.playChord(chordForFace(faceIndex, activeMap), 420);
    setManualIcoSequence((prev) => prev.concat([faceIndex]));
  }, [activeMap, clickPiano]);

  const handleTonnetzClick = useCallback(async (tri: TonnetzTri) => {
    setSelectedTonnetzId(tri.id);
    await clickPiano.playChord(tri.notes, 420);
    setManualTonnetzSequence((prev) => prev.concat([tri.id]));
  }, [clickPiano]);

  const playManualFaces = useCallback(async () => {
    for (const face of manualIcoSequence) {
      await clickPiano.playChord(chordForFace(face, activeMap), 320);
    }
  }, [manualIcoSequence, activeMap, clickPiano]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
          <div className="text-xs uppercase tracking-[0.25em] text-sky-300 mb-2">{TITLE}</div>
          <h1 className="text-3xl font-semibold tracking-tight">{SUBTITLE}</h1>
          <p className="text-slate-300 mt-2 max-w-5xl leading-relaxed">
            This edition keeps the original full-audio experience and adds a score-driven pilot for Rachmaninoff’s Prelude in C-sharp minor. You can still listen to real Wikimedia Commons recordings, but now you can also load a MIDI file and test a true note-driven pipeline: parse the score, extract note events, derive harmonic slices, map them to the icosahedron and the Tonnetz, and play the MIDI through a piano sampler without breaking the rest of the application.
          </p>
        </div>

        <Section title="Detailed guide to what is happening on screen" subtitle="Long-form explanation, now including the exact MIDI pilot.">
          <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5"><div className="font-medium text-slate-100 mb-2">{ICONS.intro} The general idea</div>The application has two layers. The first is a listening layer, where you hear a complete performance. The second is an analytical layer, where the currently active harmony is represented inside two geometric systems. This makes the app simultaneously a music player, a harmonic visualizer, and an exploratory geometry lab.</div>
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5"><div className="font-medium text-slate-100 mb-2">{ICONS.ico} The icosahedron</div>Each face of the icosahedron acts as a triadic harmonic cell derived from the three vertex pitches attached to it. When the active harmonic slice changes, the highlighted route can move to another face. That makes harmony visible as three-dimensional travel rather than just a symbolic progression.</div>
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5"><div className="font-medium text-slate-100 mb-2">{ICONS.tonnetz} The Tonnetz</div>The Tonnetz is a planar neighborhood structure for triads. It is excellent for seeing local smoothness, shared tones, and compact voice-leading. The same harmonic slice can therefore be displayed as a move in a plane and as a move across a polyhedron.</div>
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5"><div className="font-medium text-slate-100 mb-2">{ICONS.path} Why the path moves</div>For any currently active harmony, the app searches the available icosahedron faces and Tonnetz cells and finds the best match using overlap and a simple voice-leading proxy. The visible route is therefore the path traced by successive harmonic slices as the piece advances.</div>
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5"><div className="font-medium text-slate-100 mb-2">{ICONS.audio} Audio modes</div>The built-in works still use full audio recordings from Wikimedia Commons. The new Rachmaninoff MIDI pilot adds a second route: exact note events from a loaded MIDI file are scheduled through a piano sampler, and the geometric mapping can follow those exact events instead of the old symbolic approximation.</div>
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5"><div className="font-medium text-slate-100 mb-2">{ICONS.exact} What the MIDI pilot does</div>When you upload a MIDI file for the Rachmaninoff prelude, the file is parsed into notes with start time, duration, pitch, and velocity. Those notes are then collapsed into ordered harmonic slices at each onset time. Those slices drive the geometric layer, while the exact notes themselves drive the sampled-piano playback. This is the score-driven pipeline you wanted to test.</div>
          </div>
        </Section>

        <Section title="Exact MIDI pilot — Rachmaninoff Prelude in C-sharp minor" subtitle="Upload your MIDI file here. This does not replace the old system; it adds a new exact-note pathway for this one work.">
          <div className="grid lg:grid-cols-[1fr_1fr] gap-4 text-sm">
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5 space-y-3">
              <div className="font-medium text-slate-100">{ICONS.midi} Load MIDI</div>
              <input type="file" accept=".mid,.midi,audio/midi,audio/x-midi" onChange={(e) => handleMidiUpload(e.target.files?.[0] || null)} className="block w-full text-sm" />
              {midiError ? <div className="text-rose-300">{midiError}</div> : null}
              {midiPilot ? (
                <div className="space-y-1 text-slate-300">
                  <div>File: {midiPilot.fileName}</div>
                  <div>Notes parsed: {midiPilot.noteCount}</div>
                  <div>Harmonic slices: {midiPilot.events.length}</div>
                  <div>Duration: {midiPilot.duration.toFixed(2)} s</div>
                  <div>BPM: {midiPilot.bpm ? midiPilot.bpm.toFixed(1) : 'not specified in file'}</div>
                </div>
              ) : <div className="text-slate-400">Load the MIDI you attached to test the exact-note pipeline.</div>}
            </div>
            <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5 space-y-3">
              <div className="font-medium text-slate-100">{ICONS.audio} MIDI playback and geometry</div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={useMidiGeometry} disabled={!midiPilot || selectedDemo.id !== RACH_ID} onChange={(e) => setUseMidiGeometry(e.target.checked)} />Use uploaded MIDI for the geometric layer when Rachmaninoff is selected</label>
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleMidiPlayPause} disabled={!midiPilot} className={midiPlaying ? 'px-3 py-2 rounded-xl text-sm bg-rose-400 text-slate-950 disabled:opacity-40' : 'px-3 py-2 rounded-xl text-sm bg-emerald-400 text-slate-950 disabled:opacity-40'}>{midiPlaying ? 'Pause exact MIDI' : 'Play exact MIDI'}</button>
                <button onClick={handleMidiRestart} disabled={!midiPilot} className="px-3 py-2 rounded-xl bg-white/10 text-sm disabled:opacity-40">Rebuild from start</button>
                <button onClick={handleMidiStop} disabled={!midiPilot} className="px-3 py-2 rounded-xl bg-white/10 text-sm disabled:opacity-40">Stop exact MIDI</button>
              </div>
              <div className="text-slate-300">Manual click piano: {clickPiano.samplerReady ? 'sampled piano ready' : 'loading sampled piano, synth fallback active'}</div>
              <div className="text-slate-300">Exact MIDI progress: {midiProgressSec.toFixed(2)} s</div>
            </div>
          </div>
        </Section>

        <div className="grid lg:grid-cols-[1.18fr_0.82fr] gap-6">
          <Section title="Icosahedron" subtitle="Large fixed-scale view. Drag to rotate. Click faces to hear and build your own route.">
            <div className="flex gap-2 flex-wrap text-sm">
              <button className={showPath ? 'px-3 py-2 rounded-xl bg-slate-200 text-slate-900' : 'px-3 py-2 rounded-xl bg-white/10'} onClick={() => setShowPath((v) => !v)}>Path</button>
              <button className={showNumbers ? 'px-3 py-2 rounded-xl bg-slate-200 text-slate-900' : 'px-3 py-2 rounded-xl bg-white/10'} onClick={() => setShowNumbers((v) => !v)}>Numbers</button>
              <button className="px-3 py-2 rounded-xl bg-white/10" onClick={() => { setRotX(DEFAULT_ROT_X); setRotY(DEFAULT_ROT_Y); }}>Reset rotation</button>
              <button className="px-3 py-2 rounded-xl bg-violet-400 text-slate-950" onClick={playManualFaces}>Play manual face path</button>
              <button className="px-3 py-2 rounded-xl bg-white/10" onClick={() => setManualIcoSequence([])}>Clear manual path</button>
            </div>
            <IcosahedronView projected={projected} faceCentroidsMap={faceCentroidsMap} currentFace={currentFace} path={activeFacePath} step={faceStep} showPath={showPath} showNumbers={showNumbers} onFaceClick={handleFaceClick} noteMap={activeMap} rotX={rotX} rotY={rotY} setRotX={setRotX} setRotY={setRotY} />
          </Section>

          <div className="space-y-6">
            <Section title="Works and playback" subtitle="Original audio layer preserved. Nothing old is removed.">
              <select value={selectedDemoId} onChange={(e) => setSelectedDemoId(e.target.value)} className="w-full rounded-xl bg-slate-900 px-3 py-2 border border-white/10">
                {DEMOS.map((demo) => <option key={demo.id} value={demo.id}>{demo.composer} — {demo.title}</option>)}
              </select>
              <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5">
                <div className="font-medium">{selectedDemo.composer} — {selectedDemo.title}</div>
                <div className="text-sm text-slate-300 mt-1">{selectedDemo.subtitle}</div>
                <div className="text-xs text-slate-400 mt-2">Source: {selectedDemo.sourceLabel}</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={handlePlayPause} className={isPlaying ? 'px-3 py-2 rounded-xl text-sm bg-rose-400 text-slate-950' : 'px-3 py-2 rounded-xl text-sm bg-emerald-400 text-slate-950'}>{isPlaying ? 'Pause' : currentSec > 0 ? 'Resume' : 'Play'}</button>
                <button onClick={stopPlayback} className="px-3 py-2 rounded-xl bg-white/10 text-sm">From start</button>
                <button onClick={() => nudgeFrame(-1)} className="px-3 py-2 rounded-xl bg-white/10 text-sm">Back</button>
                <button onClick={() => nudgeFrame(1)} className="px-3 py-2 rounded-xl bg-white/10 text-sm">Forward</button>
              </div>
              <div className="text-sm text-slate-300">Playback speed: {tempoScale.toFixed(2)}x</div>
              <input type="range" min={0.65} max={1.35} step={0.05} value={tempoScale} onChange={(e) => {
                const next = Number(e.target.value);
                setTempoScale(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }} className="w-full" />
              <div className="text-sm text-slate-300">Position: {effectiveIndex + 1} / {analysisEvents.length}</div>
              <input type="range" min={0} max={Math.max(0, analysisEvents.length - 1)} step={1} value={effectiveIndex} onChange={(e) => scrub(Number(e.target.value))} className="w-full" />
            </Section>

            <Section title="Current harmonic snapshot" subtitle="The geometric layer now follows either the old symbolic path or the uploaded exact MIDI path.">
              <div className="rounded-2xl bg-slate-900/60 p-4 border border-white/5">
                <div className="text-slate-400 text-sm mb-1">Now sounding in the geometric layer</div>
                <div className="text-xl font-semibold">{currentEvent.harmony.join(' – ')}</div>
                <div className="text-sm text-slate-300 mt-1">Frame {effectiveIndex + 1}: {currentEvent.label || currentEvent.notes.join(' · ')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <MetricCard title="Global geometry" top={`Average common tones: ${stats.avgCommon}`} bottom={`Average voice-leading distance: ${stats.avgDistance}`} />
                <MetricCard title="Current match" top={`Icosahedron face: ${String(currentFace)}`} bottom={`Tonnetz cell: ${String(currentTonnetz || '—')}`} />
              </div>
            </Section>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-6">
          <Section title="Tonnetz" subtitle="Planar harmonic network. Click cells to build an alternate user-defined route and compare it with the icosahedron path.">
            <div className="flex gap-2 flex-wrap text-sm">
              <button onClick={() => setTonnetzMode('chromatic')} className={tonnetzMode === 'chromatic' ? 'px-3 py-2 rounded-xl bg-slate-200 text-slate-900' : 'px-3 py-2 rounded-xl bg-white/10'}>Standard labels</button>
              <button onClick={() => setTonnetzMode('fifths')} className={tonnetzMode === 'fifths' ? 'px-3 py-2 rounded-xl bg-slate-200 text-slate-900' : 'px-3 py-2 rounded-xl bg-white/10'}>Fifths labels</button>
              <button onClick={() => setManualTonnetzSequence([])} className="px-3 py-2 rounded-xl bg-white/10">Clear manual Tonnetz path</button>
            </div>
            <TonnetzView triangles={tonnetzTriangles} currentId={currentTonnetz || selectedTonnetzId} activePathIds={activeTonnetzPath} step={tonnetzStep} onTriangleClick={handleTonnetzClick} />
          </Section>

          <div className="space-y-6">
            <Section title="Why both geometries matter" subtitle="The same work can look globally dramatic and locally smooth at the same time.">
              <div className="text-sm text-slate-300 leading-relaxed space-y-3">
                <div>{ICONS.ico} The icosahedron emphasizes large-scale spatial travel.</div>
                <div>{ICONS.tonnetz} The Tonnetz emphasizes local harmonic adjacency.</div>
                <div>{ICONS.compare} The app becomes especially valuable now because you can compare the older curated path with a path driven by exact note data from your own MIDI file.</div>
              </div>
            </Section>

            <Section title="Vertex note mapping" subtitle="Change the pitch labels assigned to the icosahedron vertices and watch the harmonic faces change.">
              <div className="flex gap-2 flex-wrap mb-3">
                <button onClick={() => setNoteMap(NOTES.slice())} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-900 text-sm">Chromatic</button>
                <button onClick={() => setNoteMap(FIFTHS.slice())} className="px-3 py-2 rounded-xl bg-white/10 text-sm">Cycle of fifths</button>
                <button onClick={() => setCompareSymmetry((v) => !v)} className="px-3 py-2 rounded-xl bg-white/10 text-sm">{compareSymmetry ? 'Using symmetry view' : 'Using direct mapping'}</button>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 text-sm">
                {noteMap.map((note, i) => (
                  <label key={i} className="rounded-2xl bg-slate-900/70 p-2 border border-white/5">
                    <div className="text-slate-400 mb-1">Vertex {i + 1}</div>
                    <select value={note} onChange={(e) => { const copy = noteMap.slice(); copy[i] = e.target.value; setNoteMap(copy); }} className="w-full rounded-lg bg-slate-800 px-2 py-1.5 outline-none">
                      {NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}