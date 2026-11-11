/**
 * The scene page (`?scene=<id>`): the duet page's heads staged together in one three.js scene, as
 * a film scene. The heads say a pre-rendered dialogue on a set (two in a car going down a street;
 * two standing over a third in an apartment, guns in hand), turn to each other as they speak, and
 * the camera cuts between wide shots and close-ups, under letterbox bars with subtitles.
 *
 * Like a duet, nothing is synthesized here: the page plays the mix and replays each voice's
 * recorded telemetry. The show is `public/shows/<id>/scene.json` (from `bun tools/scenes.ts`):
 *
 *   { "title": "…", "set": "car", "audio": "mix.wav",
 *     "voices": [{ "name": "Vincent", "tele": "vincent.tele" }, …],
 *     "cues": [{ "voice": 0, "text": "…", "shot": "two", "start": 3.25, "end": 6.54 }, …],
 *     "aim": [{ "voice": 0, "t": 14.2 }], "shots": [{ "voice": 0, "t": 19.1 }, …] }
 *
 * The voices take the set's places in order (stage3d.ts `PLACES`). `aim` is when a gunman has
 * his pistol levelled, `shots` when each one fires (the mix has the bangs).
 * Each head keeps its own three.js scene (its fog dims the far side of that head only); the heads
 * and the set are drawn one after another under one camera, and the beams blend by maximum, so
 * the order doesn't matter.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Screen } from "./Screen.tsx";
import { Anatomy3D } from "../render/anatomy3d.ts";
import { Hair, PLACES, Stage, yawTo, type Action, type P3, type SetName } from "../render/stage3d.ts";
import { Glow, label, wrapLabel } from "../render/vector.ts";
import { TeleTrack } from "../../show/tele.ts";
import { Transport } from "../../show/transport.ts";
import { getModel } from "../useModel.ts";
import { VoiceModel } from "../analysis.ts";
import type { ViewFlags } from "../render/anatomy.ts";
import { V } from "../colors.ts";

interface Cue {
  voice: number;
  text: string;
  /** the camera set-up this line is filmed in (the set's default for the line if absent) */
  shot?: string;
  start: number;
  end: number;
}
interface SceneFile {
  title: string;
  set?: SetName;
  audio: string;
  aim?: { voice: number; t: number }[];
  shots?: { voice: number; t: number }[];
  voices: { name: string; tele: string }[];
  cues: Cue[];
}
interface Loaded {
  scene: SceneFile;
  tracks: TeleTrack[];
}

const VIEW: ViewFlags = { pressure: true, particles: true, grid: false, calipers: false };

/** a camera set-up: where it starts and ends (it drifts from one to the other), what it looks at */
interface Shot {
  from: P3;
  to: P3;
  at: P3;
  fov: number;
  /** seconds the drift takes */
  dur: number;
}
/** what a head's turn depends on */
interface Moment {
  /** the playhead, and a clock that runs while paused too */
  t: number;
  wall: number;
  /** who is speaking (−1 nobody), and since when */
  speaker: number;
  since: number;
}
/** how a set is filmed and acted */
interface Direction {
  shots: Record<string, Shot>;
  /** before the first line, for each line in turn, and after the last */
  intro: string;
  lines: string[];
  outro: string;
  /** seconds after the last line that the outro shot begins */
  outroAfter: number;
  /** head i's turn (yaw about y) and nod now */
  act(i: number, m: Moment): { yaw: number; nod: number };
}

