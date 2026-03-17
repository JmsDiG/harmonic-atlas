# Harmonic Atlas
### Icosahedron and Tonnetz Audio Edition

<img width="621" height="559" alt="image" src="https://github.com/user-attachments/assets/8cadf77d-bc58-43c9-8a7c-9abade642e81" />


Harmonic Atlas is an interactive web laboratory for exploring harmonic motion through geometry. It maps musical material into two complementary spaces: a three-dimensional musical icosahedron and Euler’s Tonnetz.

The project combines:
- full-audio classical works,
- animated harmonic paths,
- interactive face and cell selection,
- and a MIDI-driven pilot for score-based harmonic analysis.

## Live Demo
[Open the web app](https://jmsdig.github.io/harmonic-atlas/)

## Why this project exists
Most listeners experience harmony as sound, while most analyses describe it through notation, labels, or abstract theoretical language. Harmonic Atlas was created to make harmony visible as motion in space.

Research inspiration - this project is inspired by M. I. Kornev, "The Technique of Musical Icosahedra," Muzykalnaya Akademiya, 2025, no. 3, pp. 64-83. DOI: 10.34690/479.

The application lets users compare two geometric readings of the same musical passage:
- global movement on a three-dimensional icosahedron,
- local harmonic adjacency on Euler’s Tonnetz.

Instead of treating harmonic motion only as a sequence of symbolic chords, Harmonic Atlas presents it as a navigable spatial process.

## Core Idea
The project is built around two complementary representations of harmony.

### 1. Musical Icosahedron
The twelve vertices of the icosahedron carry pitch labels. Each triangular face then becomes a harmonic cell derived from the three notes on its corners. As music progresses, the active harmony can be mapped to a face, allowing harmonic succession to appear as a path over a three-dimensional surface.

### 2. Euler’s Tonnetz
The Tonnetz is a planar network of harmonic proximity. It highlights shared tones, local adjacency, and compact voice-leading. A passage that looks globally dramatic on the icosahedron may appear locally smooth on the Tonnetz.

### 3. Comparative Geometric Listening
The same musical material is interpreted simultaneously in both spaces. This makes it possible to compare:
- large-scale form and return,
- local harmonic smoothness,
- repeated harmonic states,
- and the difference between symbolic and score-driven motion.

## Features
- Interactive 3D icosahedron visualization
- Interactive Tonnetz visualization
- Full-audio playback of selected classical works
- Animated geometric path tracking during playback
- Manual clicking on faces and Tonnetz cells
- MIDI upload pipeline for score-driven harmonic slicing
- Rachmaninoff Prelude in C-sharp minor pilot mode
- Vertex pitch remapping
- Cycle-of-fifths and chromatic labeling options

## Included Works
The current version includes full-audio playback for the following works:
- J.S. Bach — Prelude in C major, BWV 846
- J.S. Bach — Cello Suite No. 1 Prelude, BWV 1007
- Frédéric Chopin — Prelude in E minor, Op. 28 No. 4
- Frédéric Chopin — Nocturne in E-flat major, Op. 9 No. 2
- Sergei Rachmaninoff — Prelude in C-sharp minor, Op. 3 No. 2

## MIDI Pilot
The repository includes a score-driven experimental pathway

In this mode, the user can upload a MIDI file and run a note-driven pipeline:
1. parse note events,
2. extract onset-based harmonic slices,
3. map those slices to the icosahedron and Tonnetz,
4. compare the score-driven path with the built-in geometric reading.

This part of the project is especially useful for testing how exact note streams differ from curated symbolic harmonic models.

## How the system works
At a high level, Harmonic Atlas operates in two layers:

### Listening Layer
Built-in works use full external recordings for complete musical playback.

### Analytical Layer
A parallel event-based harmonic layer maps the currently active state into:
- an icosahedron face,
- a Tonnetz cell,
- and an evolving visible path.

For uploaded MIDI, the analytical layer is derived directly from parsed note events.

## Tech Stack
- React
- TypeScript
- Vite
- Tone.js
- @tonejs/midi
- GitHub Pages

## Project status
- actively developed
- current focus: improving exact MIDI playback and route fidelity
- future direction: full MusicXML/MIDI score-driven mapping

## Credits
- Wikimedia Commons audio sources
- Tone.js
- @tonejs/midi
- M. I. Kornev, "The Technique of Musical Icosahedra," Muzykalnaya Akademiya, 2025, no. 3, pp. 64-83. DOI: 10.34690/479.

## Running Locally
### 1. Clone the repository
```bash
git clone https://github.com/JmsDiG/harmonic-atlas.git
cd harmonic-atlas
