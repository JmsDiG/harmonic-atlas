import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

type Vec3 = [number, number, number];
type Proj = { x: number; y: number; z: number };
type TonnetzTri = { id: string; kind: 'up' | 'down'; points: { x: number; y: number }[]; notes: string[] };
type TonnetzPoint = { id: string; point: { x: number; y: number }; note: string };
type TonnetzEdge = { id: string; pointIds: [string, string]; notes: string[]; center: { x: number; y: number } };
type TonnetzFace = { id: string; notes: string[]; center: { x: number; y: number } };
type TonnetzGeometry = { points: TonnetzPoint[]; edges: TonnetzEdge[]; faces: TonnetzFace[] };
type IcosahedronEdge = { id: string; vertices: [number, number] };
type WeightedPitchClass = {
  pc: string;
  weight: number;
  attackWeight: number;
  sustainWeight: number;
  noteCount: number;
  averageRegister: number;
  strongestNote: string | null;
};
type HarmonicDescriptor = {
  weightedPcs: WeightedPitchClass[];
  pcs: string[];
  corePcs: string[];
  colorPcs: string[];
  attackPcs: string[];
  bassPc: string | null;
  profile: number[];
  attackProfile: number[];
  totalWeight: number;
  confidence: number;
  ambiguity: number;
  reasoning: string[];
};
type DemoEvent = { notes: string[]; ms: number; harmony: string[]; label?: string; analysis?: HarmonicDescriptor; };
type Demo = { id: string; composer: string; title: string; subtitle: string; midiUrl: string; sourceLabel: string };
type ExactSubsetSize = 1 | 2 | 3;
type ExactGeometryLevel = 'vertex' | 'edge' | 'face';
type ExactGeometryMatch<VertexId extends string | number, FaceId extends string | number> = {
  inputPcs: string[];
  subsetSize: ExactSubsetSize | null;
  level: ExactGeometryLevel | null;
  subsetPcs: string[][];
  rule: string;
  vertexIds: VertexId[];
  edgeIds: string[];
  faceIds: FaceId[];
};
type IcosahedronExactMatch = ExactGeometryMatch<number, number>;
type TonnetzExactMatch = ExactGeometryMatch<string, string>;
type IcosahedronManualSelection =
  | { level: 'vertex'; vertexId: number }
  | { level: 'edge'; edgeId: string }
  | { level: 'face'; faceId: number };
type TonnetzManualSelection =
  | { level: 'vertex'; vertexId: string }
  | { level: 'edge'; edgeId: string }
  | { level: 'face'; faceId: string };
type HarmonyFeatures = {
  pcs: string[];
  corePcs: string[];
  colorPcs: string[];
  attackPcs: string[];
  bassPc: string | null;
  profile: number[];
  attackProfile: number[];
  totalWeight: number;
  confidence: number;
  ambiguity: number;
  reasoning: string[];
};
type AnalysisFollowMode = 'follow' | 'freeze';
type AnalyzedEvent = {
  index: number;
  event: DemoEvent;
  literalPcs: string[];
  startMs: number;
  startSec: number;
  durationMs: number;
  durationSec: number;
  features: HarmonyFeatures;
  icosahedronExact: IcosahedronExactMatch;
  tonnetzExact: TonnetzExactMatch;
  commonToneScore: number | null;
  voiceLeadingScore: number | null;
  descriptorConfidence: number;
  descriptorAmbiguity: number;
};
type SectionTone = 'sky' | 'violet' | 'amber' | 'emerald';
type SectionProps = { title: string; subtitle?: string; children: React.ReactNode; icon?: string; eyebrow?: string; tone?: SectionTone };
type MetricProps = { title: string; top: string; bottom: string };
type MidiControlEvent = { track: number; number: number; name: string; time: number; value: number };
type SustainWindow = { track: number; start: number; end: number };
type ScoreNote = {
  midi: number;
  name: string;
  noteName: string;
  pitchClass: string;
  octave: number;
  register: number;
  time: number;
  end: number;
  sustainedUntil: number;
  duration: number;
  effectiveDuration: number;
  velocity: number;
  track: number;
  bars: number | null;
  metricWeight: number;
};
type MidiPilot = {
  fileName: string;
  bpm: number | null;
  duration: number;
  noteCount: number;
  notes: ScoreNote[];
  events: DemoEvent[];
  eventTimes: number[];
  sustainWindows: SustainWindow[];
  controlEvents: MidiControlEvent[];
  atomicSliceCount: number;
};
type PlaybackSource = 'demo' | 'midi';

const TITLE = 'Harmonic Atlas';
const SUBTITLE = 'Interactive Harmonic Geometry for Listening, Seeing, and Uploading MIDI';
const ICONS = { intro: '🎼', ico: '🔺', tonnetz: '🕸️', audio: '🎹', compare: '🧠', map: '🗺️', midi: '📁', exact: '🎯' };

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
const PHI = 1.618033988749895;
const SQRT3 = Math.sqrt(3);
const DEFAULT_ROT_X = -0.22;
const DEFAULT_ROT_Y = 0.84;
const FIXED_ZOOM = 2.1;
const SYMMETRY: Record<number, number> = { 0: 0, 1: 7, 2: 1, 3: 11, 4: 5, 5: 3, 6: 2, 7: 8, 8: 6, 9: 9, 10: 4, 11: 10 };
const RACH_ID = 'rachmaninoff';

function CodexIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 4.5h8l4 4v7l-4 4H8l-4-4v-7l4-4Z" />
      <path d="m9.5 9 2.5-2.5L14.5 9" />
      <path d="M14.5 15 12 17.5 9.5 15" />
      <path d="M8.5 12H15.5" />
    </svg>
  );
}

function GitIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="2.25" />
      <circle cx="17" cy="5" r="2.25" />
      <circle cx="17" cy="17" r="2.25" />
      <path d="M8.8 8.2 15.2 5.8" />
      <path d="M7 9.25v5.5" />
      <path d="M8.6 16.2 15.4 16.8" />
    </svg>
  );
}

function ArticleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 4.5h8l4 4v11H6Z" />
      <path d="M14 4.5v4h4" />
      <path d="M9 12h6" />
      <path d="M9 15.5h6" />
    </svg>
  );
}

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
function averageVec3(points: Vec3[]): Vec3 {
  if (!points.length) return [0, 0, 0];
  const total = points.reduce<Vec3>((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]], [0, 0, 0]);
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length];
}
function mod12(n: number): number { return ((n % 12) + 12) % 12; }
function pitchClass(note: string): string { const m = note.match(/^([A-G]#?)/); return m ? m[1] : note; }
function latticePitch(i: number, j: number): string { return NOTES[mod12(7 * i + 3 * j)]; }
function pointKey(point: { x: number; y: number }): string { return `${point.x.toFixed(4)},${point.y.toFixed(4)}`; }

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
function manualChordVoicing(notes: string[]): string[] {
  const pcs = [...new Set(notes.map(pitchClass))];
  if (!pcs.length) return [];
  if (pcs.every((note) => /\d$/.test(note))) return noteVoicing(pcs);
  const [bassPc, ...upperPcs] = pcs;
  const voiced = [`${bassPc}3`];
  let previousMidi = NOTES.indexOf(bassPc) + (4 * 12);
  upperPcs.forEach((pc) => {
    let midi = NOTES.indexOf(pc) + (4 * 12);
    while (midi <= previousMidi) midi += 12;
    voiced.push(`${pc}${Math.floor(midi / 12) - 1}`);
    previousMidi = midi;
  });
  return voiced;
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
function centroid2D(points: { x: number; y: number }[]): { x: number; y: number } {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}
function sortPitchClasses(pcs: string[]): string[] {
  return [...pcs].sort((left, right) => NOTES.indexOf(left) - NOTES.indexOf(right));
}
function normalizePitchClasses(notes: string[]): string[] {
  return sortPitchClasses([...new Set(notes.map(pitchClass))]);
}
function pitchClassSetKey(notes: string[]): string {
  return normalizePitchClasses(notes).join('|');
}
function combinationsOfSize<T>(items: T[], size: ExactSubsetSize): T[][] {
  if (size === 1) return items.map((item) => [item]);
  if (size === 2) {
    const out: T[][] = [];
    for (let i = 0; i < items.length - 1; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        out.push([items[i], items[j]]);
      }
    }
    return out;
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length - 2; i += 1) {
    for (let j = i + 1; j < items.length - 1; j += 1) {
      for (let k = j + 1; k < items.length; k += 1) {
        out.push([items[i], items[j], items[k]]);
      }
    }
  }
  return out;
}
function subsetPitchClasses(pcs: string[], size: ExactSubsetSize): string[][] {
  const deduped = normalizePitchClasses(pcs);
  const byKey = new Map<string, string[]>();
  combinationsOfSize(deduped, size).forEach((subset) => {
    const normalizedSubset = normalizePitchClasses(subset);
    byKey.set(normalizedSubset.join('|'), normalizedSubset);
  });
  return [...byKey.values()];
}
function exactLevelForSize(size: ExactSubsetSize): ExactGeometryLevel {
  if (size === 1) return 'vertex';
  if (size === 2) return 'edge';
  return 'face';
}
function exactLevelLabel(level: ExactGeometryLevel | null): string {
  if (level === 'vertex') return 'point';
  if (level === 'edge') return 'edge';
  if (level === 'face') return 'triangle';
  return 'match';
}
function literalEventPitchClasses(event: DemoEvent): string[] {
  const notePcs = normalizePitchClasses(event.notes);
  if (notePcs.length) return notePcs;
  if (event.analysis?.pcs?.length) return normalizePitchClasses(event.analysis.pcs);
  return normalizePitchClasses(event.harmony);
}
function manualSelectionLabel(level: ExactGeometryLevel, notes: string[]): string {
  const subject = level === 'vertex' ? 'Point' : level === 'edge' ? 'Edge' : 'Triangle';
  return `${subject}: ${notes.join(' · ')}`;
}
function buildIcosahedronEdges(): IcosahedronEdge[] {
  const edges = new Map<string, IcosahedronEdge>();
  FACES.forEach((face) => {
    ([[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as Array<[number, number]>).forEach(([left, right]) => {
      const vertices = left < right ? [left, right] : [right, left];
      const id = `${vertices[0]}-${vertices[1]}`;
      if (!edges.has(id)) edges.set(id, { id, vertices: [vertices[0], vertices[1]] });
    });
  });
  return [...edges.values()].sort((left, right) => left.vertices[0] - right.vertices[0] || left.vertices[1] - right.vertices[1]);
}
function buildTonnetzGeometry(triangles: TonnetzTri[]): TonnetzGeometry {
  const pointMap = new Map<string, TonnetzPoint>();
  const edgeMap = new Map<string, TonnetzEdge>();
  const faces = triangles.map((tri) => ({
    id: tri.id,
    notes: normalizePitchClasses(tri.notes),
    center: centroid2D(tri.points),
  }));

  triangles.forEach((tri) => {
    tri.points.forEach((point, index) => {
      const id = pointKey(point);
      if (!pointMap.has(id)) pointMap.set(id, { id, point, note: tri.notes[index] });
    });
    ([[0, 1], [1, 2], [2, 0]] as Array<[number, number]>).forEach(([left, right]) => {
      const leftPoint = tri.points[left];
      const rightPoint = tri.points[right];
      const pointIds = [pointKey(leftPoint), pointKey(rightPoint)].sort() as [string, string];
      const id = `${pointIds[0]}|${pointIds[1]}`;
      if (edgeMap.has(id)) return;
      edgeMap.set(id, {
        id,
        pointIds,
        notes: normalizePitchClasses([tri.notes[left], tri.notes[right]]),
        center: centroid2D([leftPoint, rightPoint]),
      });
    });
  });

  return {
    points: [...pointMap.values()].sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x),
    edges: [...edgeMap.values()].sort((left, right) => left.center.y - right.center.y || left.center.x - right.center.x),
    faces,
  };
}
const ICOSAHEDRON_EDGES = buildIcosahedronEdges();
const ICOSAHEDRON_EDGE_BY_ID = new Map(ICOSAHEDRON_EDGES.map((edge) => [edge.id, edge]));
const ICOSAHEDRON_FACE_CENTERS = FACES.map((face) => averageVec3(face.map((vertex) => RAW_VERTICES[vertex])));
const EMPTY_PROFILE = Array.from({ length: 12 }, () => 0);
const MIDI_EPSILON = 1e-4;
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
function distinctPitchClasses(notes: string[]): string[] {
  return [...new Set(notes.map(pitchClass))];
}
function emptyProfile(): number[] {
  return [...EMPTY_PROFILE];
}
function sumProfile(profile: number[]): number {
  return profile.reduce((total, value) => total + value, 0);
}
function normalizeProfile(profile: number[]): number[] {
  const total = sumProfile(profile);
  if (!total) return emptyProfile();
  return profile.map((value) => value / total);
}
function profileMass(profile: number[], pcs: string[]): number {
  return pcs.reduce((total, pc) => total + (profile[NOTES.indexOf(pc)] ?? 0), 0);
}
function combinationsOfThree<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length - 2; i += 1) {
    for (let j = i + 1; j < items.length - 1; j += 1) {
      for (let k = j + 1; k < items.length; k += 1) {
        out.push([items[i], items[j], items[k]]);
      }
    }
  }
  return out;
}
function triadSetScore(pcs: string[]): number {
  if (pcs.length < 3) return 0;
  const indices = pcs.map((pc) => NOTES.indexOf(pc));
  let best = -Infinity;
  indices.forEach((root) => {
    const intervals = indices
      .map((idx) => mod12(idx - root))
      .sort((a, b) => a - b)
      .filter((interval) => interval !== 0);
    const signature = intervals.join(',');
    const score = signature === '4,7' ? 30
      : signature === '3,7' ? 28
      : signature === '3,6' ? 24
      : signature === '4,8' ? 22
      : signature === '5,7' ? 10
      : signature === '2,7' ? 8
      : -12;
    if (score > best) best = score;
  });
  return best;
}
function bassPitchClass(notes: string[]): string | null {
  const parsed = notes.map((note) => {
    const match = note.match(/^([A-G]#?)(-?\d+)$/);
    if (!match) return null;
    return { pc: match[1], octave: Number(match[2]) };
  }).filter((item): item is { pc: string; octave: number } => item !== null);
  if (!parsed.length) return null;
  parsed.sort((a, b) => a.octave - b.octave || NOTES.indexOf(a.pc) - NOTES.indexOf(b.pc));
  return parsed[0].pc;
}
function reduceToTriadicCore(
  pcs: string[],
  attackPcs: string[],
  bassPc: string | null,
  profile: number[] = emptyProfile(),
  attackProfile: number[] = emptyProfile(),
): { corePcs: string[]; colorPcs: string[]; confidence: number; ambiguity: number; reasoning: string[] } {
  if (!pcs.length) return { corePcs: [], colorPcs: [], confidence: 0, ambiguity: 1, reasoning: ['No pitch classes available'] };
  if (pcs.length <= 3) {
    const baseConfidence = clamp01(0.54 + (profileMass(normalizeProfile(profile), pcs) * 0.4));
    return {
      corePcs: pcs,
      colorPcs: [],
      confidence: baseConfidence,
      ambiguity: clamp01(1 - baseConfidence),
      reasoning: [`Direct core from ${pcs.join(' · ')}`],
    };
  }
  const candidates = combinationsOfThree(pcs);
  const scored = candidates.map((candidate) => {
    const normalizedProfile = normalizeProfile(profile);
    const normalizedAttack = normalizeProfile(attackProfile);
    const harmonicMass = profileMass(normalizedProfile, candidate);
    const attackMass = profileMass(normalizedAttack, candidate);
    const score = (triadSetScore(candidate) * 3.6)
      + (harmonicMass * 240)
      + (attackMass * 90)
      + (bassPc && candidate.includes(bassPc) ? 42 : 0)
      + (commonTones(candidate, attackPcs) * 14);
    return { pcs: candidate, score, harmonicMass, attackMass };
  }).sort((left, right) => right.score - left.score);
  const best = scored[0] ?? { pcs: pcs.slice(0, 3), score: 0, harmonicMass: 0, attackMass: 0 };
  const second = scored[1] ?? null;
  const normalizedProfile = normalizeProfile(profile);
  const gap = second ? Math.max(0, best.score - second.score) : best.score;
  const confidence = clamp01(0.2 + (best.harmonicMass * 0.55) + (best.attackMass * 0.15) + (gap / 180));
  const ambiguity = second ? clamp01(1 - (gap / 160)) : 0;
  const colorThreshold = Math.max(0.08, (Math.max(...normalizedProfile, 0) || 0) * 0.26);
  const colorPcs = pcs.filter((pc) => !best.pcs.includes(pc) && (normalizedProfile[NOTES.indexOf(pc)] ?? 0) >= colorThreshold);
  const reasoning = [
    `Core ${best.pcs.join(' · ')} captured ${(best.harmonicMass * 100).toFixed(0)}% of weighted profile`,
    bassPc && best.pcs.includes(bassPc) ? `Bass ${bassPc} supported the selected triad` : 'Core chosen from weighted profile and attack salience',
  ];
  if (colorPcs.length) reasoning.push(`Color tones retained: ${colorPcs.join(' · ')}`);
  return { corePcs: best.pcs, colorPcs, confidence, ambiguity, reasoning };
}
function harmonyFeatures(event: DemoEvent): HarmonyFeatures {
  if (event.analysis) {
    return {
      pcs: event.analysis.pcs,
      corePcs: event.analysis.corePcs,
      colorPcs: event.analysis.colorPcs,
      attackPcs: event.analysis.attackPcs,
      bassPc: event.analysis.bassPc,
      profile: event.analysis.profile,
      attackProfile: event.analysis.attackProfile,
      totalWeight: event.analysis.totalWeight,
      confidence: event.analysis.confidence,
      ambiguity: event.analysis.ambiguity,
      reasoning: event.analysis.reasoning,
    };
  }
  const pcs = distinctPitchClasses(event.harmony);
  const attackPcs = distinctPitchClasses(event.notes);
  const bassPc = bassPitchClass(event.notes) ?? attackPcs[0] ?? pcs[0] ?? null;
  const profile = emptyProfile();
  pcs.forEach((pc) => { profile[NOTES.indexOf(pc)] = 1; });
  const attackProfile = emptyProfile();
  attackPcs.forEach((pc) => { attackProfile[NOTES.indexOf(pc)] = 1; });
  const reduced = reduceToTriadicCore(pcs, attackPcs, bassPc, profile, attackProfile);
  return {
    pcs,
    corePcs: reduced.corePcs,
    colorPcs: reduced.colorPcs,
    attackPcs,
    bassPc,
    profile: normalizeProfile(profile),
    attackProfile: normalizeProfile(attackProfile),
    totalWeight: pcs.length,
    confidence: reduced.confidence,
    ambiguity: reduced.ambiguity,
    reasoning: reduced.reasoning,
  };
}
function buildExactRule(geometryLabel: string, eventPcs: string[], subsetSize: ExactSubsetSize | null, matchCount: number): string {
  if (!eventPcs.length) return `No pitch classes are active on the ${geometryLabel}.`;
  if (subsetSize === null) return `No exact single notes, dyads, or triads from ${eventPcs.join(' · ')} appear on the ${geometryLabel}.`;
  const label = exactLevelLabel(exactLevelForSize(subsetSize));
  if (eventPcs.length <= 3) {
    return matchCount
      ? `Exact ${label} match for ${eventPcs.join(' · ')} on the ${geometryLabel}.`
      : `No exact ${label} match for ${eventPcs.join(' · ')} on the ${geometryLabel}.`;
  }
  return `${eventPcs.length} pitch classes are active, so the ${geometryLabel} shows every exact ${subsetSize}-note subset that exists there, using the largest exact subset size the geometry can represent.`;
}
function buildIcosahedronExactMatch(eventPcs: string[], noteMap: string[]): IcosahedronExactMatch {
  const inputPcs = normalizePitchClasses(eventPcs);
  if (!inputPcs.length) {
    return { inputPcs, subsetSize: null, level: null, subsetPcs: [], rule: 'No pitch classes are active on the icosahedron.', vertexIds: [], edgeIds: [], faceIds: [] };
  }

  const vertices = noteMap.map((note, index) => ({ id: index, key: pitchClassSetKey([note]), center: RAW_VERTICES[index] }));
  const edges = ICOSAHEDRON_EDGES.map((edge) => ({
    id: edge.id,
    key: pitchClassSetKey(edge.vertices.map((vertex) => noteMap[vertex])),
    center: averageVec3(edge.vertices.map((vertex) => RAW_VERTICES[vertex])),
  }));
  const faces = FACES.map((face, index) => ({
    id: index,
    key: pitchClassSetKey(face.map((vertex) => noteMap[vertex])),
    center: ICOSAHEDRON_FACE_CENTERS[index],
  }));

  const subsetsBySize = {
    1: subsetPitchClasses(inputPcs, 1),
    2: inputPcs.length >= 2 ? subsetPitchClasses(inputPcs, 2) : [],
    3: inputPcs.length >= 3 ? subsetPitchClasses(inputPcs, 3) : [],
  };
  const subsetKeysBySize = {
    1: new Set(subsetsBySize[1].map((subset) => subset.join('|'))),
    2: new Set(subsetsBySize[2].map((subset) => subset.join('|'))),
    3: new Set(subsetsBySize[3].map((subset) => subset.join('|'))),
  };
  const matchedVertices = vertices.filter((vertex) => subsetKeysBySize[1].has(vertex.key));
  const matchedEdges = edges.filter((edge) => subsetKeysBySize[2].has(edge.key));
  const matchedFaces = faces.filter((face) => subsetKeysBySize[3].has(face.key));
  const matchCounts = { 1: matchedVertices.length, 2: matchedEdges.length, 3: matchedFaces.length };

  let subsetSize: ExactSubsetSize | null = null;
  if (inputPcs.length <= 3) subsetSize = inputPcs.length as ExactSubsetSize;
  // For collections larger than a triad, keep the primary display literal by using
  // the largest exact subset size the geometry can draw: faces first, then edges, then points.
  else if (matchedFaces.length) subsetSize = 3;
  else if (matchedEdges.length) subsetSize = 2;
  else if (matchedVertices.length) subsetSize = 1;

  const level = subsetSize === null ? null : exactLevelForSize(subsetSize);
  const subsetPcs = subsetSize === null ? [] : subsetsBySize[subsetSize];
  const vertexIds = subsetSize === 1 ? matchedVertices.map((vertex) => vertex.id) : [];
  const edgeIds = subsetSize === 2 ? matchedEdges.map((edge) => edge.id) : [];
  const faceIds = subsetSize === 3 ? matchedFaces.map((face) => face.id) : [];

  return {
    inputPcs,
    subsetSize,
    level,
    subsetPcs,
    rule: buildExactRule('icosahedron', inputPcs, subsetSize, subsetSize === null ? 0 : matchCounts[subsetSize]),
    vertexIds,
    edgeIds,
    faceIds,
  };
}
function buildTonnetzExactMatch(eventPcs: string[], geometry: TonnetzGeometry): TonnetzExactMatch {
  const inputPcs = normalizePitchClasses(eventPcs);
  if (!inputPcs.length) {
    return { inputPcs, subsetSize: null, level: null, subsetPcs: [], rule: 'No pitch classes are active on the Tonnetz.', vertexIds: [], edgeIds: [], faceIds: [] };
  }

  const points = geometry.points.map((point) => ({ id: point.id, key: pitchClassSetKey([point.note]), center: point.point }));
  const edges = geometry.edges.map((edge) => ({ id: edge.id, key: pitchClassSetKey(edge.notes), center: edge.center }));
  const faces = geometry.faces.map((face) => ({ id: face.id, key: pitchClassSetKey(face.notes), center: face.center }));
  const subsetsBySize = {
    1: subsetPitchClasses(inputPcs, 1),
    2: inputPcs.length >= 2 ? subsetPitchClasses(inputPcs, 2) : [],
    3: inputPcs.length >= 3 ? subsetPitchClasses(inputPcs, 3) : [],
  };
  const subsetKeysBySize = {
    1: new Set(subsetsBySize[1].map((subset) => subset.join('|'))),
    2: new Set(subsetsBySize[2].map((subset) => subset.join('|'))),
    3: new Set(subsetsBySize[3].map((subset) => subset.join('|'))),
  };
  const matchedPoints = points.filter((point) => subsetKeysBySize[1].has(point.key));
  const matchedEdges = edges.filter((edge) => subsetKeysBySize[2].has(edge.key));
  const matchedFaces = faces.filter((face) => subsetKeysBySize[3].has(face.key));
  const matchCounts = { 1: matchedPoints.length, 2: matchedEdges.length, 3: matchedFaces.length };

  let subsetSize: ExactSubsetSize | null = null;
  if (inputPcs.length <= 3) subsetSize = inputPcs.length as ExactSubsetSize;
  // For collections larger than a triad, keep the primary display literal by using
  // the largest exact subset size the geometry can draw: faces first, then edges, then points.
  else if (matchedFaces.length) subsetSize = 3;
  else if (matchedEdges.length) subsetSize = 2;
  else if (matchedPoints.length) subsetSize = 1;

  const level = subsetSize === null ? null : exactLevelForSize(subsetSize);
  const subsetPcs = subsetSize === null ? [] : subsetsBySize[subsetSize];
  const vertexIds = subsetSize === 1 ? matchedPoints.map((point) => point.id) : [];
  const edgeIds = subsetSize === 2 ? matchedEdges.map((edge) => edge.id) : [];
  const faceIds = subsetSize === 3 ? matchedFaces.map((face) => face.id) : [];

  return {
    inputPcs,
    subsetSize,
    level,
    subsetPcs,
    rule: buildExactRule('Tonnetz', inputPcs, subsetSize, subsetSize === null ? 0 : matchCounts[subsetSize]),
    vertexIds,
    edgeIds,
    faceIds,
  };
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

function overlapDuration(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}
function metricPriority(time: number, bars: number | null): number {
  let weight = 1;
  if (bars !== null) {
    const fractionalBars = Math.abs(bars - Math.round(bars));
    if (fractionalBars < 0.05) weight += 0.22;
    else if (fractionalBars < 0.12) weight += 0.08;
  }
  const beatPhase = Math.abs((time % 0.5) - 0.25);
  if (beatPhase > 0.19) weight += 0.06;
  return weight;
}
function extractMidiControlEvents(midi: Midi): { controlEvents: MidiControlEvent[]; sustainWindows: SustainWindow[] } {
  const controlEvents: MidiControlEvent[] = [];
  const sustainWindows: SustainWindow[] = [];
  midi.tracks.forEach((track, trackIndex) => {
    const numericKeys = Object.keys(track.controlChanges ?? {}).filter((key) => /^\d+$/.test(key));
    numericKeys.forEach((key) => {
      const number = Number(key);
      (track.controlChanges[number] ?? []).forEach((cc) => {
        controlEvents.push({ track: trackIndex, number, name: cc.name ?? String(number), time: cc.time, value: cc.value });
      });
    });
    const sustain = [...(track.controlChanges[64] ?? [])].sort((left, right) => left.time - right.time);
    let openStart: number | null = null;
    sustain.forEach((cc) => {
      if (cc.value >= 0.5 && openStart === null) {
        openStart = cc.time;
      } else if (cc.value < 0.5 && openStart !== null) {
        sustainWindows.push({ track: trackIndex, start: openStart, end: cc.time });
        openStart = null;
      }
    });
    if (openStart !== null) sustainWindows.push({ track: trackIndex, start: openStart, end: midi.duration });
  });
  controlEvents.sort((left, right) => left.time - right.time || left.number - right.number || left.track - right.track);
  sustainWindows.sort((left, right) => left.start - right.start || left.track - right.track);
  return { controlEvents, sustainWindows };
}
function applySustainToNotes(notes: ScoreNote[], sustainWindows: SustainWindow[]): ScoreNote[] {
  return notes.map((note) => {
    const sustainEnd = sustainWindows.reduce((latest, window) => {
      if (window.track !== note.track) return latest;
      if (note.end < window.start - MIDI_EPSILON || note.end > window.end + MIDI_EPSILON) return latest;
      return Math.max(latest, window.end);
    }, note.end);
    return {
      ...note,
      sustainedUntil: sustainEnd,
      effectiveDuration: Math.max(note.duration, sustainEnd - note.time),
      end: sustainEnd,
    };
  });
}
function literalActiveNotes(notes: ScoreNote[]): string[] {
  const ordered = [...notes].sort((left, right) => left.midi - right.midi || left.time - right.time || left.track - right.track);
  return [...new Set(ordered.map((note) => note.name))];
}
function buildHarmonicDescriptor(notes: ScoreNote[], start: number, end: number): HarmonicDescriptor {
  const duration = Math.max(0.04, end - start);
  const activeNotes = notes.filter((note) => overlapDuration(start, end, note.time, note.end) > MIDI_EPSILON);
  if (!activeNotes.length) {
    return {
      weightedPcs: [],
      pcs: [],
      corePcs: [],
      colorPcs: [],
      attackPcs: [],
      bassPc: null,
      profile: emptyProfile(),
      attackProfile: emptyProfile(),
      totalWeight: 0,
      confidence: 0,
      ambiguity: 1,
      reasoning: ['No active notes in this segment'],
    };
  }

  const sortedByPitch = [...activeNotes].sort((left, right) => left.midi - right.midi || left.time - right.time);
  const lowestMidi = sortedByPitch[0]?.midi ?? 60;
  const noteStats = new Map<string, WeightedPitchClass>();
  const rawProfile = emptyProfile();
  const rawAttackProfile = emptyProfile();
  const attackPcs: string[] = [];

  activeNotes.forEach((note) => {
    const overlap = overlapDuration(start, end, note.time, note.end);
    const age = Math.max(0, ((start + end) / 2) - note.time);
    const durationFactor = 0.45 + Math.log1p(note.effectiveDuration * 5);
    const velocityFactor = 0.65 + (note.velocity * 0.9);
    const bassFactor = note.midi === lowestMidi ? 1.6 : note.midi <= lowestMidi + 7 ? 1.2 : 1;
    const onsetSalience = 0.55 + (0.75 * Math.exp(-age / 0.45));
    const shortTonePenalty = note.effectiveDuration < 0.11 && overlap < duration * 0.7 ? 0.42 : 1;
    const recencyFactor = note.time >= start - MIDI_EPSILON && note.time <= end + MIDI_EPSILON ? 1.16 : 1;
    const metricFactor = note.metricWeight || metricPriority(note.time, note.bars);
    const weight = overlap * durationFactor * velocityFactor * bassFactor * onsetSalience * shortTonePenalty * recencyFactor * metricFactor;
    const pcIndex = NOTES.indexOf(note.pitchClass);
    rawProfile[pcIndex] += weight;
    if (Math.abs(note.time - start) <= 0.08 || (note.time >= start - MIDI_EPSILON && note.time < end + MIDI_EPSILON)) {
      rawAttackProfile[pcIndex] += weight * 1.15;
      attackPcs.push(note.pitchClass);
    }
    const current = noteStats.get(note.pitchClass) ?? {
      pc: note.pitchClass,
      weight: 0,
      attackWeight: 0,
      sustainWeight: 0,
      noteCount: 0,
      averageRegister: 0,
      strongestNote: null,
    };
    const nextWeight = current.weight + weight;
    noteStats.set(note.pitchClass, {
      pc: note.pitchClass,
      weight: nextWeight,
      attackWeight: current.attackWeight + (Math.abs(note.time - start) <= 0.08 ? weight : 0),
      sustainWeight: current.sustainWeight + weight,
      noteCount: current.noteCount + 1,
      averageRegister: ((current.averageRegister * current.noteCount) + note.octave) / (current.noteCount + 1),
      strongestNote: !current.strongestNote || weight > current.weight ? note.name : current.strongestNote,
    });
  });

  const profile = normalizeProfile(rawProfile);
  const attackProfile = normalizeProfile(rawAttackProfile);
  const weightedPcs = [...noteStats.values()].sort((left, right) => right.weight - left.weight || NOTES.indexOf(left.pc) - NOTES.indexOf(right.pc));
  const pcs = weightedPcs.map((item) => item.pc);
  const bassPc = sortedByPitch[0]?.pitchClass ?? null;
  const reduction = reduceToTriadicCore(pcs, [...new Set(attackPcs)], bassPc, rawProfile, rawAttackProfile);
  const reasoning = [
    `Weighted profile centered on ${weightedPcs.slice(0, 3).map((item) => item.pc).join(' · ') || '—'}`,
    ...reduction.reasoning,
  ];
  return {
    weightedPcs,
    pcs,
    corePcs: reduction.corePcs,
    colorPcs: reduction.colorPcs,
    attackPcs: distinctPitchClasses(attackPcs),
    bassPc,
    profile,
    attackProfile,
    totalWeight: sumProfile(rawProfile),
    confidence: reduction.confidence,
    ambiguity: reduction.ambiguity,
    reasoning,
  };
}
function buildEventsFromMidiNotes(notes: ScoreNote[]): { events: DemoEvent[]; eventTimes: number[]; atomicSliceCount: number } {
  if (!notes.length) return { events: [], eventTimes: [], atomicSliceCount: 0 };
  const timePoints = [...new Set(notes.flatMap((note) => [Number(note.time.toFixed(4)), Number(note.end.toFixed(4))]))].sort((left, right) => left - right);
  const atomicSlices = timePoints.slice(0, -1).map((start, index) => {
    const end = timePoints[index + 1];
    if (end - start <= MIDI_EPSILON) return null;
    const overlappingNotes = notes.filter((note) => overlapDuration(start, end, note.time, note.end) > MIDI_EPSILON);
    if (!overlappingNotes.length) return null;
    const activeNotes = literalActiveNotes(overlappingNotes);
    const harmony = normalizePitchClasses(overlappingNotes.map((note) => note.pitchClass));
    return {
      start,
      end,
      activeNotes,
      harmony,
      noteKey: activeNotes.join('|'),
      harmonyKey: harmony.join('|'),
    };
  }).filter((slice): slice is {
    start: number;
    end: number;
    activeNotes: string[];
    harmony: string[];
    noteKey: string;
    harmonyKey: string;
  } => slice !== null);
  if (!atomicSlices.length) return { events: [], eventTimes: [], atomicSliceCount: 0 };

  const mergedSlices = atomicSlices.reduce<Array<{
    start: number;
    end: number;
    activeNotes: string[];
    harmony: string[];
    noteKey: string;
    harmonyKey: string;
  }>>((acc, slice) => {
    const previous = acc[acc.length - 1];
    // Merge adjacent atomic slices when the literal active note-state is unchanged.
    // This keeps the display exact while removing zero-information boundaries that cause flicker.
    if (previous && previous.noteKey === slice.noteKey && previous.harmonyKey === slice.harmonyKey) {
      previous.end = slice.end;
      return acc;
    }
    acc.push({ ...slice });
    return acc;
  }, []);

  const events = mergedSlices.map((slice) => {
    const overlappingNotes = notes.filter((note) => overlapDuration(slice.start, slice.end, note.time, note.end) > MIDI_EPSILON);
    const descriptor = buildHarmonicDescriptor(overlappingNotes, slice.start, slice.end);
    return {
      notes: slice.activeNotes.length ? slice.activeNotes : noteVoicing(slice.harmony),
      ms: Math.max(1, (slice.end - slice.start) * 1000),
      harmony: slice.harmony,
      label: `t=${slice.start.toFixed(2)}s`,
      analysis: descriptor,
    };
  });
  const eventTimes = mergedSlices.map((slice) => slice.start);
  return { events, eventTimes, atomicSliceCount: atomicSlices.length };
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${path.replace(/^\/+/, '')}`;
}

function buildMidiPilotFromMidi(midi: Midi, fileName: string): MidiPilot {
  const { controlEvents, sustainWindows } = extractMidiControlEvents(midi);
  const parsedNotes: ScoreNote[] = midi.tracks.flatMap((track, ti) => track.notes.map((note) => ({
    midi: note.midi,
    name: note.name,
    noteName: note.pitch,
    pitchClass: note.pitch,
    octave: note.octave,
    register: note.octave,
    time: note.time,
    end: note.time + note.duration,
    sustainedUntil: note.time + note.duration,
    duration: note.duration,
    effectiveDuration: note.duration,
    velocity: note.velocity,
    track: ti,
    bars: Number.isFinite(note.bars) ? note.bars : null,
    metricWeight: metricPriority(note.time, Number.isFinite(note.bars) ? note.bars : null),
  }))).sort((left, right) => left.time - right.time || left.midi - right.midi || left.track - right.track);
  const sustainedNotes = applySustainToNotes(parsedNotes, sustainWindows);
  const built = buildEventsFromMidiNotes(sustainedNotes);
  return {
    fileName,
    bpm: midi.header.tempos.length ? midi.header.tempos[0].bpm : null,
    duration: midi.duration,
    noteCount: sustainedNotes.length,
    notes: sustainedNotes,
    events: built.events,
    eventTimes: built.eventTimes,
    sustainWindows,
    controlEvents,
    atomicSliceCount: built.atomicSliceCount,
  };
}

function buildEventTimelineMs(events: DemoEvent[]): { startTimesMs: number[]; totalMs: number } {
  if (!events.length) return { startTimesMs: [], totalMs: 0 };
  const startTimesMs: number[] = [];
  let totalMs = 0;
  events.forEach((event) => {
    startTimesMs.push(totalMs);
    totalMs += Math.max(1, event.ms);
  });
  return { startTimesMs, totalMs };
}

function eventIndexAtTime(timeMs: number, startTimesMs: number[]): number {
  if (!startTimesMs.length) return 0;
  let low = 0;
  let high = startTimesMs.length - 1;
  let idx = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (startTimesMs[mid] <= timeMs + 1e-6) {
      idx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return idx;
}

function countExactMatches(match: ExactGeometryMatch<string | number, string | number>): number {
  if (match.level === 'vertex') return match.vertexIds.length;
  if (match.level === 'edge') return match.edgeIds.length;
  if (match.level === 'face') return match.faceIds.length;
  return 0;
}
function summarizeExactMatch(match: ExactGeometryMatch<string | number, string | number>): string {
  if (!match.level) return 'No exact match';
  const count = countExactMatches(match);
  const label = exactLevelLabel(match.level);
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}
function formatSubsetSummary(subsets: string[][], limit = 4): string {
  if (!subsets.length) return '—';
  const visible = subsets.slice(0, limit).map((subset) => subset.join(' · '));
  return subsets.length > limit ? `${visible.join(' / ')} +${subsets.length - limit} more` : visible.join(' / ');
}
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
function formatClockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00.00';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - (minutes * 60);
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}
function slugify(value: string): string {
  return value.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'analysis';
}
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const DEMOS: Demo[] = [
  { id: 'pirates', composer: 'Klaus Badelt / Hans Zimmer', title: "He’s a Pirate", subtitle: 'Bundled MIDI demo', sourceLabel: 'Bundled MIDI demo', midiUrl: assetUrl('midi/pirates-hes-a-pirate.mid') },
  { id: 'titanic', composer: 'James Horner', title: 'My Heart Will Go On', subtitle: 'Bundled MIDI demo', sourceLabel: 'Bundled MIDI demo', midiUrl: assetUrl('midi/my-heart-will-go-on.mid') },
  { id: 'rivers', composer: 'Yiruma', title: 'Rivers Flow in You', subtitle: 'Bundled MIDI demo', sourceLabel: 'Bundled MIDI demo', midiUrl: assetUrl('midi/rivers-flow-in-you.mid') },
  { id: RACH_ID, composer: 'Sergei Rachmaninoff', title: 'Prelude in C-sharp minor, Op. 3 No. 2', subtitle: 'Bundled MIDI demo', sourceLabel: 'Bundled MIDI demo', midiUrl: assetUrl('midi/rachmaninoff-prelude-op3-no2.mid') },
  { id: 'gladiator', composer: 'Hans Zimmer / Lisa Gerrard', title: 'Now We Are Free', subtitle: 'Bundled MIDI demo', sourceLabel: 'Bundled MIDI demo', midiUrl: assetUrl('midi/now-we-are-free.mid') },
];

function useSampledPiano() {
  const samplerRef = useRef<Tone.Sampler | null>(null);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const startedRef = useRef(false);
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

  const ensureStarted = useCallback(async () => {
    if (startedRef.current && Tone.getContext().state === 'running') return;
    await Tone.start();
    startedRef.current = true;
  }, []);
  const playChord = useCallback(async (notes: string[], ms: number) => {
    await ensureStarted();
    const voiced = manualChordVoicing(notes);
    if (samplerReady && samplerRef.current) {
      samplerRef.current.triggerAttackRelease(voiced, Math.max(0.08, ms / 1000), undefined, 0.92);
      return;
    }
    if (synthRef.current) {
      synthRef.current.triggerAttackRelease(voiced, Math.max(0.08, ms / 1000), undefined, 0.84);
    }
  }, [ensureStarted, samplerReady]);
  const scheduleNote = useCallback((note: string, duration: number, time: number, velocity: number) => {
    if (samplerReady && samplerRef.current) {
      samplerRef.current.triggerAttackRelease(note, Math.max(0.03, duration), time, Math.min(1, Math.max(0.15, velocity)));
      return;
    }
    synthRef.current?.triggerAttackRelease(note, Math.max(0.03, duration), time, Math.min(1, Math.max(0.15, velocity)));
  }, [samplerReady]);
  const stop = useCallback(() => { samplerRef.current?.releaseAll(); synthRef.current?.releaseAll(); }, []);
  return useMemo(() => ({ playChord, scheduleNote, stop, samplerReady, ensureStarted }), [playChord, scheduleNote, stop, samplerReady, ensureStarted]);
}

const SECTION_TONES: Record<SectionTone, { border: string; glow: string; badge: string }> = {
  sky: { border: 'border-sky-300/18', glow: 'from-sky-300/16 via-sky-200/6 to-transparent', badge: 'border-sky-300/18 bg-sky-300/12 text-sky-100' },
  violet: { border: 'border-violet-300/18', glow: 'from-violet-300/16 via-fuchsia-200/6 to-transparent', badge: 'border-violet-300/18 bg-violet-300/12 text-violet-100' },
  amber: { border: 'border-amber-300/18', glow: 'from-amber-300/14 via-amber-200/5 to-transparent', badge: 'border-amber-300/18 bg-amber-300/12 text-amber-100' },
  emerald: { border: 'border-emerald-300/18', glow: 'from-emerald-300/14 via-emerald-200/5 to-transparent', badge: 'border-emerald-300/18 bg-emerald-300/12 text-emerald-100' },
};

function Section({ title, subtitle, children, icon, eyebrow, tone = 'sky' }: SectionProps) {
  const theme = SECTION_TONES[tone];
  return (
    <div className={`relative overflow-hidden rounded-[28px] border bg-white/[0.045] p-6 shadow-xl backdrop-blur-md ${theme.border} sm:p-7`}>
      <div className={`pointer-events-none absolute inset-x-8 top-12 h-28 rounded-full bg-gradient-to-r ${theme.glow} opacity-90 blur-3xl`} />
      <div className="relative pb-6 sm:pb-7">
        {eyebrow ? <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">{eyebrow}</div> : null}
        <div className="flex items-center gap-2">
          {icon ? <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm ${theme.badge}`}>{icon}</span> : null}
          <div className="text-lg font-medium text-white">{title}</div>
        </div>
        {subtitle ? <div className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{subtitle}</div> : null}
      </div>
      <div className="relative flex flex-col gap-5 border-t border-white/6 pt-6 sm:gap-6 sm:pt-7">{children}</div>
    </div>
  );
}
function MetricCard({ title, top, bottom }: MetricProps) {
  return <div className="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] p-5 text-sm shadow-lg"><div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div><div className="text-slate-100">{top}</div><div className="mt-2 text-slate-300">{bottom}</div></div>;
}

function AnalysisTimeline(props: { events: AnalyzedEvent[]; selectedIndex: number; playbackTimeSec: number; onSelect: (index: number) => void; }) {
  const totalDurationSec = useMemo(() => props.events.reduce((sum, event) => sum + event.durationSec, 0), [props.events]);
  const markerPercent = totalDurationSec ? clamp01(props.playbackTimeSec / totalDurationSec) * 100 : 0;
  const selectedEvent = props.events[props.selectedIndex] ?? null;

  if (!props.events.length) {
    return <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.035] px-4 py-6 text-sm text-slate-400">No analysis events are available yet.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 shadow-inner">
        <div className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-emerald-300/90 shadow-[0_0_12px_rgba(110,231,183,0.55)]" style={{ left: `calc(${markerPercent}% - 1px)` }} />
        <div className="flex h-16 items-stretch">
          {props.events.map((event) => {
            const isSelected = event.index === props.selectedIndex;
            return (
              <button
                key={`timeline-${event.index}`}
                type="button"
                onClick={() => props.onSelect(event.index)}
                style={{ flex: `${Math.max(event.durationSec, 0.05)} 1 0` }}
                className={`relative min-w-[6px] border-r border-slate-950/80 transition ${isSelected ? 'bg-fuchsia-400/75 hover:bg-fuchsia-300/80' : 'bg-sky-300/30 hover:bg-sky-300/45'}`}
                aria-label={`Jump to event ${event.index + 1} at ${formatClockTime(event.startSec)}`}
                title={`Event ${event.index + 1} • ${formatClockTime(event.startSec)} • ${event.literalPcs.join(' · ')}`}
              >
                {isSelected ? <span className="absolute inset-y-0 left-0 right-0 border border-white/40" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
        <span>0:00.00</span>
        <span>{formatClockTime(totalDurationSec)}</span>
      </div>
      {selectedEvent ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <span className="text-slate-100">Event {selectedEvent.index + 1}</span> at {formatClockTime(selectedEvent.startSec)} with {selectedEvent.literalPcs.join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

const IcosahedronView = React.memo(function IcosahedronView(props: {
  projected: Proj[];
  faceCentroidsMap: Record<number, Proj>;
  exactMatch: IcosahedronExactMatch | null;
  manualSelection: IcosahedronManualSelection | null;
  showNumbers: boolean;
  onVertexClick: (vertexIndex: number) => void;
  onEdgeClick: (edgeId: string) => void;
  onFaceClick: (faceIndex: number) => void;
  noteMap: string[];
  rotX: number;
  rotY: number;
  setRotX: React.Dispatch<React.SetStateAction<number>>;
  setRotY: React.Dispatch<React.SetStateAction<number>>;
}) {
  const exactFaceSet = useMemo(() => new Set(props.exactMatch?.faceIds ?? []), [props.exactMatch]);
  const exactEdgeSet = useMemo(() => new Set(props.exactMatch?.edgeIds ?? []), [props.exactMatch]);
  const exactVertexSet = useMemo(() => new Set(props.exactMatch?.vertexIds ?? []), [props.exactMatch]);
  const drawOrder = useMemo(() => [...FACES.keys()].sort((a, b) => props.faceCentroidsMap[a].z - props.faceCentroidsMap[b].z), [props.faceCentroidsMap]);
  const vertexOrder = useMemo(() => [...RAW_VERTICES.keys()].sort((a, b) => props.projected[a].z - props.projected[b].z), [props.projected]);
  const edgeOrder = useMemo(() => [...ICOSAHEDRON_EDGES].sort((left, right) => {
    const leftZ = (props.projected[left.vertices[0]].z + props.projected[left.vertices[1]].z) / 2;
    const rightZ = (props.projected[right.vertices[0]].z + props.projected[right.vertices[1]].z) / 2;
    return leftZ - rightZ;
  }), [props.projected]);
  const manualFaceSet = useMemo(() => new Set(props.manualSelection?.level === 'face' ? [props.manualSelection.faceId] : []), [props.manualSelection]);
  const manualEdgeSet = useMemo(() => new Set(props.manualSelection?.level === 'edge' ? [props.manualSelection.edgeId] : []), [props.manualSelection]);
  const manualVertexSet = useMemo(() => new Set(props.manualSelection?.level === 'vertex' ? [props.manualSelection.vertexId] : []), [props.manualSelection]);
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0, rx: props.rotX, ry: props.rotY });
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => { dragRef.current = { active: true, moved: false, x: e.clientX, y: e.clientY, rx: props.rotX, ry: props.rotY }; };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    props.setRotY(dragRef.current.ry + dx * 0.008);
    props.setRotX(Math.max(-1.35, Math.min(1.35, dragRef.current.rx + dy * 0.008)));
  };
  const onPointerUp = () => { dragRef.current.active = false; };
  return (
    <div className="relative w-full aspect-square overflow-hidden rounded-[28px] border border-sky-200/10 bg-slate-950/90 shadow-[0_24px_80px_rgba(2,6,23,0.55)] touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-center justify-between">
        <div className="rounded-full border border-sky-200/12 bg-slate-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-sky-100/90 backdrop-blur-md">3D harmonic surface</div>
        <div className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300 backdrop-blur-md">Drag to rotate</div>
      </div>
      <svg viewBox="-400 -400 800 800" className="w-full h-full select-none">
        <defs>
          <radialGradient id="icoGlow" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.18)" />
            <stop offset="45%" stopColor="rgba(168,85,247,0.12)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.98)" />
          </radialGradient>
        </defs>
        <rect x="-400" y="-400" width="800" height="800" fill="url(#icoGlow)" />
        <circle cx="-210" cy="-200" r="170" fill="rgba(14,165,233,0.05)" />
        <circle cx="250" cy="220" r="200" fill="rgba(244,114,182,0.05)" />
        {drawOrder.map((faceIndex) => {
          const pts = FACES[faceIndex].map((i) => `${props.projected[i].x},${props.projected[i].y}`).join(' ');
          const exact = exactFaceSet.has(faceIndex);
          const manual = manualFaceSet.has(faceIndex);
          const stroke = manual ? 'rgba(244,114,182,0.96)' : exact ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.45)';
          const strokeWidth = manual ? 3 : exact ? 2.1 : 1.5;
          const fill = manual ? 'rgba(244,114,182,0.28)' : exact ? 'rgba(251,191,36,0.86)' : 'rgba(255,255,255,0.10)';
          return (
            <polygon
              key={`face-${faceIndex}`}
              points={pts}
              onClick={(event) => {
                event.stopPropagation();
                if (dragRef.current.moved) return;
                props.onFaceClick(faceIndex);
              }}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              className="cursor-pointer transition-all duration-150 hover:fill-fuchsia-300/35"
            />
          );
        })}
        {drawOrder.map((faceIndex) => {
          const face = FACES[faceIndex];
          const pts = [face[0], face[1], face[2], face[0]].map((i) => `${props.projected[i].x},${props.projected[i].y}`).join(' ');
          return <polyline key={`edge-${faceIndex}`} points={pts} fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.4" pointerEvents="none" />;
        })}
        {edgeOrder.map((edge) => {
          const [left, right] = edge.vertices;
          return (
            <line
              key={`edge-hit-${edge.id}`}
              x1={props.projected[left].x}
              y1={props.projected[left].y}
              x2={props.projected[right].x}
              y2={props.projected[right].y}
              stroke="transparent"
              strokeWidth={18}
              strokeLinecap="round"
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                if (dragRef.current.moved) return;
                props.onEdgeClick(edge.id);
              }}
            />
          );
        })}
        {edgeOrder.map((edge) => {
          const exact = exactEdgeSet.has(edge.id);
          const manual = manualEdgeSet.has(edge.id);
          if (!exact && !manual) return null;
          const [left, right] = edge.vertices;
          return (
            <line
              key={`edge-active-${edge.id}`}
              x1={props.projected[left].x}
              y1={props.projected[left].y}
              x2={props.projected[right].x}
              y2={props.projected[right].y}
              stroke={manual ? 'rgba(244,114,182,0.96)' : '#67e8f9'}
              strokeWidth={manual ? 6.8 : 4.6}
              strokeLinecap="round"
              opacity={0.98}
              pointerEvents="none"
            />
          );
        })}
        {vertexOrder.map((i) => {
          const p = props.projected[i];
          const exact = exactVertexSet.has(i);
          const manual = manualVertexSet.has(i);
          const active = exact || manual;
          const r = (active ? 15 : 12) + Math.max(0, p.z) * 2;
          const fill = manual ? '#f472b6' : exact ? '#34d399' : '#111827';
          const stroke = manual ? '#fdf2f8' : exact ? '#fef3c7' : '#e2e8f0';
          return (
            <g key={`vertex-${i}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={Math.max(r + 7, 20)}
                fill="transparent"
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  if (dragRef.current.moved) return;
                  props.onVertexClick(i);
                }}
              />
              <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={stroke} strokeWidth={active ? 2.4 : 1.4} pointerEvents="none" />
              {props.showNumbers ? <text x={p.x} y={p.y - 18} textAnchor="middle" fontSize="11" fill="#cbd5e1" pointerEvents="none">{i + 1}</text> : null}
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fill="#f8fafc" pointerEvents="none">{props.noteMap[i]}</text>
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
        <div className="inline-flex rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">Note = point, dyad = edge, triad = triangle. Multiple exact matches can appear at once.</div>
      </div>
    </div>
  );
});

const TonnetzView = React.memo(function TonnetzView(props: {
  triangles: TonnetzTri[];
  geometry: TonnetzGeometry;
  pointLabels: Map<string, string>;
  exactMatch: TonnetzExactMatch | null;
  manualSelection: TonnetzManualSelection | null;
  onVertexClick: (point: TonnetzPoint, noteLabel: string) => void;
  onEdgeClick: (edge: TonnetzEdge, noteLabels: string[]) => void;
  onTriangleClick: (tri: TonnetzTri) => void;
}) {
  const bounds = useMemo(() => getTonnetzBounds(props.triangles), [props.triangles]);
  const centers = useMemo(() => new Map(props.triangles.map((tri) => [tri.id, {
    x: (tri.points[0].x + tri.points[1].x + tri.points[2].x) / 3,
    y: (tri.points[0].y + tri.points[1].y + tri.points[2].y) / 3,
  }])), [props.triangles]);
  const pointById = useMemo(() => new Map(props.geometry.points.map((point) => [point.id, point])), [props.geometry.points]);
  const exactFaceSet = useMemo(() => new Set(props.exactMatch?.faceIds ?? []), [props.exactMatch]);
  const exactEdgeSet = useMemo(() => new Set(props.exactMatch?.edgeIds ?? []), [props.exactMatch]);
  const exactPointSet = useMemo(() => new Set(props.exactMatch?.vertexIds ?? []), [props.exactMatch]);
  const manualFaceSet = useMemo(() => new Set(props.manualSelection?.level === 'face' ? [props.manualSelection.faceId] : []), [props.manualSelection]);
  const manualEdgeSet = useMemo(() => new Set(props.manualSelection?.level === 'edge' ? [props.manualSelection.edgeId] : []), [props.manualSelection]);
  const manualPointSet = useMemo(() => new Set(props.manualSelection?.level === 'vertex' ? [props.manualSelection.vertexId] : []), [props.manualSelection]);
  const padding = 44;
  const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-violet-200/10 bg-slate-950/90 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-center justify-between">
        <div className="rounded-full border border-violet-200/12 bg-slate-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-violet-100/90 backdrop-blur-md">Planar relation map</div>
        <div className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300 backdrop-blur-md">Click to audition</div>
      </div>
      <div className="h-[640px] w-full bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.18),transparent_35%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.18),transparent_35%)]">
        <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
          <rect x={bounds.minX - padding} y={bounds.minY - padding} width={bounds.width + padding * 2} height={bounds.height + padding * 2} rx="28" fill="#0f172a" />
          {props.triangles.map((tri) => {
            const pts = tri.points.map((p) => `${p.x},${p.y}`).join(' ');
            const exact = exactFaceSet.has(tri.id);
            const manual = manualFaceSet.has(tri.id);
            const stroke = manual ? 'rgba(244,114,182,0.96)' : exact ? 'rgba(255,255,255,0.76)' : 'rgba(255,255,255,0.35)';
            const strokeWidth = manual ? 3 : exact ? 2.1 : 1.4;
            const fill = manual ? 'rgba(244,114,182,0.28)' : exact ? 'rgba(251,191,36,0.86)' : tri.kind === 'up' ? 'rgba(99,102,241,0.16)' : 'rgba(34,197,94,0.14)';
            const center = centers.get(tri.id);
            const cx = center?.x ?? 0;
            const cy = center?.y ?? 0;
            return (
              <g key={tri.id}>
                <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={strokeWidth} onClick={() => props.onTriangleClick(tri)} className="cursor-pointer" />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill="#f8fafc" pointerEvents="none">{tri.notes.join(' · ')}</text>
              </g>
            );
          })}
          {props.geometry.edges.map((edge) => {
            const exact = exactEdgeSet.has(edge.id);
            const manual = manualEdgeSet.has(edge.id);
            if (!exact && !manual) return null;
            const left = pointById.get(edge.pointIds[0]);
            const right = pointById.get(edge.pointIds[1]);
            if (!left || !right) return null;
            return <line key={`edge-active-${edge.id}`} x1={left.point.x} y1={left.point.y} x2={right.point.x} y2={right.point.y} stroke={manual ? 'rgba(244,114,182,0.96)' : '#67e8f9'} strokeWidth={manual ? 6.5 : 5} strokeLinecap="round" opacity={0.98} pointerEvents="none" />;
          })}
          {props.geometry.edges.map((edge) => {
            const left = pointById.get(edge.pointIds[0]);
            const right = pointById.get(edge.pointIds[1]);
            if (!left || !right) return null;
            const labels = edge.pointIds.map((pointId) => props.pointLabels.get(pointId) ?? pointById.get(pointId)?.note ?? '').filter(Boolean);
            return <line key={`edge-hit-${edge.id}`} x1={left.point.x} y1={left.point.y} x2={right.point.x} y2={right.point.y} stroke="transparent" strokeWidth={18} strokeLinecap="round" className="cursor-pointer" onClick={() => props.onEdgeClick(edge, labels)} />;
          })}
          {props.geometry.points.map((point) => {
            const exact = exactPointSet.has(point.id);
            const manual = manualPointSet.has(point.id);
            const active = exact || manual;
            const label = props.pointLabels.get(point.id) ?? point.note;
            return (
              <g key={`point-${point.id}`}>
                <circle cx={point.point.x} cy={point.point.y} r={14} fill="transparent" className="cursor-pointer" onClick={() => props.onVertexClick(point, label)} />
                <circle cx={point.point.x} cy={point.point.y} r={active ? 9 : 5.5} fill={manual ? '#f472b6' : active ? '#34d399' : 'rgba(15,23,42,0.96)'} stroke={manual ? '#fdf2f8' : active ? '#fef3c7' : 'rgba(226,232,240,0.65)'} strokeWidth={active ? 2.1 : 1.1} pointerEvents="none" />
                <text x={point.point.x} y={point.point.y - 11} textAnchor="middle" fontSize="9" fill="#cbd5e1" pointerEvents="none">{label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
        <div className="inline-flex rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">Note = point, dyad = edge, triad = triangle. Multiple exact matches can appear at once.</div>
      </div>
    </div>
  );
});

export default function MusicalIcosahedraLab() {
  const [noteMap, setNoteMap] = useState<string[]>(NOTES.slice());
  const [compareSymmetry, setCompareSymmetry] = useState(false);
  const [selectedDemoId, setSelectedDemoId] = useState<string>(DEMOS[0].id);
  const [analysisMode, setAnalysisMode] = useState<AnalysisFollowMode>('follow');
  const [showNumbers, setShowNumbers] = useState(true);
  const [rotX, setRotX] = useState(DEFAULT_ROT_X);
  const [rotY, setRotY] = useState(DEFAULT_ROT_Y);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempoScale, setTempoScale] = useState(1);
  const [manualIcosahedronSelection, setManualIcosahedronSelection] = useState<IcosahedronManualSelection | null>(null);
  const [manualTonnetzSelection, setManualTonnetzSelection] = useState<TonnetzManualSelection | null>(null);
  const [tonnetzMode, setTonnetzMode] = useState<'chromatic' | 'fifths'>('chromatic');
  const [currentSec, setCurrentSec] = useState(0);
  const [demoPilots, setDemoPilots] = useState<Record<string, MidiPilot>>({});
  const [demoErrors, setDemoErrors] = useState<Record<string, string>>({});
  const [midiPilot, setMidiPilot] = useState<MidiPilot | null>(null);
  const [useMidiGeometry, setUseMidiGeometry] = useState(false);
  const [midiPlaying, setMidiPlaying] = useState(false);
  const [midiProgressSec, setMidiProgressSec] = useState(0);
  const [midiError, setMidiError] = useState<string>('');
  const { playChord, scheduleNote, stop: stopPiano, samplerReady, ensureStarted } = useSampledPiano();
  const currentSecRef = useRef(0);
  const midiProgressRef = useRef(0);
  const tempoScaleRef = useRef(tempoScale);
  const previousTempoScaleRef = useRef(tempoScale);
  const demoCacheRef = useRef<Record<string, MidiPilot>>({});
  const demoLoadPromisesRef = useRef(new Map<string, Promise<void>>());
  const transportSourceRef = useRef<PlaybackSource | null>(null);
  const transportPilotRef = useRef<MidiPilot | null>(null);
  const transportStartAudioTimeRef = useRef<number | null>(null);
  const transportOffsetRef = useRef(0);
  const transportRateRef = useRef(1);
  const transportPlayingRef = useRef(false);

  const selectedDemo = useMemo(() => DEMOS.find((d) => d.id === selectedDemoId) || DEMOS[0], [selectedDemoId]);
  const selectedDemoPilot = demoPilots[selectedDemo.id] ?? null;
  const selectedDemoError = demoErrors[selectedDemo.id] ?? '';
  const selectedDemoLoading = !selectedDemoPilot && !selectedDemoError;
  const activeMap = useMemo(() => compareSymmetry ? mutate(noteMap) : noteMap, [compareSymmetry, noteMap]);
  const projected = useMemo(() => RAW_VERTICES.map((v) => projectPoint(v, rotX, rotY, FIXED_ZOOM)), [rotX, rotY]);
  const faceCentroidsMap = useMemo(() => { const out: Record<number, Proj> = {}; FACES.forEach((_, i) => { out[i] = faceCentroid(i, projected); }); return out; }, [projected]);
  const tonnetzTrianglesRaw = useMemo(() => buildTonnetzTriangles(), []);
  const tonnetzGeometry = useMemo(() => buildTonnetzGeometry(tonnetzTrianglesRaw), [tonnetzTrianglesRaw]);
  const tonnetzTriangles = useMemo(() => tonnetzTrianglesRaw.map((tri) => ({ ...tri, notes: tri.notes.map((n) => tonnetzMode === 'fifths' ? FIFTHS[NOTES.indexOf(n)] : n) })), [tonnetzTrianglesRaw, tonnetzMode]);
  const tonnetzPointLabels = useMemo(() => new Map(tonnetzGeometry.points.map((point) => [point.id, tonnetzMode === 'fifths' ? FIFTHS[NOTES.indexOf(point.note)] : point.note])), [tonnetzGeometry, tonnetzMode]);
  const tonnetzPointById = useMemo(() => new Map(tonnetzGeometry.points.map((point) => [point.id, point])), [tonnetzGeometry]);
  const tonnetzEdgeById = useMemo(() => new Map(tonnetzGeometry.edges.map((edge) => [edge.id, edge])), [tonnetzGeometry]);
  const tonnetzTriangleById = useMemo(() => new Map(tonnetzTriangles.map((tri) => [tri.id, tri])), [tonnetzTriangles]);
  const manualIcosahedronSummary = useMemo(() => {
    if (!manualIcosahedronSelection) return null;
    if (manualIcosahedronSelection.level === 'vertex') return manualSelectionLabel('vertex', [activeMap[manualIcosahedronSelection.vertexId]]);
    if (manualIcosahedronSelection.level === 'edge') {
      const edge = ICOSAHEDRON_EDGE_BY_ID.get(manualIcosahedronSelection.edgeId);
      if (!edge) return null;
      return manualSelectionLabel('edge', normalizePitchClasses(edge.vertices.map((vertex) => activeMap[vertex])));
    }
    return manualSelectionLabel('face', normalizePitchClasses(chordForFace(manualIcosahedronSelection.faceId, activeMap)));
  }, [manualIcosahedronSelection, activeMap]);
  const manualTonnetzSummary = useMemo(() => {
    if (!manualTonnetzSelection) return null;
    if (manualTonnetzSelection.level === 'vertex') {
      const point = tonnetzPointById.get(manualTonnetzSelection.vertexId);
      if (!point) return null;
      return manualSelectionLabel('vertex', [tonnetzPointLabels.get(point.id) ?? point.note]);
    }
    if (manualTonnetzSelection.level === 'edge') {
      const edge = tonnetzEdgeById.get(manualTonnetzSelection.edgeId);
      if (!edge) return null;
      const notes = edge.pointIds.map((pointId) => tonnetzPointLabels.get(pointId) ?? tonnetzPointById.get(pointId)?.note ?? '').filter(Boolean);
      return manualSelectionLabel('edge', normalizePitchClasses(notes));
    }
    const tri = tonnetzTriangleById.get(manualTonnetzSelection.faceId);
    if (!tri) return null;
    return manualSelectionLabel('face', normalizePitchClasses(tri.notes));
  }, [manualTonnetzSelection, tonnetzPointById, tonnetzPointLabels, tonnetzEdgeById, tonnetzTriangleById]);

  const midiGeometryAvailable = useMidiGeometry && midiPilot !== null;
  const geometrySource = useMemo<'demo' | 'midi'>(() => {
    if (midiPlaying && midiGeometryAvailable) return 'midi';
    if (isPlaying) return 'demo';
    if (midiGeometryAvailable) return 'midi';
    return 'demo';
  }, [midiPlaying, midiGeometryAvailable, isPlaying]);
  const analysisPilot = geometrySource === 'midi' ? midiPilot : selectedDemoPilot;
  const analysisEvents = useMemo(() => analysisPilot?.events ?? [], [analysisPilot]);
  const analysisEventTimes = useMemo(() => analysisPilot?.eventTimes ?? [], [analysisPilot]);
  const analysisTimeline = useMemo(() => buildEventTimelineMs(analysisEvents), [analysisEvents]);

  const demoAutoIndex = useMemo(() => {
    if (!(geometrySource === 'demo' && selectedDemoPilot && isPlaying)) return currentIndex;
    if (!analysisEventTimes.length) return 0;
    return eventIndexAtTime(currentSec, analysisEventTimes);
  }, [geometrySource, selectedDemoPilot, isPlaying, currentIndex, analysisEventTimes, currentSec]);

  const midiAutoIndex = useMemo(() => {
    if (!(geometrySource === 'midi' && midiPilot)) return currentIndex;
    if (!analysisEventTimes.length) return 0;
    return eventIndexAtTime(midiProgressSec, analysisEventTimes);
  }, [geometrySource, midiPilot, analysisEventTimes, midiProgressSec, currentIndex]);

  const playbackIndex = geometrySource === 'midi' && midiPilot ? midiAutoIndex : demoAutoIndex;
  const effectiveIndex = analysisMode === 'freeze' ? currentIndex : playbackIndex;
  const stats = useMemo(() => summarizeProgression(analysisEvents.map((e) => e.harmony)), [analysisEvents]);
  const analyzedEvents = useMemo<AnalyzedEvent[]>(() => analysisEvents.map((event, idx) => {
    const startMs = analysisTimeline.startTimesMs[idx] ?? 0;
    const durationMs = Math.max(1, event.ms);
    const startSec = analysisEventTimes[idx] ?? (startMs / 1000);
    const previousEvent = idx > 0 ? analysisEvents[idx - 1] : null;
    const features = harmonyFeatures(event);
    const literalPcs = literalEventPitchClasses(event);
    return {
      index: idx,
      event,
      literalPcs,
      startMs,
      startSec,
      durationMs,
      durationSec: durationMs / 1000,
      features,
      icosahedronExact: buildIcosahedronExactMatch(literalPcs, activeMap),
      tonnetzExact: buildTonnetzExactMatch(literalPcs, tonnetzGeometry),
      commonToneScore: previousEvent ? commonTones(previousEvent.harmony, event.harmony) : null,
      voiceLeadingScore: previousEvent ? voiceLeadingProxy(previousEvent.harmony, event.harmony) : null,
      descriptorConfidence: features.confidence,
      descriptorAmbiguity: features.ambiguity,
    };
  }), [analysisEvents, analysisTimeline, analysisEventTimes, activeMap, tonnetzGeometry]);
  const currentAnalysis = analyzedEvents[effectiveIndex] ?? analyzedEvents[0] ?? null;
  const currentEvent = currentAnalysis?.event ?? { notes: [], ms: 0, harmony: [], label: '' };
  const currentLiteralPcs = currentAnalysis?.literalPcs ?? [];
  const literalDiffersFromContext = currentAnalysis ? pitchClassSetKey(currentLiteralPcs) !== pitchClassSetKey(currentEvent.harmony) : false;
  const playbackTimeSec = useMemo(() => {
    if (geometrySource === 'midi' && midiPilot) {
      if (midiPlaying) return midiProgressSec;
      return currentAnalysis?.startSec ?? midiProgressSec;
    }
    if (isPlaying) return currentSec;
    return currentAnalysis?.startSec ?? currentSec;
  }, [geometrySource, midiPilot, midiPlaying, midiProgressSec, currentAnalysis, isPlaying, currentSec]);
  const exportBaseName = useMemo(() => slugify(geometrySource === 'midi' && midiPilot ? midiPilot.fileName : `${selectedDemo.composer}-${selectedDemo.title}`), [geometrySource, midiPilot, selectedDemo]);

  useEffect(() => {
    currentSecRef.current = currentSec;
  }, [currentSec]);

  useEffect(() => {
    midiProgressRef.current = midiProgressSec;
  }, [midiProgressSec]);

  useEffect(() => {
    tempoScaleRef.current = tempoScale;
  }, [tempoScale]);

  useEffect(() => {
    setCurrentIndex((prev) => {
      if (!analysisEvents.length) return 0;
      return Math.max(0, Math.min(analysisEvents.length - 1, prev));
    });
  }, [analysisEvents.length]);

  const clearTransport = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    transportSourceRef.current = null;
    transportPilotRef.current = null;
    transportStartAudioTimeRef.current = null;
    transportOffsetRef.current = 0;
    transportRateRef.current = 1;
    transportPlayingRef.current = false;
    stopPiano();
  }, [stopPiano]);

  const getStoredProgress = useCallback((source: PlaybackSource) => (
    source === 'demo' ? currentSecRef.current : midiProgressRef.current
  ), []);

  const getPlaybackProgress = useCallback((source: PlaybackSource, pilot: MidiPilot) => {
    if (transportSourceRef.current !== source || transportStartAudioTimeRef.current === null) return getStoredProgress(source);
    const elapsedSinceStart = Math.max(0, Tone.now() - transportStartAudioTimeRef.current);
    const elapsedInScoreSeconds = elapsedSinceStart * Math.max(transportRateRef.current, 0.0001);
    return Math.min(pilot.duration, transportOffsetRef.current + elapsedInScoreSeconds);
  }, [getStoredProgress]);

  const stopSourcePlayback = useCallback((source: PlaybackSource, nextProgressSec?: number) => {
    const next = typeof nextProgressSec === 'number' ? Math.max(0, nextProgressSec) : undefined;
    if (transportSourceRef.current === source) clearTransport();
    if (source === 'demo') {
      setIsPlaying(false);
      if (typeof next === 'number') setCurrentSec(next);
      return;
    }
    setMidiPlaying(false);
    if (typeof next === 'number') setMidiProgressSec(next);
  }, [clearTransport]);

  const stopDemoPlayback = useCallback((nextProgressSec?: number) => {
    stopSourcePlayback('demo', nextProgressSec);
  }, [stopSourcePlayback]);

  const stopScheduledMidi = useCallback((nextProgressSec?: number) => {
    stopSourcePlayback('midi', nextProgressSec);
  }, [stopSourcePlayback]);

  const startPilotPlayback = useCallback(async (source: PlaybackSource, pilot: MidiPilot, offsetSec: number) => {
    await ensureStarted();
    clearTransport();
    const playbackRate = source === 'demo' ? tempoScaleRef.current : 1;
    const clampedOffsetSec = offsetSec >= pilot.duration - MIDI_EPSILON ? 0 : Math.max(0, Math.min(offsetSec, pilot.duration));
    const startDelaySec = 0.03;
    transportSourceRef.current = source;
    transportPilotRef.current = pilot;
    transportStartAudioTimeRef.current = Tone.now() + startDelaySec;
    transportOffsetRef.current = clampedOffsetSec;
    transportRateRef.current = playbackRate;
    transportPlayingRef.current = true;
    setIsPlaying(source === 'demo');
    setMidiPlaying(source === 'midi');
    if (source === 'demo') setCurrentSec(clampedOffsetSec);
    else setMidiProgressSec(clampedOffsetSec);

    pilot.notes.forEach((note) => {
      const noteEnd = note.end;
      if (noteEnd <= clampedOffsetSec + MIDI_EPSILON) return;
      const effectiveStart = Math.max(clampedOffsetSec, note.time);
      const relativeStart = Math.max(0, (effectiveStart - clampedOffsetSec) / playbackRate);
      const playDuration = Math.max(0.03, (noteEnd - effectiveStart) / playbackRate);
      Tone.Transport.scheduleOnce((time) => {
        if (!transportPlayingRef.current || transportSourceRef.current !== source) return;
        scheduleNote(note.name, playDuration, time, note.velocity);
      }, relativeStart);
    });

    Tone.Transport.scheduleOnce(() => {
      if (transportSourceRef.current !== source) return;
      stopSourcePlayback(source, pilot.duration);
    }, Math.max(0, (pilot.duration - clampedOffsetSec) / playbackRate));
    Tone.Transport.start(`+${startDelaySec}`, 0);
  }, [ensureStarted, clearTransport, scheduleNote, stopSourcePlayback]);

  const loadDemoPilot = useCallback(async (demo: Demo) => {
    if (demoCacheRef.current[demo.id]) return;
    const existing = demoLoadPromisesRef.current.get(demo.id);
    if (existing) {
      await existing;
      return;
    }
    const promise = (async () => {
      try {
        const response = await fetch(demo.midiUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const pilot = buildMidiPilotFromMidi(new Midi(buffer), `${demo.composer} - ${demo.title}.mid`);
        demoCacheRef.current[demo.id] = pilot;
        setDemoPilots((prev) => (prev[demo.id] ? prev : { ...prev, [demo.id]: pilot }));
        setDemoErrors((prev) => {
          if (!(demo.id in prev)) return prev;
          const next = { ...prev };
          delete next[demo.id];
          return next;
        });
      } catch {
        setDemoErrors((prev) => ({ ...prev, [demo.id]: 'Could not load the bundled MIDI demo.' }));
      } finally {
        demoLoadPromisesRef.current.delete(demo.id);
      }
    })();
    demoLoadPromisesRef.current.set(demo.id, promise);
    await promise;
  }, []);

  useEffect(() => {
    void loadDemoPilot(selectedDemo);
    DEMOS.forEach((demo) => {
      if (demo.id !== selectedDemo.id) void loadDemoPilot(demo);
    });
  }, [selectedDemo, loadDemoPilot]);

  useEffect(() => {
    stopDemoPlayback(0);
    setCurrentIndex(0);
    setManualIcosahedronSelection(null);
    setManualTonnetzSelection(null);
  }, [selectedDemoId, stopDemoPlayback]);

  useEffect(() => {
    if (!isPlaying && !midiPlaying) return undefined;
    let frame = 0;
    const update = () => {
      const source = transportSourceRef.current;
      const pilot = transportPilotRef.current;
      if (!source || !pilot || transportStartAudioTimeRef.current === null) return;
      const elapsedSec = getPlaybackProgress(source, pilot);
      if (source === 'demo') setCurrentSec(elapsedSec);
      else setMidiProgressSec(elapsedSec);
      if (elapsedSec >= pilot.duration - MIDI_EPSILON) {
        stopSourcePlayback(source, pilot.duration);
        return;
      }
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [getPlaybackProgress, isPlaying, midiPlaying, stopSourcePlayback]);

  useEffect(() => {
    return () => {
      clearTransport();
    };
  }, [clearTransport]);

  useEffect(() => {
    setManualIcosahedronSelection(null);
  }, [activeMap]);

  useEffect(() => {
    const previousTempoScale = previousTempoScaleRef.current;
    previousTempoScaleRef.current = tempoScale;
    if (previousTempoScale === tempoScale) return;
    if (!isPlaying || transportSourceRef.current !== 'demo' || !selectedDemoPilot) return;
    const progress = getPlaybackProgress('demo', selectedDemoPilot);
    void startPilotPlayback('demo', selectedDemoPilot, progress);
  }, [tempoScale, isPlaying, selectedDemoPilot, getPlaybackProgress, startPilotPlayback]);

  const handleMidiUpload = useCallback(async (file: File | null) => {
    if (!file) return;
    setMidiError('');
    try {
      const buffer = await file.arrayBuffer();
      const pilot = buildMidiPilotFromMidi(new Midi(buffer), file.name);
      setMidiPilot(pilot);
      setUseMidiGeometry(true);
      setCurrentIndex(0);
      stopScheduledMidi(0);
    } catch {
      setMidiError('Could not parse the MIDI file. Please try another .mid or .midi file.');
    }
  }, [stopScheduledMidi]);

  const handleMidiPlayPause = useCallback(async () => {
    if (!midiPilot) return;
    if (midiPlaying) {
      stopScheduledMidi(getPlaybackProgress('midi', midiPilot));
      return;
    }
    if (isPlaying && selectedDemoPilot) stopDemoPlayback(getPlaybackProgress('demo', selectedDemoPilot));
    await startPilotPlayback('midi', midiPilot, midiProgressSec);
  }, [midiPilot, midiPlaying, midiProgressSec, getPlaybackProgress, isPlaying, selectedDemoPilot, stopDemoPlayback, startPilotPlayback, stopScheduledMidi]);

  const handleMidiRestart = useCallback(async () => {
    if (!midiPilot) return;
    stopScheduledMidi(0);
    setCurrentIndex(0);
  }, [midiPilot, stopScheduledMidi]);

  const handleMidiStop = useCallback(() => {
    stopScheduledMidi(0);
  }, [stopScheduledMidi]);

  const handlePlayPause = useCallback(async () => {
    if (!selectedDemoPilot) return;
    if (isPlaying) {
      stopDemoPlayback(getPlaybackProgress('demo', selectedDemoPilot));
      return;
    }
    if (midiPlaying && midiPilot) stopScheduledMidi(getPlaybackProgress('midi', midiPilot));
    await startPilotPlayback('demo', selectedDemoPilot, currentSec);
  }, [selectedDemoPilot, isPlaying, stopDemoPlayback, getPlaybackProgress, midiPlaying, midiPilot, stopScheduledMidi, startPilotPlayback, currentSec]);

  const stopPlayback = useCallback(() => {
    stopDemoPlayback(0);
    setCurrentSec(0);
    setCurrentIndex(0);
  }, [stopDemoPlayback]);

  const seekToIndex = useCallback((index: number) => {
    const total = analysisEvents.length;
    const nextIndex = Math.max(0, Math.min(total - 1, index));
    setCurrentIndex(nextIndex);
    if (geometrySource === 'midi' && midiPilot) {
      const t = analysisEventTimes[nextIndex] ?? 0;
      if (midiPlaying) {
        void startPilotPlayback('midi', midiPilot, t);
      } else {
        stopScheduledMidi(t);
      }
      return;
    }
    if (!selectedDemoPilot) return;
    const t = analysisEventTimes[nextIndex] ?? 0;
    if (isPlaying) {
      void startPilotPlayback('demo', selectedDemoPilot, t);
      return;
    }
    stopDemoPlayback(t);
  }, [analysisEvents.length, geometrySource, midiPilot, analysisEventTimes, midiPlaying, startPilotPlayback, stopScheduledMidi, selectedDemoPilot, isPlaying, stopDemoPlayback]);

  const nudgeFrame = useCallback((delta: number) => {
    seekToIndex(effectiveIndex + delta);
  }, [effectiveIndex, seekToIndex]);

  const scrub = useCallback((value: number) => {
    seekToIndex(value);
  }, [seekToIndex]);

  const handleAnalysisModeChange = useCallback((mode: AnalysisFollowMode) => {
    setCurrentIndex(playbackIndex);
    setAnalysisMode(mode);
  }, [playbackIndex]);

  const handleIcoVertexClick = useCallback(async (vertexIndex: number) => {
    setManualIcosahedronSelection({ level: 'vertex', vertexId: vertexIndex });
    await playChord([activeMap[vertexIndex]], 280);
  }, [activeMap, playChord]);

  const handleIcoEdgeClick = useCallback(async (edgeId: string) => {
    const edge = ICOSAHEDRON_EDGE_BY_ID.get(edgeId);
    if (!edge) return;
    setManualIcosahedronSelection({ level: 'edge', edgeId });
    await playChord(normalizePitchClasses(edge.vertices.map((vertex) => activeMap[vertex])), 340);
  }, [activeMap, playChord]);

  const handleFaceClick = useCallback(async (faceIndex: number) => {
    setManualIcosahedronSelection({ level: 'face', faceId: faceIndex });
    await playChord(normalizePitchClasses(chordForFace(faceIndex, activeMap)), 420);
  }, [activeMap, playChord]);

  const handleTonnetzVertexClick = useCallback(async (point: TonnetzPoint, noteLabel: string) => {
    setManualTonnetzSelection({ level: 'vertex', vertexId: point.id });
    await playChord([noteLabel], 280);
  }, [playChord]);

  const handleTonnetzEdgeClick = useCallback(async (edge: TonnetzEdge, noteLabels: string[]) => {
    setManualTonnetzSelection({ level: 'edge', edgeId: edge.id });
    await playChord(normalizePitchClasses(noteLabels), 340);
  }, [playChord]);

  const handleTonnetzClick = useCallback(async (tri: TonnetzTri) => {
    setManualTonnetzSelection({ level: 'face', faceId: tri.id });
    await playChord(tri.notes, 420);
  }, [playChord]);

  const handleExportJson = useCallback(() => {
    const payload = {
      source: geometrySource,
      analysisMode,
      exportedAt: new Date().toISOString(),
      selection: {
        eventIndex: currentAnalysis?.index ?? 0,
        playbackTimeSec,
      },
      referenceWork: geometrySource === 'demo' ? {
        id: selectedDemo.id,
        composer: selectedDemo.composer,
        title: selectedDemo.title,
        sourceLabel: selectedDemo.sourceLabel,
      } : null,
      midi: geometrySource === 'midi' && midiPilot ? {
        fileName: midiPilot.fileName,
        bpm: midiPilot.bpm,
        durationSec: midiPilot.duration,
        noteCount: midiPilot.noteCount,
        sustainWindowCount: midiPilot.sustainWindows.length,
        controlEventCount: midiPilot.controlEvents.length,
        atomicSliceCount: midiPilot.atomicSliceCount,
      } : null,
      stats,
      events: analyzedEvents.map((event) => ({
        index: event.index,
        timeSec: Number(event.startSec.toFixed(5)),
        durationSec: Number(event.durationSec.toFixed(5)),
        activeNotes: event.event.notes,
        literalPitchClasses: event.literalPcs,
        pitchClasses: event.features.pcs,
        structuralCore: event.features.corePcs,
        colorTones: event.features.colorPcs,
        harmony: event.event.harmony,
        descriptorConfidence: Number(event.descriptorConfidence.toFixed(4)),
        descriptorAmbiguity: Number(event.descriptorAmbiguity.toFixed(4)),
        exactIcosahedron: {
          level: event.icosahedronExact.level,
          subsetSize: event.icosahedronExact.subsetSize,
          subsets: event.icosahedronExact.subsetPcs,
          matchedVertices: event.icosahedronExact.vertexIds.map((id) => id + 1),
          matchedEdges: event.icosahedronExact.edgeIds,
          matchedFaces: event.icosahedronExact.faceIds.map((id) => id + 1),
          rule: event.icosahedronExact.rule,
        },
        exactTonnetz: {
          level: event.tonnetzExact.level,
          subsetSize: event.tonnetzExact.subsetSize,
          subsets: event.tonnetzExact.subsetPcs,
          matchedPoints: event.tonnetzExact.vertexIds,
          matchedEdges: event.tonnetzExact.edgeIds,
          matchedTriangles: event.tonnetzExact.faceIds,
          rule: event.tonnetzExact.rule,
        },
        commonToneScore: event.commonToneScore,
        voiceLeadingProxy: event.voiceLeadingScore,
      })),
    };
    downloadTextFile(`${exportBaseName}-analysis.json`, JSON.stringify(payload, null, 2), 'application/json');
  }, [geometrySource, analysisMode, currentAnalysis, playbackTimeSec, selectedDemo, midiPilot, stats, analyzedEvents, exportBaseName]);

  const handleExportCsv = useCallback(() => {
    const header = [
      'index',
      'time_sec',
      'duration_sec',
      'active_notes',
      'literal_pitch_classes',
      'pitch_classes',
      'core_pcs',
      'color_pcs',
      'descriptor_confidence',
      'descriptor_ambiguity',
      'harmony',
      'ico_exact_level',
      'ico_exact_subsets',
      'ico_exact_vertices',
      'ico_exact_edges',
      'ico_exact_faces',
      'tonnetz_exact_level',
      'tonnetz_exact_subsets',
      'tonnetz_exact_points',
      'tonnetz_exact_edges',
      'tonnetz_exact_triangles',
      'common_tone_score',
      'voice_leading_proxy',
    ];
    const rows = analyzedEvents.map((event) => [
      event.index + 1,
      event.startSec.toFixed(5),
      event.durationSec.toFixed(5),
      event.event.notes.join(' | '),
      event.literalPcs.join(' | '),
      event.features.pcs.join(' | '),
      event.features.corePcs.join(' | '),
      event.features.colorPcs.join(' | '),
      event.descriptorConfidence.toFixed(4),
      event.descriptorAmbiguity.toFixed(4),
      event.event.harmony.join(' | '),
      event.icosahedronExact.level ?? '',
      event.icosahedronExact.subsetPcs.map((subset) => subset.join(' ')).join(' / '),
      event.icosahedronExact.vertexIds.map((id) => `V${id + 1}`).join(' | '),
      event.icosahedronExact.edgeIds.join(' | '),
      event.icosahedronExact.faceIds.map((id) => `Face ${id + 1}`).join(' | '),
      event.tonnetzExact.level ?? '',
      event.tonnetzExact.subsetPcs.map((subset) => subset.join(' ')).join(' / '),
      event.tonnetzExact.vertexIds.join(' | '),
      event.tonnetzExact.edgeIds.join(' | '),
      event.tonnetzExact.faceIds.join(' | '),
      event.commonToneScore ?? '',
      event.voiceLeadingScore ?? '',
    ]);
    const content = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    downloadTextFile(`${exportBaseName}-analysis.csv`, content, 'text/csv;charset=utf-8');
  }, [analyzedEvents, exportBaseName]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#020617_0%,#081120_38%,#020617_100%)] px-4 py-6 text-slate-100 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10rem] top-[-8rem] h-[26rem] w-[26rem] rounded-full bg-sky-400/12 blur-3xl" />
        <div className="absolute right-[-8rem] top-[12rem] h-[24rem] w-[24rem] rounded-full bg-fuchsia-400/10 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-[18%] h-[22rem] w-[22rem] rounded-full bg-emerald-400/8 blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-7xl space-y-6">
        <div className="relative overflow-hidden rounded-[32px] border border-sky-200/10 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.22),_transparent_32%),radial-gradient(circle_at_80%_20%,_rgba(253,224,71,0.14),_transparent_24%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(12,18,34,0.9))] p-6 shadow-2xl sm:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30" />
          <div className="relative grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em] text-sky-200/90">
                <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1">Hear harmony</span>
                <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1">See exact matches</span>
                <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1">Upload your own MIDI</span>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-sky-300 mb-2">{TITLE}</div>
                <h1 className="max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl">{SUBTITLE}</h1>
                <p className="mt-4 max-w-4xl text-base leading-relaxed text-slate-200 sm:text-lg">
                  Harmonic Atlas turns abstract harmony into something you can hear, watch, and explore. Start with bundled MIDI demos or upload your own MIDI file to see how changing notes become moving shapes across an icosahedron and a Tonnetz.
                </p>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
                  No specialist background is required: when the harmony changes, the geometry moves with it. The result is a more intuitive way to understand musical tension, release, color, and direction.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Listen</div>
                  <div className="mt-2 text-lg font-medium text-white">Bundled MIDI demos</div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-300">Start with included note-driven demos, then compare what you hear with what the geometry reveals.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">See</div>
                  <div className="mt-2 text-lg font-medium text-white">Two complementary maps</div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-300">The icosahedron shows broader harmonic travel, while the Tonnetz highlights nearby relationships.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Explore</div>
                  <div className="mt-2 text-lg font-medium text-white">Your own MIDI files</div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-300">Import a `.mid` or `.midi` file and let its note data drive both playback and geometric analysis.</div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-slate-950/45 p-5 backdrop-blur-sm">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Credits</div>
                <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-200">
                  <a href="https://github.com/JmsDiG" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 no-underline transition hover:bg-white/8">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-300/20 text-[11px] font-semibold text-sky-200">J</span>
                    <span>Author: JmsDiG</span>
                  </a>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <CodexIcon />
                    <span>Co-created with Codex</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <GitIcon />
                    <span>Git-based workflow</span>
                  </span>
                </div>
              </div>

              <div className="rounded-3xl border border-amber-200/10 bg-amber-300/10 p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                  <ArticleIcon />
                  <span>Research inspiration</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-200">
                  This project is inspired by M. I. Kornev, &quot;The Technique of Musical Icosahedra,&quot; <em>Muzykalnaya Akademiya</em>, 2025, no. 3, pp. 64-83.
                </p>
                <a href="https://doi.org/10.34690/479" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center rounded-full border border-amber-200/20 bg-black/20 px-3 py-1.5 text-sm text-amber-100 no-underline transition hover:bg-black/30">
                  DOI: 10.34690/479
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-2xl font-semibold text-white">{DEMOS.length}</div>
                  <div className="text-sm text-slate-300">bundled MIDI demos included</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-2xl font-semibold text-white">2</div>
                  <div className="text-sm text-slate-300">geometric views of the same harmony</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-2xl font-semibold text-white">1</div>
                  <div className="text-sm text-slate-300">simple way to make theory visible</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.84),rgba(15,23,42,0.55))] p-5 shadow-xl backdrop-blur-md">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Quick start</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step 1</div>
                <div className="mt-2 text-base font-medium text-white">Pick a piece</div>
                <div className="mt-1 text-sm leading-relaxed text-slate-300">Start with a built-in MIDI demo or upload your own MIDI.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step 2</div>
                <div className="mt-2 text-base font-medium text-white">Watch the exact highlights</div>
                <div className="mt-1 text-sm leading-relaxed text-slate-300">Single notes light points, dyads light edges, and triads light triangles across both maps.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step 3</div>
                <div className="mt-2 text-base font-medium text-white">Compare both maps</div>
                <div className="mt-1 text-sm leading-relaxed text-slate-300">One view shows distance, the other shows local closeness.</div>
              </div>
            </div>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.86),rgba(12,18,34,0.6))] p-5 shadow-xl backdrop-blur-md">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">What this is for</div>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-300">
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3">Use it as a visual listening guide if you want to feel harmonic change without reading notation.</div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3">Use it as an analysis tool if you want note-driven geometry from your own MIDI material.</div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3">Use it as a presentation piece if you want harmonic theory to look more immediate and memorable.</div>
            </div>
          </div>
        </div>

        <Section title="How to read the atlas" subtitle="A quick guide for listeners, performers, students, and first-time visitors." icon="🧭" eyebrow="Orientation" tone="sky">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 text-sm text-slate-300 leading-relaxed">
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.intro} Start with the sound</div>The app begins as a listening experience. You hear a performance, and the screen follows along by turning each important harmonic moment into a visual event.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.ico} The icosahedron shows long-range motion</div>Each moment is shown literally: one pitch class lights vertices, two pitch classes light edges, and exact triads light every matching face at once.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.tonnetz} The Tonnetz shows local relationships</div>The Tonnetz uses the same exact rule, so nearby points, edges, and triangles reveal where the current pitch-class content actually lives on the lattice.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.exact} What happens above three pitch classes</div>If more than three pitch classes are active, the display shows every exact 3-note subset that exists. If none exist, it falls back deterministically to exact dyads, then exact single-note matches.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.audio} Built-in MIDI demos and user MIDI</div>You can stay with the included MIDI demos, or switch to your own MIDI material. Both paths use the same exact note-state pipeline for highlighting and playback.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.exact} What happens after upload</div>Your MIDI file is parsed into note onsets, durations, pitches, and velocities. From there, the app builds exact note-state slices, maps them onto both geometries, and can play them back through the piano engine.</div>
          </div>
        </Section>

        <Section title="Upload any MIDI and trace its exact harmonic shape" subtitle="Bring in your own `.mid` or `.midi` file. The uploaded note data can drive playback, analysis, and exact geometric highlighting." icon="📁" eyebrow="User input" tone="emerald">
          <div className="grid lg:grid-cols-[1fr_1fr] gap-4 text-sm">
            <div className="rounded-3xl border border-emerald-300/10 bg-[linear-gradient(180deg,rgba(6,78,59,0.18),rgba(15,23,42,0.72))] p-5 shadow-lg space-y-4">
              <div className="font-medium text-slate-100">{ICONS.midi} Load MIDI</div>
              <label className="block rounded-2xl border border-dashed border-emerald-200/25 bg-emerald-300/5 p-4 transition hover:bg-emerald-300/8">
                <div className="text-sm font-medium text-emerald-100">Choose a MIDI file</div>
                <div className="mt-1 text-sm text-slate-300">Accepted formats: `.mid`, `.midi`</div>
                <input type="file" accept=".mid,.midi,audio/midi,audio/x-midi" onChange={(e) => handleMidiUpload(e.target.files?.[0] || null)} className="mt-3 block w-full text-sm" />
              </label>
              {midiError ? <div className="text-rose-300">{midiError}</div> : null}
              {midiPilot ? (
                <div className="grid grid-cols-2 gap-3 text-slate-300">
                  <div className="col-span-2 rounded-2xl border border-white/8 bg-white/[0.045] p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Loaded file</div>
                    <div className="mt-1 break-all text-sm text-slate-100">{midiPilot.fileName}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Notes</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.noteCount}</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Events</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.events.length}</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Atomic slices</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.atomicSliceCount}</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Duration</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.duration.toFixed(2)} s</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Tempo</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.bpm ? midiPilot.bpm.toFixed(1) : 'N/A'}</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Pedal windows</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.sustainWindows.length}</div></div>
                </div>
              ) : <div className="text-slate-400">Upload any MIDI file to turn its literal active notes into exact current-state highlights across the atlas.</div>}
            </div>
            <div className="rounded-3xl border border-sky-300/10 bg-[linear-gradient(180deg,rgba(14,165,233,0.12),rgba(15,23,42,0.72))] p-5 shadow-lg space-y-4">
              <div className="font-medium text-slate-100">{ICONS.audio} Playback and geometric control</div>
              <div className="rounded-2xl border border-sky-300/10 bg-sky-300/5 p-3 text-slate-300">Use this panel to decide whether the screen should follow the built-in MIDI demo or the exact note data from your uploaded MIDI file.</div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={useMidiGeometry} disabled={!midiPilot} onChange={(e) => setUseMidiGeometry(e.target.checked)} />Drive the geometric layer from the uploaded MIDI</label>
              <div className="flex gap-3 flex-wrap pt-1">
                <button onClick={handleMidiPlayPause} disabled={!midiPilot} className={midiPlaying ? 'px-3 py-2 rounded-xl text-sm bg-rose-400 text-slate-950 disabled:opacity-40' : 'px-3 py-2 rounded-xl text-sm bg-emerald-400 text-slate-950 disabled:opacity-40'}>{midiPlaying ? 'Pause MIDI' : 'Play MIDI'}</button>
                <button onClick={handleMidiRestart} disabled={!midiPilot} className="px-3 py-2 rounded-xl bg-white/10 text-sm disabled:opacity-40">Restart analysis</button>
                <button onClick={handleMidiStop} disabled={!midiPilot} className="px-3 py-2 rounded-xl bg-white/10 text-sm disabled:opacity-40">Stop MIDI</button>
              </div>
              <div className="text-slate-300">Manual click piano: {samplerReady ? 'sampled piano ready' : 'loading sampled piano, synth fallback active'}</div>
              <div className="text-slate-300">MIDI progress: {midiProgressSec.toFixed(2)} s</div>
            </div>
          </div>
        </Section>

        <div className="grid lg:grid-cols-[1.18fr_0.82fr] gap-6">
          <Section title="Icosahedron" subtitle="Large fixed-scale view. Drag to rotate. Click vertices, edges, or faces to hear them and inspect them directly." icon="🔺" eyebrow="Geometry A" tone="sky">
            <div className="flex gap-3 flex-wrap text-sm">
              <button className={showNumbers ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'} onClick={() => setShowNumbers((v) => !v)}>Numbers</button>
              <button className="px-3 py-2 rounded-xl border border-white/10 bg-white/5" onClick={() => { setRotX(DEFAULT_ROT_X); setRotY(DEFAULT_ROT_Y); }}>Reset rotation</button>
              <button className="px-3 py-2 rounded-xl border border-white/10 bg-white/5" onClick={() => setManualIcosahedronSelection(null)}>Clear manual selection</button>
            </div>
            {manualIcosahedronSummary ? <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">Manual selection: <span className="text-slate-100">{manualIcosahedronSummary}</span></div> : null}
            <IcosahedronView projected={projected} faceCentroidsMap={faceCentroidsMap} exactMatch={currentAnalysis?.icosahedronExact ?? null} manualSelection={manualIcosahedronSelection} showNumbers={showNumbers} onVertexClick={handleIcoVertexClick} onEdgeClick={handleIcoEdgeClick} onFaceClick={handleFaceClick} noteMap={activeMap} rotX={rotX} rotY={rotY} setRotX={setRotX} setRotY={setRotY} />
          </Section>

          <div className="space-y-6">
            <Section title="Works and playback" subtitle="Choose a bundled MIDI demo, then compare it with the exact geometry generated from your own MIDI if you want a second perspective." icon="🎧" eyebrow="Listening" tone="amber">
              <select value={selectedDemoId} onChange={(e) => setSelectedDemoId(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm shadow-inner">
                {DEMOS.map((demo) => <option key={demo.id} value={demo.id}>{demo.composer} — {demo.title}</option>)}
              </select>
              <div className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] p-5 shadow-lg">
                <div className="font-medium text-white">{selectedDemo.composer} — {selectedDemo.title}</div>
                <div className="mt-2 text-sm text-slate-300">{selectedDemo.subtitle}</div>
                <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs text-slate-400">Source: {selectedDemo.sourceLabel}</div>
                {selectedDemoLoading ? <div className="mt-3 text-sm text-slate-300">Loading bundled MIDI analysis…</div> : null}
                {selectedDemoError ? <div className="mt-3 text-sm text-rose-300">{selectedDemoError}</div> : null}
                {selectedDemoPilot ? (
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm text-slate-300">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Duration</div><div className="mt-2 text-base text-slate-100">{selectedDemoPilot.duration.toFixed(2)} s</div></div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Notes</div><div className="mt-2 text-base text-slate-100">{selectedDemoPilot.noteCount}</div></div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Events</div><div className="mt-2 text-base text-slate-100">{selectedDemoPilot.events.length}</div></div>
                  </div>
                ) : null}
              </div>
              <div className="flex gap-3 flex-wrap pt-1">
                <button onClick={handlePlayPause} disabled={!selectedDemoPilot} className={isPlaying ? 'px-3 py-2 rounded-xl text-sm bg-rose-300 text-slate-950 shadow-lg disabled:opacity-40' : 'px-3 py-2 rounded-xl text-sm bg-emerald-300 text-slate-950 shadow-lg disabled:opacity-40'}>{isPlaying ? 'Pause' : currentSec > 0 ? 'Resume' : 'Play'}</button>
                <button onClick={stopPlayback} disabled={!selectedDemoPilot} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm disabled:opacity-40">From start</button>
                <button onClick={() => nudgeFrame(-1)} disabled={!selectedDemoPilot} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm disabled:opacity-40">Back</button>
                <button onClick={() => nudgeFrame(1)} disabled={!selectedDemoPilot} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm disabled:opacity-40">Forward</button>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm text-slate-300">Playback speed: {tempoScale.toFixed(2)}x</div>
                <input type="range" min={0.65} max={1.35} step={0.05} value={tempoScale} onChange={(e) => {
                  const next = Number(e.target.value);
                  setTempoScale(next);
                }} className="mt-2 w-full" disabled={!selectedDemoPilot} />
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm text-slate-300">Position: {effectiveIndex + 1} / {analysisEvents.length}</div>
                <input type="range" min={0} max={Math.max(0, analysisEvents.length - 1)} step={1} value={effectiveIndex} onChange={(e) => scrub(Number(e.target.value))} className="mt-2 w-full" disabled={!analysisEvents.length} />
              </div>
            </Section>

            <Section title="Current event analysis" subtitle="Inspect the selected harmonic event without losing the current playback context." icon="🎯" eyebrow="Live state" tone="violet">
              <div className="rounded-3xl border border-white/8 bg-[linear-gradient(135deg,rgba(76,29,149,0.20),rgba(15,23,42,0.80))] p-5 shadow-lg">
                <div className="text-slate-400 text-sm mb-1">Now sounding in the geometric layer</div>
                <div className="text-2xl font-semibold tracking-tight text-white">{currentLiteralPcs.join(' – ') || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-violet-200/12 bg-violet-300/10 px-3 py-1 text-xs text-violet-100">Frame {effectiveIndex + 1}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs text-slate-300">{geometrySource === 'midi' ? 'Source: uploaded MIDI' : 'Source: bundled MIDI demo'}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs text-slate-300">Time {formatClockTime(currentAnalysis?.startSec ?? 0)}</span>
                </div>
                <div className="text-sm text-slate-300 mt-3">{currentEvent.label || currentEvent.notes.join(' · ')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <MetricCard title="Global geometry" top={`Average common tones: ${stats.avgCommon}`} bottom={`Average voice-leading distance: ${stats.avgDistance}`} />
                <MetricCard title="Current exact display" top={`Icosahedron: ${currentAnalysis ? summarizeExactMatch(currentAnalysis.icosahedronExact) : '—'}`} bottom={`Tonnetz: ${currentAnalysis ? summarizeExactMatch(currentAnalysis.tonnetzExact) : '—'}`} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Event index</div>
                  <div className="mt-2 text-base text-slate-100">{currentAnalysis ? `${currentAnalysis.index + 1} / ${analyzedEvents.length}` : '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Active notes</div>
                  <div className="mt-2 text-base text-slate-100">{currentEvent.notes.join(' · ') || '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Literal pitch classes</div>
                  <div className="mt-2 text-base text-slate-100">{currentLiteralPcs.join(' · ') || '—'}</div>
                  <div className="mt-2 text-xs text-slate-400">{literalDiffersFromContext ? `Context label: ${currentEvent.harmony.join(' · ') || '—'}` : 'Exact current-state display follows these active pitch classes.'}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Icosahedron exact rule</div>
                  <div className="mt-2 text-base text-slate-100">{currentAnalysis ? summarizeExactMatch(currentAnalysis.icosahedronExact) : '—'}</div>
                  <div className="mt-2 text-xs text-slate-400">Subsets: {currentAnalysis ? formatSubsetSummary(currentAnalysis.icosahedronExact.subsetPcs) : '—'}</div>
                  <div className="mt-2 text-xs text-slate-400">{currentAnalysis?.icosahedronExact.rule ?? 'No exact icosahedron match'}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Tonnetz exact rule</div>
                  <div className="mt-2 text-base text-slate-100">{currentAnalysis ? summarizeExactMatch(currentAnalysis.tonnetzExact) : '—'}</div>
                  <div className="mt-2 text-xs text-slate-400">Subsets: {currentAnalysis ? formatSubsetSummary(currentAnalysis.tonnetzExact.subsetPcs) : '—'}</div>
                  <div className="mt-2 text-xs text-slate-400">{currentAnalysis?.tonnetzExact.rule ?? 'No exact Tonnetz match'}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Literal subset rule</div>
                  <div className="mt-2 text-base text-slate-100">Largest exact drawable subset</div>
                  <div className="mt-2 text-xs text-slate-400">If more than three pitch classes are active, the display shows all exact triads first, then all exact dyads, then all exact single notes only if larger exact subsets do not exist.</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Transition metrics</div>
                  <div className="mt-2 text-base text-slate-100">Common-tone score: {currentAnalysis?.commonToneScore ?? '—'}</div>
                  <div className="mt-2 text-xs text-slate-400">Voice-leading proxy: {currentAnalysis?.voiceLeadingScore ?? '—'}</div>
                </div>
              </div>
            </Section>
          </div>
        </div>

        <Section title="Analysis timeline" subtitle="Use the timeline and analysis controls without stretching the playback panel." icon="🧭" eyebrow="Analysis" tone="amber">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Current analysis</div>
              <div className="mt-2 text-sm text-slate-300">{geometrySource === 'midi' ? 'Uploaded MIDI analysis' : 'Bundled MIDI demo analysis'}</div>
              <div className="mt-4 flex gap-2 flex-wrap text-sm">
                <button onClick={handleExportJson} className="px-3 py-2 rounded-xl bg-violet-300 text-slate-950 shadow-lg">Export JSON</button>
                <button onClick={handleExportCsv} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5">Export CSV</button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Analysis mode</div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <button onClick={() => handleAnalysisModeChange('follow')} className={analysisMode === 'follow' ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'}>Follow playback</button>
                <button onClick={() => handleAnalysisModeChange('freeze')} className={analysisMode === 'freeze' ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'}>Freeze analysis</button>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Timeline</div>
                <div className="mt-1 text-sm text-slate-300">Each segment is a harmonic event. Click any segment to jump there.</div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs text-slate-300">Playback marker: {formatClockTime(playbackTimeSec)}</div>
            </div>
            <div className="mt-4">
              <AnalysisTimeline events={analyzedEvents} selectedIndex={effectiveIndex} playbackTimeSec={playbackTimeSec} onSelect={scrub} />
            </div>
          </div>
        </Section>

        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-6">
          <Section title="Tonnetz" subtitle="A planar harmonic network for close relationships. Click points, edges, or triangles to hear them and inspect them directly." icon="🕸️" eyebrow="Geometry B" tone="violet">
            <div className="flex gap-3 flex-wrap text-sm">
              <button onClick={() => setTonnetzMode('chromatic')} className={tonnetzMode === 'chromatic' ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'}>Standard labels</button>
              <button onClick={() => setTonnetzMode('fifths')} className={tonnetzMode === 'fifths' ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'}>Fifths labels</button>
              <button onClick={() => setManualTonnetzSelection(null)} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5">Clear manual selection</button>
            </div>
            {manualTonnetzSummary ? <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">Manual selection: <span className="text-slate-100">{manualTonnetzSummary}</span></div> : null}
            <TonnetzView triangles={tonnetzTriangles} geometry={tonnetzGeometry} pointLabels={tonnetzPointLabels} exactMatch={currentAnalysis?.tonnetzExact ?? null} manualSelection={manualTonnetzSelection} onVertexClick={handleTonnetzVertexClick} onEdgeClick={handleTonnetzEdgeClick} onTriangleClick={handleTonnetzClick} />
          </Section>

          <div className="space-y-6">
            <Section title="Why both geometries matter" subtitle="Two views make the same harmony easier to grasp, especially if traditional theory language feels abstract." icon="🧠" eyebrow="Comparison" tone="amber">
              <div className="text-sm text-slate-300 leading-relaxed space-y-3">
                <div className="rounded-2xl border border-sky-300/10 bg-sky-300/5 p-4">{ICONS.ico} The icosahedron emphasizes larger dramatic turns, so harmonic structure feels architectural rather than hidden inside notation.</div>
                <div className="rounded-2xl border border-violet-300/10 bg-violet-300/5 p-4">{ICONS.tonnetz} The Tonnetz emphasizes local adjacency, making smooth connections and shared tones much easier to notice.</div>
                <div className="rounded-2xl border border-amber-300/10 bg-amber-300/5 p-4">{ICONS.compare} Together they help non-specialists answer a simple question: is this moment a small shift, or a real change of harmonic landscape?</div>
              </div>
            </Section>

            <Section title="Vertex note mapping" subtitle="Reassign the pitch labels on the icosahedron vertices and watch the harmonic landscape reorganize itself." icon="🗺️" eyebrow="Mapping" tone="emerald">
              <div className="flex gap-2 flex-wrap mb-3">
                <button onClick={() => setNoteMap(NOTES.slice())} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-900 text-sm shadow-lg">Chromatic</button>
                <button onClick={() => setNoteMap(FIFTHS.slice())} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm">Cycle of fifths</button>
                <button onClick={() => setCompareSymmetry((v) => !v)} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm">{compareSymmetry ? 'Using symmetry view' : 'Using direct mapping'}</button>
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