const CAR: Direction = {
  shots: {
    wide: { from: [470, 95, 300], to: [300, 38, 175], at: [20, -6, 0], fov: 27, dur: 3.4 },
    two: { from: [158, 15, 4], to: [146, 14, 0], at: [0, 9.5, 0], fov: 24, dur: 5 },
    low: { from: [142, 6, -30], to: [134, 7, -36], at: [0, 10, -3], fov: 23, dur: 4 },
    passenger: { from: [92, 14, 52], to: [86, 14, 48], at: [2, 11, 20], fov: 19, dur: 4 },
    driver: { from: [92, 14, -52], to: [86, 14, -48], at: [2, 11, -20], fov: 19, dur: 4 },
    away: { from: [250, 30, -190], to: [520, 120, -380], at: [0, -5, 0], fov: 27, dur: 6 },
  },
  intro: "wide",
  lines: ["two", "driver", "passenger", "low", "passenger", "driver"],
  outro: "away",
  outroAfter: 0.9,
  act(i, m) {
    // the passenger turns right round to talk; the driver keeps an eye on the road
    const driver = i === 1, to = driver ? -1 : 1;
    let want = driver ? 0.04 * Math.sin(m.wall * 0.5) : 0.12;
    if (m.speaker === i) want = driver ? 0.3 + 0.22 * Math.sin((m.t - m.since) * 2.4) : 0.62;
    else if (m.speaker >= 0) want = driver ? 0.12 + 0.1 * Math.sin(m.wall * 1.1) : 0.42;
    return { yaw: to * want, nod: 0 };
  },
};

const ROOM = PLACES.apartment;
const APARTMENT: Direction = {
  shots: {
    // the room from the side: the chair on the left, the two men on the right
    room: { from: [95, 40, 470], to: [90, 22, 380], at: [85, 4, 0], fov: 29, dur: 3.2 },
    // up at the first man from the chair
    looming: { from: [52, 2, -6], to: [66, 8, -10], at: [170, 49, -26], fov: 27, dur: 7 },
    // the man in the chair, past the others' shoulders
    chair: { from: [104, 26, 34], to: [96, 24, 30], at: [0, 10, 0], fov: 19, dur: 4 },
    // both of them from the chair, guns levelled at the lens
    barrels: { from: [44, 6, 8], to: [36, 4, 8], at: [172, 44, 7], fov: 33, dur: 6 },
    side: { from: [88, 14, 330], to: [88, 12, 310], at: [84, 6, 0], fov: 29, dur: 3 },
  },
  intro: "room",
  lines: ["looming", "chair", "room", "looming", "barrels"],
  outro: "side",
  outroAfter: 0.25,
  act(i, m) {
    const here = ROOM[i].seat;
    if (i === 2) {
      // the man in the chair watches whoever speaks, and steals looks at the other one
      const glance = Math.sin(m.wall * 0.9) > 0.86 ? 1 : 0;
      return { yaw: yawTo(here, ROOM[glance].seat) + 0.03 * Math.sin(m.wall * 9), nod: 0.14 + 0.02 * Math.sin(m.wall * 11) };
    }
    // the standing men look down at him; the one speaking sways with it
    const sway = m.speaker === i ? 0.09 * Math.sin((m.t - m.since) * 1.7) : 0.03 * Math.sin(m.wall * 0.6 + i);
    return { yaw: ROOM[i].yaw + sway, nod: -0.2 + (m.speaker === i ? 0.05 * Math.sin((m.t - m.since) * 2.9) : 0) };
  },
};
const DIRECTIONS: Record<SetName, Direction> = { car: CAR, apartment: APARTMENT };

/** the scenes there are, for the links between them */
const SCENES = [
  { id: "royale", title: "Royale with cheese" },
  { id: "ezekiel", title: "Ezekiel 25:17" },
];

const ease = (t: number) => t * t * (3 - 2 * t);
const follow = (x: number, target: number, tau: number, dt: number) => x + (target - x) * (1 - Math.exp(-dt / tau));
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  return r;
}

