/**
 * Builds the scene page's shows (`?scene=royale`, `?scene=ezekiel`): chimera heads acting two
 * short film scenes. Each line is spoken by the engine (`chimera render text … --f0 … --tele …`),
 * then the lines are laid end to end: one stereo mix, one telemetry track per voice (at rest
 * between its lines) and `scene.json` with each line's time, for the cuts, the head turns and
 * the subtitles. A scene's gunshots are noise bursts added to the mix, with their times.
 *
 *   cargo build --release -p chimera-cli && bun tools/scenes.ts
 *
 * Output: public/shows/<id>/ (gitignored, like every show).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWav, writeWav } from "./lib/wav.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "target/release/chimera");
/** `render text` starts speaking 50 ms in and leaves a 300 ms tail */
const LEAD = 0.05, TAIL = 0.3;
const HEADER = 48;

/** how a line is said (`chimera render text`'s flags); a line's own values override its voice's */
interface Delivery {
  /** speaking pitch (Hz) */
  f0?: number;
  /** speed (>1 faster) */
  rate?: number;
  /** how far stressed syllables rise (the planner's default is 0.14) */
  accent?: number;
  /** lung pressure (cmH2O; 8 is speech, 16 a shout) */
  pressure?: number;
  /** vocal fold tension, breathiness, roughness (0..1) */
  tension?: number;
  breath?: number;
  rough?: number;
}
interface Voice extends Delivery {
  name: string;
  f0: number;
  pan: number;
  /** level in the mix (dB): a soft voice brought up beside a louder one */
  gain?: number;
}
interface Line extends Delivery {
  who: number;
  text: string;
  /** the pause before it (s) */
  pause: number;
  /** the camera set-up it is filmed in (ScenePage.tsx); the same as the line before: no cut */
  shot: string;
  /** a gunman answers the line with one shot that wounds, this long after its last word (s) */
  bang?: { voice: number; after: number };
}
interface SceneDef {
  id: string;
  title: string;
  set: "car" | "apartment";
  /** in the order of the set's places */
  voices: Voice[];
  lines: Line[];
  /** each gunman's pistol is levelled by the start of this line */
  aim?: { voice: number; line: number; late: number }[];
  /** after the last line: a pause, then who fires and how long after the shot before */
  shots?: { after: number; by: [number, number][] };
  outro: number;
}

/**
 * The deliveries follow the film's, as far as the engine's controls go. In the car the passenger
 * drawls, low and soft, and the driver is quicker and higher, his questions climbing. In the
 * apartment the first lines are quiet and level, then the verse builds phrase by phrase (pitch,
 * lung pressure, fold tension and roughness all rising, the pace slowing) to a shout, and the
 * shots come on the last word.
 */
