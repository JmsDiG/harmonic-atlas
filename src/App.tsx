import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

type Vec3 = [number, number, number];
type Proj = { x: number; y: number; z: number };
type TonnetzTri = { id: string; kind: 'up' | 'down'; points: { x: number; y: number }[]; notes: string[] };
type DemoEvent = { notes: string[]; ms: number; harmony: string[]; label?: string };
type Demo = { id: string; composer: string; title: string; subtitle: string; audioUrl: string; sourceLabel: string; events: DemoEvent[] };
type MatchItem = { face: number | null; tonnetzId: string | null; harmony: string[] };
type MatchContext = 'demo' | 'midi';
type HarmonyFeatures = { pcs: string[]; corePcs: string[]; attackPcs: string[]; bassPc: string | null };
type SectionTone = 'sky' | 'violet' | 'amber' | 'emerald';
type SectionProps = { title: string; subtitle?: string; children: React.ReactNode; icon?: string; eyebrow?: string; tone?: SectionTone };
type MetricProps = { title: string; top: string; bottom: string };
type ScoreNote = { midi: number; name: string; time: number; duration: number; velocity: number; track: number };
type MidiPilot = { fileName: string; bpm: number | null; duration: number; noteCount: number; notes: ScoreNote[]; events: DemoEvent[]; eventTimes: number[] };