export function ScenePage(props: { id: string }) {
  const base = `${import.meta.env.BASE_URL}shows/${props.id}/`;
  const [transport, setTransport] = useState<Transport | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = new Transport();
    setTransport(t);
    return () => t.dispose();
  }, []);

  useEffect(() => {
    if (!transport) return;
    let live = true;
    setLoaded(null);
    (async () => {
      const scene = (await (await fetchOk(base + "scene.json")).json()) as SceneFile;
      if (!scene.audio || !scene.cues?.length || !PLACES[scene.set ?? "car"]) throw new Error("scene.json needs audio, cues and a set this page has");
      if (scene.voices?.length !== PLACES[scene.set ?? "car"].length) throw new Error(`the ${scene.set ?? "car"} set takes ${PLACES[scene.set ?? "car"].length} voices`);
      const [audio, ...teles] = await Promise.all([fetchOk(base + scene.audio).then((r) => r.arrayBuffer()), ...scene.voices.map((v) => fetchOk(base + v.tele).then((r) => r.arrayBuffer()))]);
      const tracks = teles.map((b) => new TeleTrack(b));
      await transport.load(audio);
      if (live) setLoaded({ scene, tracks });
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [base, transport]);

  useEffect(() => {
    if (!transport) return;
    const off = transport.subscribe(() => setTick((n) => n + 1));
    const id = setInterval(() => transport.isPlaying && setTick((n) => n + 1), 250);
    return () => {
      off();
      clearInterval(id);
    };
  }, [transport]);

  if (error)
    return (
      <div className="duet">
        <p className="duet-msg error">This scene could not load: {error}</p>
      </div>
    );
  const st = transport?.state ?? { playing: false, time: 0, duration: 0, epoch: 0 };
  return (
    <div className="duet">
      <header className="duet-top">
        <span className="wordmark">Chimera</span>
        <span className="duet-title">{loaded?.scene.title ?? "Loading…"}</span>
        <nav className="scene-links" aria-label="Scenes">
          {SCENES.map((sc) => (
            <a key={sc.id} href={`?scene=${sc.id}`} aria-current={sc.id === props.id ? "page" : undefined}>
              {sc.title}
            </a>
          ))}
          <a href="?synth">The synth</a>
        </nav>
      </header>
      <main className="duet-heads" style={{ "--voices": 1 } as React.CSSProperties}>
        {loaded && transport ? (
          <Screen className="duet-head" focus label={`${loaded.scene.title}: ${loaded.scene.voices.map((v) => v.name).join(", ")}, in 3D`}>
            <SceneView scene={loaded.scene} tracks={loaded.tracks} transport={transport} />
          </Screen>
        ) : (
          <p className="duet-msg">Loading the scene…</p>
        )}
      </main>
      <footer className="duet-bar">
        <button className="primary large" disabled={!loaded} onClick={() => (st.playing ? transport?.pause() : transport?.play())}>
          {st.playing ? "Pause" : st.duration > 0 && st.time >= st.duration - 0.05 ? "Again" : "Play"}
        </button>
        <span className="duet-time">
          {clock(st.time)} / {clock(st.duration)}
        </span>
        <input
          type="range"
          aria-label="Position in the scene"
          min={0}
          max={st.duration || 1}
          step={0.1}
          value={st.time}
          disabled={!loaded}
          onChange={(e) => transport?.seek(Number(e.target.value))}
          style={{ "--pos": `${st.duration ? (100 * st.time) / st.duration : 0}%` } as React.CSSProperties}
        />
      </footer>
    </div>
  );
}

/** which shot is on at time t, and when it began */
function shotAt(dir: Direction, cues: Cue[], t: number): { shot: Shot; since: number } {
  const first = cues[0].start - 0.7, last = cues[cues.length - 1].end + dir.outroAfter;
  if (t < first) return { shot: dir.shots[dir.intro], since: 0 };
  if (t >= last) return { shot: dir.shots[dir.outro], since: last };
  // a cut falls in the middle of the pause between two lines, where the set-up changes
  const name = (k: number) => (cues[k].shot && dir.shots[cues[k].shot!] ? cues[k].shot! : dir.lines[k % dir.lines.length]);
  let i = 0;
  while (i + 1 < cues.length && t >= (cues[i].end + cues[i + 1].start) / 2) i++;
  let k = i;
  while (k > 0 && name(k - 1) === name(i)) k--;
  const since = k === 0 ? first : (cues[k - 1].end + cues[k].start) / 2;
  return { shot: dir.shots[name(i)], since };
}

function SceneView(props: { scene: SceneFile; tracks: TeleTrack[]; transport: Transport }) {
  const { scene, tracks, transport } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const wrap = wrapRef.current!;
    const glCanvas = document.createElement("canvas");
    let gl: THREE.WebGLRenderer;
    try {
      gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    gl.setClearColor(0x000000, 1);
    gl.autoClear = false;

    const camera = new THREE.PerspectiveCamera(24, 1, 5, 9000);
    const set = scene.set ?? "car";
    const dir = DIRECTIONS[set], places = PLACES[set];
    const stage = new Stage(set);
    const action: Action = { aim: [], flash: [], slump: 0 };
    const shots = scene.shots ?? [], aims = scene.aim ?? [];
    /** the man in the chair (the apartment's last place) is who gets shot */
    const victim = set === "apartment" ? places.length - 1 : -1;
    const glow = new Glow();
    const up = new THREE.Vector3(0, 1, 0);
    const heads = tracks.map((track, i) => {
      const r = new Anatomy3D();
      r.centred = true;
      r.camera = camera;
      const model = getModel(track.body, track.sampleRate);
      // the head stands on its seat: a holder turns it (about the neck) to look at the other
      const holder = new THREE.Group();
      r.scene.add(holder);
      holder.add(r.root);
      const hair = new Hair(places[i].hair, model.tract.scale);
      r.root.add(hair.group);
      return { r, track, model, holder, hair, yaw: places[i].yaw, nod: 0, seat: new THREE.Vector3(...places[i].seat) };
    });
    const neck = new THREE.Vector3();

    let w = 0, h = 0, dpr = 1;
    const fit = () => {
      const b = wrap.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, b.width);
      h = Math.max(1, b.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.setPixelRatio(dpr);
      gl.setSize(w, h, false);
      for (const hd of heads) {
        hd.r.resize(w, h);
        hd.hair.resize(w, h);
      }
      stage.resize(w, h);
      camera.aspect = w / h;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();

    let raf = 0;
    let last = performance.now();
    let epoch = -1;
    let wall = 0;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      const elapsed = Math.min(0.5, (now - last) / 1000);
      last = now;
      wall += dt;
      const t = transport.time();
      const playing = transport.isPlaying;
      if (transport.epoch !== epoch) {
        epoch = transport.epoch;
        for (const hd of heads) hd.r.resetMotion();
      }
      // who is speaking (a little before the first sound, a little after the last)
      const cue = scene.cues.find((c) => t >= c.start - 0.25 && t <= c.end + 0.3);
      const speaker = cue ? cue.voice : -1;

      // ---- the camera: this shot's drift, and a hand holding it
      // ---- the guns: levelled a little before `aim`, a flash and a kick at each shot
      let fired = 0, bang = 0;
      for (let g = 0; g < places.length; g++) {
        const a = aims.find((x) => x.voice === g);
        action.aim[g] = a ? Math.min(1, Math.max(0, (t - a.t + 0.9) / 0.9)) : 0;
        action.flash[g] = 0;
      }
      for (const sh of shots) {
        if (t < sh.t) continue;
        fired++;
        const f = Math.exp(-(t - sh.t) / 0.07);
        action.flash[sh.voice] = Math.max(action.flash[sh.voice] ?? 0, f);
        bang = Math.max(bang, f);
      }
      action.slump = fired ? Math.min(1, (t - shots[0].t) / 1.6) : 0;

      const { shot, since } = shotAt(dir, scene.cues, t);
      const u = ease(Math.min(1, Math.max(0, (t - since) / shot.dur)));
      pos.set(shot.from[0] + (shot.to[0] - shot.from[0]) * u, shot.from[1] + (shot.to[1] - shot.from[1]) * u, shot.from[2] + (shot.to[2] - shot.from[2]) * u);
      const d = pos.distanceTo(look.set(...shot.at)) / 150;
      pos.x += d * 0.9 * Math.sin(wall * 0.83);
      pos.y += d * 0.6 * Math.sin(wall * 1.31 + 1) + d * 0.25 * Math.sin(wall * 7.3);
      pos.z += d * 0.9 * Math.cos(wall * 0.71);
      // each shot jolts the camera
      pos.x += 2.5 * d * bang * Math.sin(wall * 90);
      pos.y += 3.5 * d * bang * Math.cos(wall * 70);
      camera.position.copy(pos);
      camera.up.copy(up);
      camera.lookAt(look);
      if (camera.fov !== shot.fov) {
        camera.fov = shot.fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);

      // ---- the heads
      for (const [i, hd] of heads.entries()) {
        const { r, track, model } = hd;
        const want = dir.act(i, { t, wall, speaker, since: cue?.start ?? 0 });
        if (i === victim && fired) {
          // shot: thrown back at each hit, then slumped over
          want.nod = 0.5 * bang - 0.62 * action.slump * action.slump;
          want.yaw += 0.25 * action.slump;
        }
        hd.yaw = follow(hd.yaw, want.yaw, i === victim && fired ? 0.08 : 0.22, dt);
        hd.nod = follow(hd.nod, want.nod, i === victim && fired ? 0.06 : 0.3, dt);
        // turn about the neck, which stays on the seat's point
        const k = model.tract.scale;
        hd.holder.rotation.set(0, hd.yaw, hd.nod);
        neck.set(-2.4 * k, 0, 0).applyAxisAngle(up, hd.yaw);
        hd.holder.position.copy(hd.seat).sub(neck).add(neck.set(-2.4 * k, 0, 0));
        if (set === "car") hd.holder.position.y += 0.25 * Math.sin(wall * 6.1 + i) * (0.5 + 0.5 * Math.sin(wall * 0.9));
        if (i === victim) hd.holder.position.y -= 3 * action.slump;
        hd.holder.updateMatrixWorld(true);

        const msg = track.message(track.indexAt(t));
        const tele = playing && !(i === victim && fired) ? msg : null;
        const a = VoiceModel.articFromArray(msg.t.artic);
        r.face.update(tele, elapsed);
        r.update(model, model.frame(a), a, tele, VIEW, dt);
      }
      stage.update(dt, action);

      gl.clear();
      for (const hd of heads) gl.render(hd.r.scene, camera);
      gl.render(stage.scene, camera);

      // ---- the film frame: the picture, the letterbox, the words
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 2.39:1 where the screen is taller than that, and never less than a thin bar
      const bar = Math.max(h * 0.085, (h - w / 2.39) / 2);
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
      const size = Math.max(11, Math.min(20, w / 46));
      if (cue && t >= cue.start - 0.1 && t <= cue.end + 0.25) {
        const lines = wrapLabel(ctx, cue.text.toUpperCase(), w * 0.86, { size, ls: 0.1 });
        const y0 = h - bar / 2 - ((lines.length - 1) * size * 1.5) / 2 + size * 0.6;
        label(ctx, scene.voices[cue.voice].name.toUpperCase(), w / 2, y0 - size * 1.5, { size: size * 0.6, color: V.amber, align: "center", ls: 0.3 });
        lines.forEach((line, i) => label(ctx, line, w / 2, y0 + i * size * 1.5, { size, color: V.white, align: "center", ls: 0.1 }));
      }
      // the title, over the opening shot
      const first = scene.cues[0].start;
      const fade = Math.min(1, Math.max(0, (first - 0.9 - t) / 0.6));
      if (fade > 0) {
        label(ctx, scene.title.toUpperCase(), w / 2, bar / 2 + size * 0.5, { size: size * 1.1, color: V.amber, align: "center", ls: 0.34, alpha: fade, weight: "m" });
        if (!playing && t < 0.05) label(ctx, "PRESS PLAY", w / 2, h - bar / 2 + size * 0.3, { size: size * 0.7, color: V.blue, align: "center", ls: 0.3, alpha: 0.6 + 0.4 * Math.sin(wall * 3) });
      }
      glow.apply(canvas, ctx, dpr);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const hd of heads) {
        hd.hair.dispose();
        hd.r.dispose();
      }
      stage.dispose();
      gl.dispose();
      gl.forceContextLoss();
    };
  }, [scene, tracks, transport]);

  if (failed)
    return (
      <div className="anatomy">
        <p className="no-webgl">This scene needs WebGL, which this browser has turned off.</p>
      </div>
    );
  return (
    <div ref={wrapRef} className="anatomy">
      <canvas ref={canvasRef} aria-label={`${scene.title}: ${scene.voices.map((v) => v.name).join(", ")}`} role="img" />
    </div>
  );
}