const SCENES: SceneDef[] = [
  {
    id: "royale",
    title: "Royale with cheese",
    set: "car",
    voices: [
      { name: "Vincent", f0: 108, pan: -0.45, rate: 0.96, breath: 0.3, tension: 0.42, accent: 0.12, gain: 5 },
      { name: "Jules", f0: 128, pan: 0.45, rate: 1.08, tension: 0.55, accent: 0.2 },
    ],
    lines: [
      { who: 0, text: "You know what they call a quarter pounder with cheese in Paris?", pause: 3.2, shot: "two" },
      { who: 1, text: "They don't call it a quarter pounder with cheese?", pause: 0.22, shot: "driver", f0: 152, accent: 0.26, rate: 1.12 },
      { who: 0, text: "No man. They got the metric system.", pause: 0.18, shot: "passenger", rate: 1.02 },
      { who: 1, text: "Then what do they call it?", pause: 0.3, shot: "low", f0: 134 },
      { who: 0, text: "They call it a Royale with cheese.", pause: 0.45, shot: "passenger", f0: 112, rate: 0.86, accent: 0.2 },
      { who: 1, text: "Royale with cheese.", pause: 0.75, shot: "driver", f0: 118, rate: 0.8, accent: 0.24 },
    ],
    outro: 3.0,
  },
  {
    id: "ezekiel",
    title: "Ezekiel 25:17",
    set: "apartment",
    voices: [
      { name: "Jules", f0: 112, pan: 0.3, rate: 0.94 },
      { name: "Vincent", f0: 108, pan: 0.55 },
      { name: "Brett", f0: 168, pan: -0.5, breath: 0.45, pressure: 6, tension: 0.4 },
    ],
    // The questions and the dare are condensed and mostly reworded; the verse is Ezekiel 25:17 as
    // the King James Bible has it.
    lines: [
      // the questions: he gets louder and higher, the answers more frightened
      { who: 0, text: "Describe Marsellus Wallace for me.", pause: 3.0, shot: "looming", f0: 118 },
      { who: 2, text: "What?", pause: 0.45, shot: "chair", f0: 172 },
      { who: 0, text: "Which country are you from?", pause: 0.3, shot: "looming", f0: 132, rate: 1.0, pressure: 9.5, tension: 0.58, accent: 0.2 },
      { who: 2, text: "What?", pause: 0.3, shot: "chair", f0: 186, rate: 1.1 },
      { who: 0, text: "I never heard of a country called What. Do they speak English there?", pause: 0.22, shot: "looming", f0: 150, rate: 1.04, pressure: 11, tension: 0.64, accent: 0.24, rough: 0.14 },
      { who: 2, text: "What?", pause: 0.22, shot: "chair", f0: 202, rate: 1.15, pressure: 7 },
      { who: 0, text: "English! Do you speak it?", pause: 0.15, shot: "looming", f0: 205, rate: 0.95, pressure: 15, tension: 0.76, accent: 0.28, rough: 0.26 },
      { who: 2, text: "Yes.", pause: 0.3, shot: "chair", f0: 196, rate: 1.1 },
      // the dare: lower again, slow, every word leaned on
      { who: 0, text: "Then say what again.", pause: 0.5, shot: "looming", f0: 150, rate: 0.82, pressure: 12, tension: 0.7, accent: 0.3, rough: 0.2 },
      { who: 0, text: "I dare you.", pause: 0.35, shot: "looming", f0: 138, rate: 0.72, pressure: 11, tension: 0.7, accent: 0.3, rough: 0.2 },
      { who: 2, text: "What?", pause: 0.9, shot: "chair", f0: 180, rate: 0.9, pressure: 5, breath: 0.6, bang: { voice: 0, after: 0.2 } },
      // the verse
      { who: 0, text: "Do you know the Bible, Brett?", pause: 1.6, shot: "looming" },
      { who: 2, text: "Yes!", pause: 0.5, shot: "chair", f0: 214, pressure: 9, tension: 0.6, rate: 1.1 },
      { who: 0, text: "There is one verse I know by heart.", pause: 0.9, shot: "room", f0: 108, rate: 0.9 },
      { who: 0, text: "Ezekiel twenty five, seventeen.", pause: 0.55, shot: "room", f0: 116, rate: 0.84, accent: 0.2 },
      { who: 0, text: "And I will execute great vengeance upon them,", pause: 1.2, shot: "looming", f0: 138, rate: 0.88, accent: 0.2, pressure: 10, tension: 0.6 },
      { who: 0, text: "with furious rebukes.", pause: 0.3, shot: "looming", f0: 162, rate: 0.8, accent: 0.26, pressure: 12, tension: 0.66, rough: 0.16 },
      { who: 0, text: "And they shall know that I am the Lord,", pause: 0.55, shot: "barrels", f0: 192, rate: 0.84, accent: 0.26, pressure: 14, tension: 0.72, rough: 0.2 },
      { who: 0, text: "when I shall lay my vengeance upon them!", pause: 0.65, shot: "barrels", f0: 226, rate: 0.78, accent: 0.3, pressure: 16, tension: 0.78, rough: 0.28 },
    ],
    aim: [
      // his pistol comes up as he shouts, and stays up; the other's on the verse's third phrase
      { voice: 0, line: 6, late: 0.3 },
      { voice: 1, line: 17, late: 0.7 },
    ],
    shots: { after: 0.12, by: [[0, 0], [1, 0.1], [0, 0.14], [1, 0.12], [0, 0.15], [0, 0.13], [1, 0.16], [0, 0.2], [1, 0.3]] },
    outro: 3.2,
  },
];

/** a small repeatable noise source */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2147483648 - 1;
  };
}

/** a pistol shot: a crack, a thump under it, and the room's tail */
function gunshot(sr: number, seed: number): Float32Array {
  const n = Math.round(0.5 * sr), out = new Float32Array(n), rnd = noise(seed);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = rnd();
    lp += 0.18 * (w - lp);
    lp2 += 0.04 * (w - lp2);
    out[i] = 0.9 * w * Math.exp(-t / 0.012) + 1.6 * lp * Math.exp(-t / 0.05) + 1.1 * Math.sin(2 * Math.PI * (95 - 60 * t) * t) * Math.exp(-t / 0.07) + 1.2 * lp2 * Math.exp(-t / 0.16);
  }
  return out;
}