const TITLE = 'Harmonic Atlas';
const SUBTITLE = 'Interactive Harmonic Geometry for Listening, Seeing, and Uploading MIDI';
const ICONS = { intro: '🎼', ico: '🔺', tonnetz: '🕸️', path: '🧭', audio: '🎹', compare: '🧠', map: '🗺️', midi: '📁', exact: '🎯' };

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
const PHI = 1.618033988749895;
const SQRT3 = Math.sqrt(3);
const DEFAULT_ROT_X = -0.22;
const DEFAULT_ROT_Y = 0.84;
const FIXED_ZOOM = 2.1;
const DETAIL_PATH_WINDOW = 56;
const DEFAULT_PATH = [0, 8, 9, 10, 16, 17, 4, 6, 5, 15, 19, 18, 12, 11, 7, 1, 3, 2, 14, 13];
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
function commonTones(a: string[], b: string[]): number {
  const A = new Set(a.map(pitchClass));
  const B = new Set(b.map(pitchClass));
  let c = 0;
  A.forEach((x) => { if (B.has(x)) c += 1; });
  return c;
}
function samePitchClassSet(a: string[], b: string[]): boolean {
  const A = [...new Set(a.map(pitchClass))].sort();
  const B = [...new Set(b.map(pitchClass))].sort();
  if (A.length !== B.length) return false;
  return A.every((pc, idx) => pc === B[idx]);
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
function reduceToTriadicCore(pcs: string[], attackPcs: string[], bassPc: string | null): string[] {
  if (pcs.length <= 3) return pcs;
  const candidates = combinationsOfThree(pcs);
  let best: { pcs: string[]; score: number } | null = null;
  for (const candidate of candidates) {
    const score = triadSetScore(candidate)
      + (bassPc && candidate.includes(bassPc) ? 12 : 0)
      + (commonTones(candidate, attackPcs) * 8)
      - ((pcs.length - commonTones(candidate, pcs)) * 2);
    if (!best || score > best.score) best = { pcs: candidate, score };
  }
  if (best) return best.pcs;
  return pcs.slice(0, 3);
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
function harmonyFeatures(event: DemoEvent): HarmonyFeatures {
  const pcs = distinctPitchClasses(event.harmony);
  const attackPcs = distinctPitchClasses(event.notes);
  const bassPc = bassPitchClass(event.notes) ?? attackPcs[0] ?? pcs[0] ?? null;
  return {
    pcs,
    corePcs: reduceToTriadicCore(pcs, attackPcs, bassPc),
    attackPcs,
    bassPc,
  };
}
function geometryMatchScore(features: HarmonyFeatures, itemNotes: string[], previousNotes: string[] | null, context: MatchContext): number {
  const itemPcs = distinctPitchClasses(itemNotes);
  const targetPcs = context === 'midi' ? features.corePcs : features.pcs;
  const overlap = commonTones(targetPcs, itemPcs);
  const attackOverlap = commonTones(features.attackPcs, itemPcs);
  const extraItemTones = itemPcs.filter((pc) => !targetPcs.includes(pc)).length;
  const omittedTargetTones = targetPcs.filter((pc) => !itemPcs.includes(pc)).length;
  const bassBonus = features.bassPc && itemPcs.includes(features.bassPc) ? (context === 'midi' ? 28 : 8) : 0;
  const continuity = previousNotes ? (commonTones(previousNotes, itemPcs) * 7) - (voiceLeadingProxy(previousNotes, itemPcs) * 2) : 0;
  if (context === 'demo') {
    return (overlap * 150) + bassBonus + continuity - (extraItemTones * 110) - (omittedTargetTones * 20) - (voiceLeadingProxy(targetPcs, itemPcs) * 4);
  }
  return (overlap * 140) + (attackOverlap * 14) + bassBonus + continuity - (extraItemTones * 90) - (omittedTargetTones * 18) - (voiceLeadingProxy(targetPcs, itemPcs) * 5);
}
function bestGeometryMatch(features: HarmonyFeatures, items: Array<{ id: string | number; notes: string[] }>, previous: { id: string | number; notes: string[] } | null, context: MatchContext): string | number | null {
  let best: { id: string | number; score: number } | null = null;
  for (const item of items) {
    const score = geometryMatchScore(features, item.notes, previous?.notes ?? null, context);
    if (!best || score > best.score) best = { id: item.id, score };
  }
  return best ? best.id : null;
}
function buildGeometryMatchPath(events: DemoEvent[], items: Array<{ id: string | number; notes: string[] }>, context: MatchContext): Array<string | number | null> {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const matches: Array<string | number | null> = [];
  let previousMatch: { id: string | number; notes: string[] } | null = null;
  let previousFeatures: HarmonyFeatures | null = null;
  events.forEach((event) => {
    const features = harmonyFeatures(event);
    const previousSet = context === 'midi' ? previousFeatures?.corePcs : previousFeatures?.pcs;
    const currentSet = context === 'midi' ? features.corePcs : features.pcs;
    if (previousMatch && previousSet && samePitchClassSet(previousSet, currentSet)) {
      matches.push(previousMatch.id);
      previousFeatures = features;
      return;
    }
    const nextId = bestGeometryMatch(features, items, previousMatch, context);
    const nextMatch = nextId !== null ? itemMap.get(nextId) ?? null : null;
    matches.push(nextId);
    previousMatch = nextMatch;
    previousFeatures = features;
  });
  return matches;
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
    const attacks = notes.filter((n) => Math.abs(n.time - t) <= 1e-6);
    const harmony = [...new Set(active.map((n) => pcFromMidi(n.midi)))];
    if (!harmony.length) continue;
    const attackNotes = attacks.map((n) => n.name);
    events.push({ notes: attackNotes.length ? attackNotes : noteVoicing(harmony), ms: Math.max(60, (nextT - t) * 1000), harmony, label: `t=${t.toFixed(2)}s` });
    eventTimes.push(t);
  }
  return { events, eventTimes };
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
  let idx = 0;
  for (let i = 0; i < startTimesMs.length; i += 1) {
    if (startTimesMs[i] <= timeMs + 1e-6) idx = i;
    else break;
  }
  return idx;
}

function buildStepMap<T>(items: Array<T | null>): number[] {
  let step = -1;
  return items.map((item) => {
    if (item !== null) step += 1;
    return Math.max(step, 0);
  });
}
function collapseConsecutivePath<T extends string | number>(items: T[]): T[] {
  const out: T[] = [];
  items.forEach((item) => {
    if (out.length && out[out.length - 1] === item) return;
    out.push(item);
  });
  return out;
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

function IcosahedronView(props: {
  projected: Proj[]; faceCentroidsMap: Record<number, Proj>; currentFace: number | null; path: number[]; step: number; showPath: boolean; showNumbers: boolean; detailedPath: boolean; onFaceClick: (faceIndex: number) => void; noteMap: string[]; rotX: number; rotY: number; setRotX: React.Dispatch<React.SetStateAction<number>>; setRotY: React.Dispatch<React.SetStateAction<number>>;
}) {
  const completedPath = useMemo(() => props.path.slice(0, props.step + 1), [props.path, props.step]);
  const completedWindowPath = useMemo(() => (
    props.detailedPath ? completedPath.slice(Math.max(0, completedPath.length - DETAIL_PATH_WINDOW)) : completedPath
  ), [completedPath, props.detailedPath]);
  const visited = useMemo(() => new Set(completedPath), [completedPath]);
  const displayPath = useMemo(() => (
    props.detailedPath ? completedWindowPath : collapseConsecutivePath(props.path)
  ), [props.path, props.detailedPath, completedWindowPath]);
  const completedDisplayPath = useMemo(() => (
    props.detailedPath ? completedWindowPath : collapseConsecutivePath(completedPath)
  ), [completedPath, props.detailedPath, completedWindowPath]);
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
  const pathPolyline = displayPath.map((faceIndex) => {
    const c = props.faceCentroidsMap[faceIndex];
    return `${c.x},${c.y}`;
  }).join(' ');
  const completedPolyline = completedDisplayPath.map((faceIndex) => {
    const c = props.faceCentroidsMap[faceIndex];
    return `${c.x},${c.y}`;
  }).join(' ');
  const currentMarker = props.currentFace === null ? null : props.faceCentroidsMap[props.currentFace];
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
          const active = props.currentFace === faceIndex;
          const cls = active ? 'fill-amber-300/90' : visited.has(faceIndex) ? 'fill-violet-300/45' : 'fill-white/10';
          return <polygon key={`face-${faceIndex}`} points={pts} onClick={() => props.onFaceClick(faceIndex)} className={`${cls} stroke-white/45 stroke-[1.5] cursor-pointer hover:fill-fuchsia-300/40 transition-all duration-150`} />;
        })}
        {drawOrder.map((faceIndex) => {
          const face = FACES[faceIndex];
          const pts = [face[0], face[1], face[2], face[0]].map((i) => `${props.projected[i].x},${props.projected[i].y}`).join(' ');
          return <polyline key={`edge-${faceIndex}`} points={pts} fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.4" />;
        })}
        {props.showPath && !props.detailedPath && displayPath.length > 1 ? <polyline points={pathPolyline} fill="none" stroke="#c084fc" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity="0.35" /> : null}
        {props.showPath && completedDisplayPath.length > 1 ? <polyline points={completedPolyline} fill="none" stroke="#f472b6" strokeWidth={props.detailedPath ? 3 : 4} strokeLinecap="round" strokeLinejoin="round" opacity="0.95" /> : null}
        {props.showPath && props.detailedPath ? completedDisplayPath.map((faceIndex, idx) => {
          const c = props.faceCentroidsMap[faceIndex];
          return <circle key={`trail-${faceIndex}-${idx}`} cx={c.x} cy={c.y} r={idx === completedDisplayPath.length - 1 ? 0 : 2.5} fill="#f8fafc" opacity={0.55} />;
        }) : null}
        {props.showPath && currentMarker ? <g><circle cx={currentMarker.x} cy={currentMarker.y} r={8} fill="#34d399" />{props.showNumbers ? <text x={currentMarker.x + 12} y={currentMarker.y - 10} fontSize="12" fill="#e2e8f0">{props.step + 1}</text> : null}</g> : null}
        {vertexOrder.map((i) => {
          const p = props.projected[i];
          const r = 12 + Math.max(0, p.z) * 2;
          return <g key={`vertex-${i}`}><circle cx={p.x} cy={p.y} r={r} fill="#111827" stroke="#e2e8f0" strokeWidth="1.4" /><text x={p.x} y={p.y - 18} textAnchor="middle" fontSize="11" fill="#cbd5e1">{i + 1}</text><text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fill="#f8fafc">{props.noteMap[i]}</text></g>;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
        <div className="inline-flex rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">Each triangle is a harmonic cell. The pink route marks the current path.</div>
      </div>
    </div>
  );
}

function TonnetzView(props: { triangles: TonnetzTri[]; currentId: string | null; activePathIds: string[]; step: number; detailedPath: boolean; onTriangleClick: (tri: TonnetzTri) => void; }) {
  const bounds = useMemo(() => getTonnetzBounds(props.triangles), [props.triangles]);
  const completedPath = useMemo(() => props.activePathIds.slice(0, props.step + 1), [props.activePathIds, props.step]);
  const completedWindowPath = useMemo(() => (
    props.detailedPath ? completedPath.slice(Math.max(0, completedPath.length - DETAIL_PATH_WINDOW)) : completedPath
  ), [completedPath, props.detailedPath]);
  const currentSet = useMemo(() => new Set(completedPath), [completedPath]);
  const displayPath = useMemo(() => (
    props.detailedPath ? completedWindowPath : collapseConsecutivePath(props.activePathIds)
  ), [props.activePathIds, props.detailedPath, completedWindowPath]);
  const completedDisplayPath = useMemo(() => (
    props.detailedPath ? completedWindowPath : collapseConsecutivePath(completedPath)
  ), [completedPath, props.detailedPath, completedWindowPath]);
  const centers = useMemo(() => new Map(props.triangles.map((tri) => [tri.id, {
    x: (tri.points[0].x + tri.points[1].x + tri.points[2].x) / 3,
    y: (tri.points[0].y + tri.points[1].y + tri.points[2].y) / 3,
  }])), [props.triangles]);
  const pathPolyline = displayPath.map((id) => {
    const center = centers.get(id);
    return center ? `${center.x},${center.y}` : '';
  }).filter(Boolean).join(' ');
  const completedPolyline = completedDisplayPath.map((id) => {
    const center = centers.get(id);
    return center ? `${center.x},${center.y}` : '';
  }).filter(Boolean).join(' ');
  const currentMarker = props.currentId ? centers.get(props.currentId) ?? null : null;
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
          {!props.detailedPath && displayPath.length > 1 ? <polyline points={pathPolyline} fill="none" stroke="#c084fc" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity="0.35" /> : null}
          {completedDisplayPath.length > 1 ? <polyline points={completedPolyline} fill="none" stroke="#f472b6" strokeWidth={props.detailedPath ? 3 : 4} strokeLinecap="round" strokeLinejoin="round" opacity="0.95" /> : null}
          {props.triangles.map((tri) => {
            const pts = tri.points.map((p) => `${p.x},${p.y}`).join(' ');
            const active = tri.id === props.currentId;
            const inPath = currentSet.has(tri.id);
            const fill = active ? 'rgba(251,191,36,0.95)' : inPath ? 'rgba(167,139,250,0.50)' : tri.kind === 'up' ? 'rgba(99,102,241,0.16)' : 'rgba(34,197,94,0.14)';
            const center = centers.get(tri.id);
            const cx = center?.x ?? 0;
            const cy = center?.y ?? 0;
            return <g key={tri.id} onClick={() => props.onTriangleClick(tri)} className="cursor-pointer"><polygon points={pts} fill={fill} stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" /><text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill="#f8fafc">{tri.notes.join(' · ')}</text></g>;
          })}
          {props.detailedPath ? completedDisplayPath.map((id, idx) => {
            const center = centers.get(id);
            if (!center || idx === completedDisplayPath.length - 1) return null;
            return <circle key={`trail-${id}-${idx}`} cx={center.x} cy={center.y} r={2.5} fill="#f8fafc" opacity={0.55} />;
          }) : null}
          {currentMarker ? <circle cx={currentMarker.x} cy={currentMarker.y} r={8} fill="#34d399" /> : null}
        </svg>
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
        <div className="inline-flex rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">Nearby triangles suggest nearby harmonic behavior.</div>
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
  const { playChord, scheduleNote, stop: stopPiano, samplerReady, ensureStarted } = useSampledPiano();
  const midiTimeoutsRef = useRef<number[]>([]);
  const midiStartedAtRef = useRef<number | null>(null);
  const midiPlayingRef = useRef(false);

  const selectedDemo = useMemo(() => DEMOS.find((d) => d.id === selectedDemoId) || DEMOS[0], [selectedDemoId]);
  const activeMap = useMemo(() => compareSymmetry ? mutate(noteMap) : noteMap, [compareSymmetry, noteMap]);
  const projected = useMemo(() => RAW_VERTICES.map((v) => projectPoint(v, rotX, rotY, FIXED_ZOOM)), [rotX, rotY]);
  const faceCentroidsMap = useMemo(() => { const out: Record<number, Proj> = {}; FACES.forEach((_, i) => { out[i] = faceCentroid(i, projected); }); return out; }, [projected]);
  const tonnetzTrianglesRaw = useMemo(() => buildTonnetzTriangles(), []);
  const tonnetzTriangles = useMemo(() => tonnetzTrianglesRaw.map((tri) => ({ ...tri, notes: tri.notes.map((n) => tonnetzMode === 'fifths' ? FIFTHS[NOTES.indexOf(n)] : n) })), [tonnetzTrianglesRaw, tonnetzMode]);
  const geometryItemsIco = useMemo(() => FACES.map((_, i) => ({ id: i, notes: chordForFace(i, activeMap) })), [activeMap]);
  const geometryItemsTonnetz = useMemo(() => tonnetzTriangles.map((tri) => ({ id: tri.id, notes: tri.notes })), [tonnetzTriangles]);

  const midiGeometryAvailable = useMidiGeometry && midiPilot !== null;
  const geometrySource = useMemo<'demo' | 'midi'>(() => {
    if (midiPlaying && midiGeometryAvailable) return 'midi';
    if (isPlaying) return 'demo';
    if (midiGeometryAvailable) return 'midi';
    return 'demo';
  }, [midiPlaying, midiGeometryAvailable, isPlaying]);
  const analysisEvents = useMemo(() => (geometrySource === 'midi' && midiPilot ? midiPilot.events : selectedDemo.events), [geometrySource, midiPilot, selectedDemo]);
  const analysisEventTimes = useMemo(() => (geometrySource === 'midi' && midiPilot ? midiPilot.eventTimes : []), [geometrySource, midiPilot]);
  const analysisTimeline = useMemo(() => buildEventTimelineMs(analysisEvents), [analysisEvents]);

  const piecePathItems: MatchItem[] = useMemo(() => {
    const matchContext: MatchContext = geometrySource === 'midi' ? 'midi' : 'demo';
    const faceMatches = buildGeometryMatchPath(analysisEvents, geometryItemsIco, matchContext);
    const tonnetzMatches = buildGeometryMatchPath(analysisEvents, geometryItemsTonnetz, matchContext);
    return analysisEvents.map((ev, idx) => ({
      face: faceMatches[idx] as number | null,
      tonnetzId: tonnetzMatches[idx] as string | null,
      harmony: ev.harmony,
    }));
  }, [analysisEvents, geometryItemsIco, geometryItemsTonnetz, geometrySource]);

  const pieceFaceEventPath = useMemo(() => piecePathItems.flatMap((item) => (item.face === null ? [] : [item.face])), [piecePathItems]);
  const pieceTonnetzEventPath = useMemo(() => piecePathItems.flatMap((item) => (item.tonnetzId === null ? [] : [item.tonnetzId])), [piecePathItems]);
  const faceStepMap = useMemo(() => buildStepMap(piecePathItems.map((item) => item.face)), [piecePathItems]);
  const tonnetzStepMap = useMemo(() => buildStepMap(piecePathItems.map((item) => item.tonnetzId)), [piecePathItems]);
  const activeFacePath = manualIcoSequence.length ? manualIcoSequence : (pieceFaceEventPath.length ? pieceFaceEventPath : DEFAULT_PATH);
  const activeTonnetzPath = manualTonnetzSequence.length ? manualTonnetzSequence : pieceTonnetzEventPath;

  const audioAutoIndex = useMemo(() => {
    const total = analysisEvents.length;
    if (!durationSec || total <= 1 || geometrySource === 'midi') return currentIndex;
    const scaledMs = (currentSec / durationSec) * analysisTimeline.totalMs;
    return eventIndexAtTime(scaledMs, analysisTimeline.startTimesMs);
  }, [analysisEvents.length, analysisTimeline, durationSec, currentSec, currentIndex, geometrySource]);

  const midiAutoIndex = useMemo(() => {
    if (!(geometrySource === 'midi' && midiPilot)) return currentIndex;
    if (!analysisEventTimes.length) return 0;
    let idx = 0;
    for (let i = 0; i < analysisEventTimes.length; i += 1) {
      if (analysisEventTimes[i] <= midiProgressSec + 1e-6) idx = i;
      else break;
    }
    return idx;
  }, [geometrySource, midiPilot, analysisEventTimes, midiProgressSec, currentIndex]);

  const effectiveIndex = geometrySource === 'midi' && midiPilot ? midiAutoIndex : (isPlaying ? audioAutoIndex : currentIndex);
  const detailedGeometryPath = geometrySource === 'midi' && midiPilot !== null;
  const currentFace = manualIcoSequence[manualIcoSequence.length - 1] ?? piecePathItems[effectiveIndex]?.face ?? activeFacePath[0] ?? null;
  const currentTonnetz = manualTonnetzSequence[manualTonnetzSequence.length - 1] ?? piecePathItems[effectiveIndex]?.tonnetzId ?? activeTonnetzPath[0] ?? null;
  const faceStep = manualIcoSequence.length ? manualIcoSequence.length - 1 : (faceStepMap[effectiveIndex] ?? 0);
  const tonnetzStep = manualTonnetzSequence.length ? manualTonnetzSequence.length - 1 : (tonnetzStepMap[effectiveIndex] ?? 0);
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
    midiTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    midiTimeoutsRef.current = [];
    midiStartedAtRef.current = null;
    midiPlayingRef.current = false;
    stopPiano();
    setMidiPlaying(false);
    setMidiProgressSec(0);
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
  }, [selectedDemoId, stopPiano]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!midiPlaying || midiStartedAtRef.current === null || !midiPilot) return;
      const elapsedSec = Math.min(midiPilot.duration, (performance.now() - midiStartedAtRef.current) / 1000);
      setMidiProgressSec(elapsedSec);
    }, 50);
    return () => window.clearInterval(id);
  }, [midiPlaying, midiPilot]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!isPlaying || geometrySource !== 'demo') return;
      const audio = audioRef.current;
      if (!audio) return;
      setCurrentSec(audio.currentTime || 0);
    }, 50);
    return () => window.clearInterval(id);
  }, [isPlaying, geometrySource]);

  const clearMidiTimers = useCallback(() => {
    midiTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    midiTimeoutsRef.current = [];
  }, []);

  const getMidiProgress = useCallback((pilot: MidiPilot) => {
    if (midiStartedAtRef.current === null) return midiProgressSec;
    return Math.min(pilot.duration, (performance.now() - midiStartedAtRef.current) / 1000);
  }, [midiProgressSec]);

  const stopScheduledMidi = useCallback((nextProgressSec?: number) => {
    clearMidiTimers();
    midiStartedAtRef.current = null;
    midiPlayingRef.current = false;
    stopPiano();
    setMidiPlaying(false);
    if (typeof nextProgressSec === 'number') setMidiProgressSec(nextProgressSec);
  }, [clearMidiTimers, stopPiano]);

  const startScheduledMidi = useCallback(async (pilot: MidiPilot, offsetSec: number) => {
    await ensureStarted();
    clearMidiTimers();
    stopPiano();
    midiStartedAtRef.current = performance.now() - offsetSec * 1000;
    midiPlayingRef.current = true;
    setMidiPlaying(true);
    setMidiProgressSec(offsetSec);

    pilot.notes.forEach((note) => {
      const noteEnd = note.time + note.duration;
      if (noteEnd <= offsetSec) return;
      const delayMs = Math.max(0, (note.time - offsetSec) * 1000);
      const playDuration = note.time < offsetSec ? Math.max(0.03, noteEnd - offsetSec) : Math.max(0.03, note.duration);
      const timeoutId = window.setTimeout(() => {
        if (!midiPlayingRef.current) return;
        scheduleNote(note.name, playDuration, Tone.now() + 0.01, note.velocity);
      }, delayMs);
      midiTimeoutsRef.current.push(timeoutId);
    });

    const endTimeoutId = window.setTimeout(() => {
      stopScheduledMidi(pilot.duration);
    }, Math.max(0, (pilot.duration - offsetSec) * 1000) + 60);
    midiTimeoutsRef.current.push(endTimeoutId);
  }, [clearMidiTimers, ensureStarted, scheduleNote, stopPiano, stopScheduledMidi]);

  useEffect(() => {
    return () => {
      stopScheduledMidi();
    };
  }, [stopScheduledMidi]);

  const handleMidiUpload = useCallback(async (file: File | null) => {
    if (!file) return;
    setMidiError('');
    try {
      const buffer = await file.arrayBuffer();
      const midi = new Midi(buffer);
      const notes: ScoreNote[] = midi.tracks.flatMap((track, ti) => track.notes.map((n) => ({ midi: n.midi, name: n.name, time: n.time, duration: n.duration, velocity: n.velocity, track: ti }))).sort((a: ScoreNote, b: ScoreNote) => a.time - b.time || a.midi - b.midi);
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
      stopScheduledMidi(0);
    } catch (err) {
      setMidiError('Could not parse the MIDI file. Please try another .mid or .midi file.');
    }
  }, [stopScheduledMidi]);

  const handleMidiPlayPause = useCallback(async () => {
    if (!midiPilot) return;
    if (midiPlaying) {
      stopScheduledMidi(getMidiProgress(midiPilot));
      return;
    }
    await startScheduledMidi(midiPilot, midiProgressSec);
  }, [midiPilot, midiPlaying, midiProgressSec, getMidiProgress, startScheduledMidi, stopScheduledMidi]);

  const handleMidiRestart = useCallback(async () => {
    if (!midiPilot) return;
    stopScheduledMidi(0);
    setCurrentIndex(0);
  }, [midiPilot, stopScheduledMidi]);

  const handleMidiStop = useCallback(() => {
    stopScheduledMidi(0);
  }, [stopScheduledMidi]);

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
    if (geometrySource === 'midi' && midiPilot) {
      const t = analysisEventTimes[nextIndex] ?? 0;
      if (midiPlaying) {
        void startScheduledMidi(midiPilot, t);
      } else {
        stopScheduledMidi(t);
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio || !durationSec) return;
    const startMs = analysisTimeline.startTimesMs[nextIndex] ?? 0;
    const t = analysisTimeline.totalMs ? (startMs / analysisTimeline.totalMs) * durationSec : 0;
    audio.currentTime = t;
    setCurrentSec(t);
    audio.pause();
    setIsPlaying(false);
  }, [analysisEvents.length, effectiveIndex, geometrySource, midiPilot, analysisEventTimes, midiPlaying, startScheduledMidi, stopScheduledMidi, analysisTimeline, durationSec]);

  const scrub = useCallback((value: number) => {
    const total = analysisEvents.length;
    const safe = Math.max(0, Math.min(total - 1, value));
    setCurrentIndex(safe);
    if (geometrySource === 'midi' && midiPilot) {
      const t = analysisEventTimes[safe] ?? 0;
      if (midiPlaying) {
        void startScheduledMidi(midiPilot, t);
      } else {
        stopScheduledMidi(t);
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio || !durationSec) return;
    const startMs = analysisTimeline.startTimesMs[safe] ?? 0;
    const t = analysisTimeline.totalMs ? (startMs / analysisTimeline.totalMs) * durationSec : 0;
    audio.currentTime = t;
    setCurrentSec(t);
    audio.pause();
    setIsPlaying(false);
  }, [analysisEvents.length, geometrySource, midiPilot, analysisEventTimes, midiPlaying, startScheduledMidi, stopScheduledMidi, analysisTimeline, durationSec]);

  const handleFaceClick = useCallback(async (faceIndex: number) => {
    await playChord(chordForFace(faceIndex, activeMap), 420);
    setManualIcoSequence((prev) => prev.concat([faceIndex]));
  }, [activeMap, playChord]);

  const handleTonnetzClick = useCallback(async (tri: TonnetzTri) => {
    setSelectedTonnetzId(tri.id);
    await playChord(tri.notes, 420);
    setManualTonnetzSequence((prev) => prev.concat([tri.id]));
  }, [playChord]);

  const playManualFaces = useCallback(async () => {
    for (const face of manualIcoSequence) {
      await playChord(chordForFace(face, activeMap), 320);
    }
  }, [manualIcoSequence, activeMap, playChord]);

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
                <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1">See harmonic motion</span>
                <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1">Upload your own MIDI</span>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-sky-300 mb-2">{TITLE}</div>
                <h1 className="max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl">{SUBTITLE}</h1>
                <p className="mt-4 max-w-4xl text-base leading-relaxed text-slate-200 sm:text-lg">
                  Harmonic Atlas turns abstract harmony into something you can hear, watch, and explore. Listen to reference recordings from Bach, Chopin, and Rachmaninoff, or upload your own MIDI file to see how changing notes become moving shapes across an icosahedron and a Tonnetz.
                </p>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
                  No specialist background is required: when the harmony changes, the geometry moves with it. The result is a more intuitive way to understand musical tension, release, color, and direction.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Listen</div>
                  <div className="mt-2 text-lg font-medium text-white">Reference performances</div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-300">Start with familiar recordings, then compare what you hear with what the geometry reveals.</div>
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
                  <div className="text-sm text-slate-300">reference works included</div>
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
                <div className="mt-1 text-sm leading-relaxed text-slate-300">Start with a built-in recording or upload your own MIDI.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step 2</div>
                <div className="mt-2 text-base font-medium text-white">Watch the route</div>
                <div className="mt-1 text-sm leading-relaxed text-slate-300">The pink path shows how harmony travels through the atlas.</div>
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
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.ico} The icosahedron shows long-range motion</div>Each triangular face represents a compact harmonic cell. As the music changes, the highlight jumps across the solid, making large harmonic turns feel like a visible journey through space.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.tonnetz} The Tonnetz shows local relationships</div>The Tonnetz is flatter, closer, and more immediate. It helps you notice when harmonies stay near one another, share notes, or shift by small voice-leading steps.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.path} Why the route keeps changing</div>The system compares each active harmony with the available cells in both geometries, then highlights the closest match. What you see is the shape of the music unfolding in real time.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.audio} Built-in audio and user MIDI</div>You can stay with the included reference recordings, or switch to your own MIDI material. That makes the atlas useful both as a curated demonstration space and as a hands-on analysis tool.</div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4"><div className="mb-2 font-medium text-slate-100">{ICONS.exact} What happens after upload</div>Your MIDI file is parsed into note onsets, durations, pitches, and velocities. From there, the app groups notes into harmonic slices, maps them onto both geometries, and can play them back through the piano engine.</div>
          </div>
        </Section>

        <Section title="Upload any MIDI and trace its harmonic route" subtitle="Bring in your own `.mid` or `.midi` file. The uploaded note data can drive playback, analysis, and the moving geometry." icon="📁" eyebrow="User input" tone="emerald">
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
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Slices</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.events.length}</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Duration</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.duration.toFixed(2)} s</div></div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Tempo</div><div className="mt-2 text-lg font-semibold text-white">{midiPilot.bpm ? midiPilot.bpm.toFixed(1) : 'N/A'}</div></div>
                </div>
              ) : <div className="text-slate-400">Upload any MIDI file to turn its notes into harmonic motion across the atlas.</div>}
            </div>
            <div className="rounded-3xl border border-sky-300/10 bg-[linear-gradient(180deg,rgba(14,165,233,0.12),rgba(15,23,42,0.72))] p-5 shadow-lg space-y-4">
              <div className="font-medium text-slate-100">{ICONS.audio} Playback and geometric control</div>
              <div className="rounded-2xl border border-sky-300/10 bg-sky-300/5 p-3 text-slate-300">Use this panel to decide whether the screen should follow the built-in reference material or the exact note data from your uploaded MIDI file.</div>
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
          <Section title="Icosahedron" subtitle="Large fixed-scale view. Drag to rotate. Click faces to hear and build your own route." icon="🔺" eyebrow="Geometry A" tone="sky">
            <div className="flex gap-3 flex-wrap text-sm">
              <button className={showPath ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'} onClick={() => setShowPath((v) => !v)}>Path</button>
              <button className={showNumbers ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'} onClick={() => setShowNumbers((v) => !v)}>Numbers</button>
              <button className="px-3 py-2 rounded-xl border border-white/10 bg-white/5" onClick={() => { setRotX(DEFAULT_ROT_X); setRotY(DEFAULT_ROT_Y); }}>Reset rotation</button>
              <button className="px-3 py-2 rounded-xl bg-violet-300 text-slate-950 shadow-lg" onClick={playManualFaces}>Play manual face path</button>
              <button className="px-3 py-2 rounded-xl border border-white/10 bg-white/5" onClick={() => setManualIcoSequence([])}>Clear manual path</button>
            </div>
            <IcosahedronView projected={projected} faceCentroidsMap={faceCentroidsMap} currentFace={currentFace} path={activeFacePath} step={faceStep} showPath={showPath} showNumbers={showNumbers} detailedPath={detailedGeometryPath} onFaceClick={handleFaceClick} noteMap={activeMap} rotX={rotX} rotY={rotY} setRotX={setRotX} setRotY={setRotY} />
          </Section>

          <div className="space-y-6">
            <Section title="Works and playback" subtitle="Choose a reference recording, then compare it with the route generated from your own MIDI if you want a second perspective." icon="🎧" eyebrow="Listening" tone="amber">
              <select value={selectedDemoId} onChange={(e) => setSelectedDemoId(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm shadow-inner">
                {DEMOS.map((demo) => <option key={demo.id} value={demo.id}>{demo.composer} — {demo.title}</option>)}
              </select>
              <div className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))] p-5 shadow-lg">
                <div className="font-medium text-white">{selectedDemo.composer} — {selectedDemo.title}</div>
                <div className="mt-2 text-sm text-slate-300">{selectedDemo.subtitle}</div>
                <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs text-slate-400">Source: {selectedDemo.sourceLabel}</div>
              </div>
              <div className="flex gap-3 flex-wrap pt-1">
                <button onClick={handlePlayPause} className={isPlaying ? 'px-3 py-2 rounded-xl text-sm bg-rose-300 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl text-sm bg-emerald-300 text-slate-950 shadow-lg'}>{isPlaying ? 'Pause' : currentSec > 0 ? 'Resume' : 'Play'}</button>
                <button onClick={stopPlayback} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm">From start</button>
                <button onClick={() => nudgeFrame(-1)} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm">Back</button>
                <button onClick={() => nudgeFrame(1)} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm">Forward</button>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm text-slate-300">Playback speed: {tempoScale.toFixed(2)}x</div>
                <input type="range" min={0.65} max={1.35} step={0.05} value={tempoScale} onChange={(e) => {
                  const next = Number(e.target.value);
                  setTempoScale(next);
                  if (audioRef.current) audioRef.current.playbackRate = next;
                }} className="mt-2 w-full" />
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm text-slate-300">Position: {effectiveIndex + 1} / {analysisEvents.length}</div>
                <input type="range" min={0} max={Math.max(0, analysisEvents.length - 1)} step={1} value={effectiveIndex} onChange={(e) => scrub(Number(e.target.value))} className="mt-2 w-full" />
              </div>
            </Section>

            <Section title="Current harmonic snapshot" subtitle="This panel shows the harmony that is currently driving the geometry, whether it comes from a reference track or from your uploaded MIDI." icon="🎯" eyebrow="Live state" tone="violet">
              <div className="rounded-3xl border border-white/8 bg-[linear-gradient(135deg,rgba(76,29,149,0.20),rgba(15,23,42,0.80))] p-5 shadow-lg">
                <div className="text-slate-400 text-sm mb-1">Now sounding in the geometric layer</div>
                <div className="text-2xl font-semibold tracking-tight text-white">{currentEvent.harmony.join(' – ')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-violet-200/12 bg-violet-300/10 px-3 py-1 text-xs text-violet-100">Frame {effectiveIndex + 1}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs text-slate-300">{geometrySource === 'midi' ? 'Source: uploaded MIDI' : 'Source: reference track'}</span>
                </div>
                <div className="text-sm text-slate-300 mt-3">{currentEvent.label || currentEvent.notes.join(' · ')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <MetricCard title="Global geometry" top={`Average common tones: ${stats.avgCommon}`} bottom={`Average voice-leading distance: ${stats.avgDistance}`} />
                <MetricCard title="Current match" top={`Icosahedron face: ${String(currentFace)}`} bottom={`Tonnetz cell: ${String(currentTonnetz || '—')}`} />
              </div>
            </Section>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-6">
          <Section title="Tonnetz" subtitle="A planar harmonic network for close relationships. Click cells to build your own route and compare it with the icosahedron." icon="🕸️" eyebrow="Geometry B" tone="violet">
            <div className="flex gap-3 flex-wrap text-sm">
              <button onClick={() => setTonnetzMode('chromatic')} className={tonnetzMode === 'chromatic' ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'}>Standard labels</button>
              <button onClick={() => setTonnetzMode('fifths')} className={tonnetzMode === 'fifths' ? 'px-3 py-2 rounded-xl bg-slate-100 text-slate-950 shadow-lg' : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5'}>Fifths labels</button>
              <button onClick={() => setManualTonnetzSequence([])} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5">Clear manual Tonnetz path</button>
            </div>
            <TonnetzView triangles={tonnetzTriangles} currentId={currentTonnetz || selectedTonnetzId} activePathIds={activeTonnetzPath} step={tonnetzStep} detailedPath={detailedGeometryPath} onTriangleClick={handleTonnetzClick} />
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
