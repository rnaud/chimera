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

interface Voice { name: string; f0: number; pan: number }
interface SceneDef {
  id: string;
  title: string;
  set: "car" | "apartment";
  /** in the order of the set's places */
  voices: Voice[];
  /** who, the line, and the pause before it (s) */
  lines: [number, string, number][];
  /** each gunman's pistol is levelled by the start of this line */
  aim?: { voice: number; line: number; late: number }[];
  /** after the last line: a pause, then who fires and how long after the shot before */
  shots?: { after: number; by: [number, number][] };
  outro: number;
}

const SCENES: SceneDef[] = [
  {
    id: "royale",
    title: "Royale with cheese",
    set: "car",
    voices: [
      { name: "Vincent", f0: 122, pan: -0.45 },
      { name: "Jules", f0: 96, pan: 0.45 },
    ],
    lines: [
      [0, "You know what they call a quarter pounder with cheese in Paris?", 3.2],
      [1, "They don't call it a quarter pounder with cheese?", 0.45],
      [0, "No man. They got the metric system.", 0.4],
      [1, "Then what do they call it?", 0.5],
      [0, "They call it a Royale with cheese.", 0.55],
      [1, "Royale with cheese.", 0.9],
    ],
    outro: 3.0,
  },
  {
    id: "ezekiel",
    title: "Ezekiel 25:17",
    set: "apartment",
    voices: [
      { name: "Jules", f0: 94, pan: 0.3 },
      { name: "Vincent", f0: 122, pan: 0.55 },
      { name: "Brett", f0: 158, pan: -0.5 },
    ],
    // the verse is Ezekiel 25:17 as the King James Bible has it
    lines: [
      [0, "Do you know the Bible, Brett?", 3.0],
      [2, "Yes.", 0.5],
      [0, "There is one verse I know by heart. Ezekiel twenty five, seventeen.", 0.7],
      [0, "And I will execute great vengeance upon them, with furious rebukes.", 0.9],
      [0, "And they shall know that I am the Lord, when I shall lay my vengeance upon them.", 0.6],
    ],
    aim: [
      { voice: 0, line: 4, late: 0.2 },
      { voice: 1, line: 4, late: 1.1 },
    ],
    shots: { after: 0.75, by: [[0, 0], [1, 0.16], [0, 0.2], [0, 0.24], [1, 0.14], [0, 0.22], [1, 0.3], [0, 0.42]] },
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
  const say = (stem: string, text: string, who: number) => {
    const r = Bun.spawnSync([CLI, "render", "text", stem, text, "male", "--f0", String(def.voices[who].f0), "--tele", `${stem}.tele`], { cwd: ROOT });
    if (r.exitCode !== 0) throw new Error(`chimera render text failed: ${r.stderr.toString()}`);
    return { wav: readWav(`${stem}.wav`), tele: readFileSync(`${stem}.tele`) };
  };
  interface Take { who: number; text: string; wav: Float32Array; tele: Buffer; start: number }
  const takes: Take[] = [];
  let sr = 0, hop = 0, frameLen = 0;
  let at = 0;
  for (const [i, [who, text, pause]] of def.lines.entries()) {
    const { wav, tele } = say(join(tmp, `line${i}`), text, who);
    sr = wav.sampleRate;
    hop = tele.readUInt32LE(12);
    frameLen = tele.readUInt32LE(20);
    // a line starts on a telemetry frame, so the stitched tracks stay frame-aligned
    const start = Math.round(((at + pause) * sr) / hop) * hop;
    takes.push({ who, text, wav: wav.channels[0], tele, start });
    at = start / sr + wav.channels[0].length / sr - TAIL;
    console.log(`${def.voices[who].name}: ${text}  (${(start / sr).toFixed(2)} s)`);
  }
  const shots: { voice: number; t: number }[] = [];
  if (def.shots) {
    let t = at + def.shots.after;
    for (const [voice, gap] of def.shots.by) {
      t += gap;
      shots.push({ voice, t: +t.toFixed(3) });
    }
    at = t + 0.5;
  }
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
    add(t.wav, t.start, def.voices[t.who].pan, 1);
    for (const v of t.wav) voicePeak = Math.max(voicePeak, Math.abs(v));
  }
  // the shots well over the voices
  shots.forEach((s, i) => add(gunshot(sr, 7 + 13 * i), Math.round(s.t * sr), def.voices[s.voice].pan, 1.1 * voicePeak));
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
    cues: takes.map((t) => ({ voice: t.who, text: t.text, start: +(t.start / sr + LEAD).toFixed(3), end: +(t.start / sr + t.wav.length / sr - TAIL).toFixed(3) })),
    aim: def.aim?.map((a) => ({ voice: a.voice, t: +(takes[a.line].start / sr + a.late).toFixed(3) })),
    shots: shots.length ? shots : undefined,
  };
  writeFileSync(join(OUT, "scene.json"), JSON.stringify(scene, null, 2) + "\n");
  console.log(`${OUT}: ${(total / sr).toFixed(2)} s, ${frames} telemetry frames per voice\n`);
}

const only = process.argv[2];
for (const def of SCENES) if (!only || def.id === only) build(def);