function build(def: SceneDef): void {
  const OUT = join(ROOT, "public/shows", def.id);
  const tmp = mkdtempSync(join(tmpdir(), `${def.id}-`));
  const FLAGS: (keyof Delivery)[] = ["f0", "rate", "accent", "pressure", "tension", "breath", "rough"];
  const say = (stem: string, text: string, who: number, line: Delivery = {}) => {
    const d: Delivery = { ...def.voices[who], ...line };
    const flags = FLAGS.flatMap((k) => (d[k] === undefined ? [] : [`--${k}`, String(d[k])]));
    const r = Bun.spawnSync([CLI, "render", "text", stem, text, "male", ...flags, "--tele", `${stem}.tele`], { cwd: ROOT });
    if (r.exitCode !== 0) throw new Error(`chimera render text failed: ${r.stderr.toString()}`);
    return { wav: readWav(`${stem}.wav`), tele: readFileSync(`${stem}.tele`) };
  };
  interface Take { who: number; text: string; shot: string; wav: Float32Array; tele: Buffer; start: number }
  const takes: Take[] = [];
  let sr = 0, hop = 0, frameLen = 0;
  let at = 0;
  /** `wound`: one shot in answer to a line; the rest are the volley that ends the scene */
  const shots: { voice: number; t: number; wound?: boolean }[] = [];
  for (const [i, line] of def.lines.entries()) {
    const { who, text, pause, shot, bang: _bang, ...delivery } = line;
    const { wav, tele } = say(join(tmp, `line${i}`), text, who, delivery);
    sr = wav.sampleRate;
    hop = tele.readUInt32LE(12);
    frameLen = tele.readUInt32LE(20);
    // a line starts on a telemetry frame, so the stitched tracks stay frame-aligned
    const start = Math.round(((at + pause) * sr) / hop) * hop;
    takes.push({ who, text, shot, wav: wav.channels[0], tele, start });
    at = start / sr + wav.channels[0].length / sr - TAIL;
    if (line.bang) {
      at += line.bang.after;
      shots.push({ voice: line.bang.voice, t: +at.toFixed(3), wound: true });
    }
    let sq = 0;
    for (const v of wav.channels[0]) sq += v * v;
    console.log(`${(start / sr).toFixed(2).padStart(6)} s  ${(wav.channels[0].length / sr - TAIL - LEAD).toFixed(2)} s long  ${(10 * Math.log10(sq / wav.channels[0].length)).toFixed(0)} dB  ${def.voices[who].name}: ${text}`);
  }
  if (def.shots) {
    let t = at + def.shots.after;
    for (const [voice, gap] of def.shots.by) {
      t += gap;
      shots.push({ voice, t: +t.toFixed(3) });
    }
    at = t + 0.5;
  }
  shots.sort((a, b) => a.t - b.t);
  const total = Math.ceil(((at + def.outro) * sr) / hop) * hop;
  const frames = total / hop + 1;

  // the mix: each voice a little to its side
  const L = new Float32Array(total), R = new Float32Array(total);
  const add = (x: Float32Array, start: number, pan: number, gain: number) => {
    const a = ((pan + 1) * Math.PI) / 4, gl = gain * Math.cos(a), gr = gain * Math.sin(a);
    for (let i = 0; i < x.length && start + i < total; i++) {
      L[start + i] += gl * x[i];
      R[start + i] += gr * x[i];
    }
  };
  let voicePeak = 0;
  for (const t of takes) {
    const g = 10 ** ((def.voices[t.who].gain ?? 0) / 20);
    add(t.wav, t.start, def.voices[t.who].pan, g);
    for (const v of t.wav) voicePeak = Math.max(voicePeak, g * Math.abs(v));
  }
  // the shots over even the loudest line
  shots.forEach((s, i) => add(gunshot(sr, 7 + 13 * i), Math.round(s.t * sr), def.voices[s.voice].pan, 0.75 * voicePeak));
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = peak > 0 ? 0.92 / peak : 1;
  for (let i = 0; i < total; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  mkdirSync(OUT, { recursive: true });
  writeWav(join(OUT, "mix.wav"), [L, R], sr);

  // one telemetry track per voice: its lines in place, a frame at rest everywhere else
  def.voices.forEach((v, who) => {
    const mine = takes.filter((t) => t.who === who);
    // a voice with no lines still needs its body's frame at rest: say anything, keep frame 0
    const first = mine[0]?.tele ?? say(join(tmp, `rest${who}`), "Ah.", who).tele;
    const out = Buffer.alloc(HEADER + 4 * frames * frameLen);
    first.copy(out, 0, 0, HEADER);
    out.writeUInt32LE(frames, 16);
    const rest = first.subarray(HEADER, HEADER + 4 * frameLen);
    for (let f = 0; f < frames; f++) rest.copy(out, HEADER + 4 * f * frameLen);
    for (const t of mine) {
      if (t.tele.readUInt32LE(20) !== frameLen) throw new Error("a line's telemetry frames differ in size");
      const n = Math.min(t.tele.readUInt32LE(16), frames - t.start / hop);
      t.tele.copy(out, HEADER + 4 * (t.start / hop) * frameLen, HEADER, HEADER + 4 * n * frameLen);
    }
    writeFileSync(join(OUT, `${v.name.toLowerCase()}.tele`), out);
  });

  const scene = {
    title: def.title,
    set: def.set,
    audio: "mix.wav",
    voices: def.voices.map((v) => ({ name: v.name, tele: `${v.name.toLowerCase()}.tele` })),
    cues: takes.map((t) => ({ voice: t.who, text: t.text, shot: t.shot, start: +(t.start / sr + LEAD).toFixed(3), end: +(t.start / sr + t.wav.length / sr - TAIL).toFixed(3) })),
    aim: def.aim?.map((a) => ({ voice: a.voice, t: +(takes[a.line].start / sr + a.late).toFixed(3) })),
    shots: shots.length ? shots : undefined,
  };
  writeFileSync(join(OUT, "scene.json"), JSON.stringify(scene, null, 2) + "\n");
  console.log(`${OUT}: ${(total / sr).toFixed(2)} s, ${frames} telemetry frames per voice\n`);
}

const only = process.argv[2];
for (const def of SCENES) if (!only || def.id === only) build(def);
