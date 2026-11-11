/**
 * The scene page's sets, drawn with the same glowing beams as the heads: a car on a street or a
 * small apartment, the bodies the heads sit on, and the hair that tells the heads apart.
 *
 * World cm, the heads' own axes: x forward, y up, z to the right of a head that looks along x.
 * A head's place is where its glottis goes, and the yaw its body faces (about y; 0 looks along x).
 */
import * as THREE from "three";
import { Beams } from "./beams3d.ts";
import { V } from "../colors.ts";

export type P3 = [number, number, number];
export type SetName = "car" | "apartment";
export type HairStyle = "slick" | "curls" | "short";

export interface Place {
  seat: P3;
  /** the way the body faces */
  yaw: number;
  hair: HairStyle;
}

/** the yaw that turns a head at `from` to look at `to` */
export const yawTo = (from: P3, to: P3): number => Math.atan2(-(to[2] - from[2]), to[0] - from[0]);

/** the car: the passenger (the car's right), then the driver */
const CAR: Place[] = [
  { seat: [0, 0, 21], yaw: 0, hair: "slick" },
  { seat: [0, 0, -21], yaw: 0, hair: "curls" },
];
/** the apartment: two men standing over a third in a chair */
const FLOOR = -110;
const CHAIR: P3 = [0, 0, 0];
const STAND: P3[] = [[170, 40, -28], [176, 40, 42]];
const APARTMENT: Place[] = [
  { seat: STAND[0], yaw: yawTo(STAND[0], CHAIR), hair: "curls" },
  { seat: STAND[1], yaw: yawTo(STAND[1], CHAIR), hair: "slick" },
  { seat: CHAIR, yaw: 0, hair: "short" },
];
export const PLACES: Record<SetName, Place[]> = { car: CAR, apartment: APARTMENT };
const SEATS: P3[] = CAR.map((p) => p.seat);

/** what the action is doing to the set this frame (the apartment's guns) */
export interface Action {
  /** per gunman: 0 the gun hangs at his side, 1 it is levelled */
  aim: number[];
  /** per gunman: 1 as he fires, dying away at once */
  flash: number[];
  /** 0..1: the man in the chair, shot */
  slump: number;
}

const TAU = Math.PI * 2;
const GROUND = -100;
/** how fast the street goes by (cm/s) */
const SPEED = 1050;

/** a small repeatable random number for the nth thing along the street */
const hash = (n: number, salt = 0): number => {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

class Pen {
  constructor(readonly b: Beams) {}
  path(pts: P3[], color: string, width: number, alpha = 1, close = false): void {
    const a = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => a.set(p, 3 * i));
    this.b.line(a, pts.length, color, width, { alpha, close });
  }
  /** an arc of radius r about c in the plane of unit vectors u and v */
  arc(c: P3, u: P3, v: P3, r: number, color: string, width: number, alpha = 1, a0 = 0, a1 = TAU, n = 28): void {
    const pts: P3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, cs = Math.cos(a) * r, sn = Math.sin(a) * r;
      pts.push([c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]);
    }
    this.path(pts, color, width, alpha);
  }
}

/** a body's own coordinates (x the way it faces) → the world, for a body at s turned by yaw */
const local = (s: P3, yaw: number) => {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return (x: number, y: number, z: number): P3 => [s[0] + x * c + z * sn, s[1] + y, s[2] - x * sn + z * c];
};

const X: P3 = [1, 0, 0], Y: P3 = [0, 1, 0], Z: P3 = [0, 0, 1];

/** the steering wheel: its centre, and its plane (u across the car, v up the wheel) */
const WHEEL_C: P3 = [40, -14, SEATS[1][2]];
const WHEEL_V: P3 = [0.447, 0.894, 0];
const WHEEL_R = 18;
const onWheel = (a: number, r = WHEEL_R): P3 => [WHEEL_C[0] + WHEEL_V[0] * Math.sin(a) * r, WHEEL_C[1] + WHEEL_V[1] * Math.sin(a) * r, WHEEL_C[2] + Math.cos(a) * r];

export class Stage {
  readonly scene = new THREE.Scene();
  private readonly beams = new Beams();
  private readonly pen = new Pen(this.beams);
  private clock = 0;

  constructor(private readonly set: SetName = "car") {
    this.scene.add(this.beams.group);
    this.scene.fog = new THREE.Fog(0x000000, 260, 4200);
  }

  dispose(): void {
    this.beams.dispose();
  }

  resize(w: number, h: number): void {
    this.beams.setResolution(w, h);
  }

  update(dt: number, action?: Action): void {
    this.clock += dt;
    this.beams.begin();
    if (this.set === "car") {
      this.street();
      this.car();
      for (const [i, s] of SEATS.entries()) this.suit(s, 0, i === 1 ? "wheel" : "rest");
    } else {
      this.room();
      const act = action ?? { aim: [0, 0], flash: [0, 0], slump: 0 };
      for (let i = 0; i < 2; i++) this.gunman(APARTMENT[i], act.aim[i] ?? 0, act.flash[i] ?? 0);
      this.sitter(APARTMENT[2], act.slump);
    }
    this.beams.end();
  }

  // ---------------------------------------------------------------- the apartment
  private room(): void {
    const p = this.pen, dim = V.blueDim, far = V.frame;
    const x0 = -230, x1 = 430, z0 = -270, z1 = 330, top = 150;
    // floor, its boards, and the two walls behind the action
    p.path([[x0, FLOOR, z0], [x1, FLOOR, z0], [x1, FLOOR, z1], [x0, FLOOR, z1]], dim, 1.05, 0.7, true);
    for (let z = z0 + 50; z < z1; z += 50) p.path([[x0, FLOOR, z], [x1, FLOOR, z]], far, 0.85, 0.8);
    p.path([[x0, FLOOR, z0], [x0, top, z0], [x1, top, z0], [x1, FLOOR, z0]], dim, 1.05, 0.7);
    p.path([[x0, top, z0], [x0, top, z1]], dim, 0.85, 0.5);
    p.path([[x0, FLOOR, z1], [x0, top, z1]], dim, 0.85, 0.5);
    p.path([[x1, top, z0], [x1, top, z1]], dim, 0.85, 0.5);
    // a window with its blinds, in the back wall
    p.path([[-120, -20, z0], [-120, 110, z0], [40, 110, z0], [40, -20, z0]], dim, 1.05, 0.8, true);
    for (let y = -8; y < 110; y += 12) p.path([[-120, y, z0], [40, y, z0]], far, 0.85, 0.9);
    // the door they came in by
    p.path([[250, FLOOR, z0], [250, 100, z0], [340, 100, z0], [340, FLOOR, z0]], dim, 1.05, 0.8);
    p.arc([330, -8, z0], X, Y, 3, dim, 0.85, 0.8, 0, TAU, 8);
    // a low table: breakfast (a burger, a cup with a straw)
    const ty = -62;
    p.path([[40, ty, -150], [120, ty, -150], [120, ty, -80], [40, ty, -80]], dim, 1.05, 0.8, true);
    for (const [x, z] of [[40, -150], [120, -150], [120, -80], [40, -80]]) p.path([[x, ty, z], [x, FLOOR, z]], dim, 0.85, 0.6);
    for (const [dy, r] of [[1, 8], [3, 8.6], [5, 8.2], [7, 8.6]] as const) p.arc([66, ty + dy, -118], X, Z, r, V.amber, 0.85, 0.6, 0, TAU, 14);
    p.arc([66, ty + 8, -118], X, Y, 8, V.amber, 1.05, 0.7, 0, Math.PI, 10);
    p.arc([98, ty, -105], X, Z, 4, V.white, 0.85, 0.6, 0, TAU, 10);
    p.arc([98, ty + 14, -105], X, Z, 5, V.white, 0.85, 0.7, 0, TAU, 10);
    for (const a of [0, 1.57, 3.14, 4.71]) p.path([[98 + 4 * Math.cos(a), ty, -105 + 4 * Math.sin(a)], [98 + 5 * Math.cos(a), ty + 14, -105 + 5 * Math.sin(a)]], V.white, 0.85, 0.5);
    p.path([[99, ty + 12, -105], [103, ty + 22, -104]], V.white, 0.85, 0.7);
    // a sofa against the back wall
    p.path([[-200, FLOOR + 38, -262], [-200, FLOOR + 80, -262], [-60, FLOOR + 80, -262], [-60, FLOOR + 38, -262]], far, 1.05, 1);
    p.path([[-200, FLOOR, -200], [-200, FLOOR + 38, -200], [-60, FLOOR + 38, -200], [-60, FLOOR, -200]], far, 1.05, 1);
    for (const x of [-200, -60]) p.path([[x, FLOOR + 38, -200], [x, FLOOR + 38, -262]], far, 0.85, 1);
  }

  /** a standing man in a suit with a pistol in his right hand */
  private gunman(pl: Place, aim: number, flash: number): void {
    const p = this.pen, s = pl.seat, cloth = V.blueMid;
    const at = local(s, pl.yaw);
    this.suit(s, pl.yaw, "none");
    // hips and legs
    for (const m of [-1, 1]) {
      p.path([at(5, -46, 19 * m), at(3, -62, 17 * m), at(2, -104, 13 * m), at(0, FLOOR - s[1], 12 * m), at(14, FLOOR - s[1], 12 * m)], cloth, 1.05, 0.6);
      p.path([at(2, -70, 2 * m), at(2, -104, 5 * m), at(0, FLOOR - s[1], 6 * m)], cloth, 0.85, 0.45);
    }
    p.path([at(3, -62, -17), at(4, -64, 0), at(3, -62, 17)], cloth, 0.85, 0.5);
    // the left arm hangs
    p.path([at(-1, -17, -24.5), at(1, -40, -25), at(5, -62, -23)], cloth, 1.3, 0.8);
    // the right arm: from hanging to levelled at the chair; a shot kicks the muzzle up
    const e = aim * aim * (3 - 2 * aim);
    // (levelled a little down, at the man in the chair)
    const ang = e * (Math.PI / 2 - 0.17) + 0.16 * flash * e;
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const sh: P3 = [-1, -15, 23];
    const hand: P3 = [sh[0] + 58 * dx + 2, sh[1] + 58 * dy + 6 * e, sh[2] - 9 * e];
    const elbow: P3 = [sh[0] + 29 * dx - 3 * (1 - e), sh[1] + 29 * dy - 5 * e, sh[2] + 2 - 2 * e];
    p.path([at(...sh), at(...elbow), at(...hand)], cloth, 1.3, 0.85);
    // the pistol: slide along the aim, grip square to it
    const nx = -dy, ny = dx;
    const g = (f: number, u: number): P3 => at(hand[0] + dx * f + nx * u, hand[1] + dy * f + ny * u, hand[2]);
    p.path([g(-3, 3), g(17, 3), g(17, 0.4), g(4, 0.4), g(2, -8), g(-3, -8)], V.white, 1.3, 0.95, true);
    p.path([g(4, 0.4), g(6, -3), g(2.6, -4)], V.white, 0.85, 0.7);
    if (flash > 0.02 && e > 0.5) {
      const muzzle = g(18, 1.7);
      // the flash: a burst of rays, and the shot's line to the chair
      for (let k = 0; k < 9; k++) {
        const a = (k * TAU) / 9 + this.clock * 40, r = (5 + 9 * hash(k, Math.floor(this.clock * 30))) * flash;
        const tip = g(18 + (k === 0 ? 2.2 * r : 0.6 * r), 1.7 + r * Math.sin(a));
        p.path([muzzle, [tip[0], tip[1], tip[2] + r * Math.cos(a)]], k % 2 ? V.amber : V.white, 1.6, flash);
      }
      p.path([muzzle, [CHAIR[0] + 5, CHAIR[1] - 14 + 6 * hash(Math.floor(this.clock * 30), 2), CHAIR[2] + 4 * (hash(Math.floor(this.clock * 30), 3) - 0.5)]], V.amber, 0.85, 0.5 * flash);
    }
  }

  /** the man in the chair, in a shirt; shot, he sags */
  private sitter(pl: Place, slump: number): void {
    const p = this.pen, s = pl.seat, cloth = V.blueDim;
    const at = local(s, pl.yaw);
    const sag = 3 * slump;
    for (const m of [-1, 1]) {
      // shoulders, arms to the lap (they fall to his sides), neckline
      const hand: P3 = slump > 0.5 ? [2, -84, 27 * m] : [24, -50 - sag, 9 * m];
      p.path([at(-2, -5, 5.5 * m), at(-2.5, -8 - sag, 13 * m), at(-2.5, -10.5 - sag, 20 * m), at(-1, -17 - sag, 23 * m), at(6 - 4 * slump, -40 - sag, 24 * m), at(...hand)], V.blueMid, 1.3, 0.8);
      p.path([at(-2.5, -10.5 - sag, 20 * m), at(3, -24, 18 * m), at(2, -58, 17 * m)], cloth, 1.05, 0.7);
      p.path([at(3.2, -5.5, 6 * m), at(6, -9, 0)], V.blueMid, 1.05, 0.8);
      // thighs, shins, shoes
      p.path([at(2, -58, 17 * m), at(46, -60, 13 * m), at(48, FLOOR - s[1], 13 * m), at(62, FLOOR - s[1], 13 * m)], cloth, 1.05, 0.7);
      p.path([at(2, -58, 5 * m), at(46, -60, 6 * m)], cloth, 0.85, 0.5);
      // the chair's side: seat, back, legs
      p.path([at(-14, -6, 21 * m), at(-12, -64, 21 * m), at(40, -64, 21 * m)], V.blue, 1.05, 0.6);
      p.path([at(-12, -64, 21 * m), at(-14, FLOOR - s[1], 21 * m)], V.blue, 0.85, 0.5);
      p.path([at(40, -64, 21 * m), at(42, FLOOR - s[1], 21 * m)], V.blue, 0.85, 0.5);
    }
    p.path([at(-14, -6, -21), at(-14, -6, 21)], V.blue, 1.05, 0.6);
    p.path([at(-13, -30, -21), at(-13, -30, 21)], V.blue, 0.85, 0.5);
    p.path([at(40, -64, -21), at(40, -64, 21)], V.blue, 0.85, 0.5);
  }

  // ---------------------------------------------------------------- the car
  private car(): void {
    const p = this.pen, t = this.clock;
    const body = V.blueMid, dim = V.blueDim;
    // one side's outline: nose, hood, windscreen, roof, rear window, boot, tail (z: body, roof)
    const side = (s: number): P3[] => {
      const zb = 80 * s, zr = 62 * s;
      return [[215, -72, zb], [217, -48, zb], [205, -21, zb], [86, -13, zb], [46, 30, zr], [-78, 30, zr], [-136, -13, zb], [-244, -19, zb], [-250, -50, zb], [-248, -72, zb]];
    };
    const L = side(-1), R = side(1);
    p.path(L, body, 1.3, 0.85, true);
    p.path(R, body, 1.3, 0.85, true);
    // across the car at each corner
    L.forEach((a, i) => p.path([a, R[i]], i >= 3 && i <= 6 ? body : dim, 1.05, i >= 3 && i <= 6 ? 0.8 : 0.55));
    for (const s of [-1, 1]) {
      const zb = 80 * s, zr = 62 * s;
      // waistline, door seams, the pillar between the windows
      p.path([[86, -13, zb], [-136, -13, zb]], dim, 1.05, 0.8);
      p.path([[58, -13, zb], [56, -72, zb]], dim, 0.85, 0.5);
      p.path([[-30, -13, zb], [-30, -72, zb]], dim, 0.85, 0.5);
      p.path([[-30, -13, zb], [-24, 30, zr]], dim, 1.05, 0.7);
      // wheels: tyre, rim, spokes that turn
      for (const wx of [142, -152]) {
        const c: P3 = [wx, -70, zb + 2 * s];
        p.arc(c, X, Y, 31, body, 1.3, 0.8);
        p.arc(c, X, Y, 17, dim, 1.05, 0.7, 0, TAU, 18);
        const a = (-t * SPEED) / 31;
        for (let k = 0; k < 5; k++) {
          const b = a + (k * TAU) / 5;
          p.path([[c[0] + 4 * Math.cos(b), c[1] + 4 * Math.sin(b), c[2]], [c[0] + 17 * Math.cos(b), c[1] + 17 * Math.sin(b), c[2]]], dim, 0.85, 0.6);
        }
      }
      // headlamps and tail lamps
      p.arc([217, -40, 58 * s], Z, Y, 9, V.amber, 1.3, 0.9, 0, TAU, 16);
      p.arc([217, -40, 58 * s], Z, Y, 4, V.amber, 1.05, 0.6, 0, TAU, 10);
      p.path([[-250.5, -36, 76 * s], [-250.5, -36, 58 * s], [-250.5, -46, 58 * s], [-250.5, -46, 76 * s]], V.red, 0.85, 0.4, true);
    }
    // grille and bumpers
    for (const y of [-34, -40, -46]) p.path([[217, y, -44], [217, y, 44]], dim, 0.85, 0.6);
    p.path([[220, -58, -82], [220, -58, 82]], body, 1.3, 0.7);
    p.path([[-253, -58, -82], [-253, -58, 82]], body, 1.3, 0.7);
    // hood crease
    p.path([[205, -20, 0], [86, -12.5, 0]], dim, 0.85, 0.35);
    // dashboard, with the driver's dials
    p.path([[72, -17, -76], [72, -17, 76]], dim, 1.05, 0.7);
    p.path([[62, -22, -76], [62, -22, 76]], dim, 0.85, 0.5);
    p.arc([63, -19, -30], Z, Y, 4.5, dim, 0.85, 0.6, 0, Math.PI, 10);
    p.arc([63, -19, -12], Z, Y, 4.5, dim, 0.85, 0.6, 0, Math.PI, 10);
    // rear-view mirror
    p.path([[50, 27, -11], [50, 27, 11], [50, 21.5, 10], [50, 21.5, -10]], dim, 1.05, 0.75, true);
    p.path([[48, 30, 0], [50, 27, 0]], dim, 0.85, 0.6);
    // the bench seat behind them
    p.path([[-16, -48, -70], [-17, -6, -68], [-17, -3, -60], [-17, -3, 60], [-17, -6, 68], [-16, -48, 70]], dim, 1.05, 0.6);
    for (const z of [-44, -22, 0, 22, 44]) p.path([[-17, -3, z], [-16, -48, z]], V.frame, 0.85, 0.7);
    // steering wheel: rim, spokes, column
    const turn = 0.09 * Math.sin(t * 0.8) + 0.05 * Math.sin(t * 2.1);
    const pts: P3[] = [];
    for (let i = 0; i <= 32; i++) pts.push(onWheel((i * TAU) / 32));
    p.path(pts, V.blue, 1.6, 0.9);
    for (const a of [0, Math.PI, -Math.PI / 2]) p.path([onWheel(a + turn, 3), onWheel(a + turn)], body, 1.05, 0.8);
    p.path([WHEEL_C, [66, -24, WHEEL_C[2]]], dim, 1.05, 0.6);
  }

  // ---------------------------------------------------------------- the suits
  /** shoulders, a shirt collar and a thin tie under a head. Arms: on the steering wheel, at rest
   *  on the lap, or none (drawn by the caller) */
  private suit(s: P3, yaw: number, arms: "wheel" | "rest" | "none"): void {
    const p = this.pen;
    const at = local(s, yaw);
    const cloth = V.blueMid;
    for (const m of [-1, 1]) {
      // neck to shoulder
      p.path([at(-2, -5, 5.5 * m), at(-2.5, -8, 13 * m), at(-2.5, -10.5, 21 * m), at(-1, -17, 24.5 * m)], cloth, 1.3, 0.85);
      if (arms !== "none") {
        const elbow = arms === "wheel" ? at(14, -33, 24 * m) : at(4, -40, 25 * m);
        p.path([at(-1, -17, 24.5 * m), elbow], cloth, 1.3, 0.85);
        if (arms === "wheel") {
          // forearm to the wheel, hands at ten and two
          const hand = onWheel(m > 0 ? 0.62 : Math.PI - 0.62);
          p.path([elbow, hand], cloth, 1.3, 0.8);
          p.arc(hand, Z, Y, 2.2, V.blue, 1.05, 0.8, 0, TAU, 8);
        } else p.path([elbow, at(20, -44, 18 * m)], cloth, 1.3, 0.6);
      }
      // jacket front and lapel
      p.path([at(-2.5, -10.5, 21 * m), at(3, -22, 19 * m), at(5, -46, 19 * m)], cloth, 1.05, 0.5);
      p.path([at(3.2, -5.5, 6.5 * m), at(6.2, -14, 6.5 * m), at(8.4, -34, 1.2 * m)], cloth, 1.3, 0.85);
      p.path([at(6.2, -14, 6.5 * m), at(5.4, -17.5, 10 * m), at(8.4, -34, 1.2 * m)], cloth, 0.85, 0.6);
      // shirt collar
      p.path([at(1.5, -3.6, 5.6 * m), at(5.0, -5.4, 4.8 * m), at(6.4, -9.6, 0.7 * m), at(4.6, -4.4, 1.2 * m)], V.white, 1.3, 0.95);
    }
    // the tie: knot, then a narrow blade
    p.path([at(6.3, -8.4, -1.5), at(6.3, -8.4, 1.5), at(6.9, -11.4, 0.9), at(6.9, -11.4, -0.9)], V.white, 1.05, 0.9, true);
    p.path([at(6.9, -11.4, -0.9), at(8.2, -31, -1.9), at(8.5, -34, 0), at(8.2, -31, 1.9), at(6.9, -11.4, 0.9)], V.white, 1.05, 0.8);
  }

  // ---------------------------------------------------------------- the street
  private street(): void {
    const p = this.pen;
    const s = this.clock * SPEED;
    const far = V.frame, kerb = V.blueDim;
    const X0 = -2600, X1 = 4200;
    /** things every `period` cm along the street: (x now, which one it is) */
    const along = (period: number, phase: number, f: (x: number, n: number) => void) => {
      const first = Math.floor((s + X0 - phase) / period);
      for (let n = first; n * period + phase - s < X1; n++) {
        const x = n * period + phase - s;
        if (x >= X0) f(x, n);
      }
    };
    // kerbs, and the pavement's joints going by
    for (const z of [250, -640]) p.path([[X0, GROUND, z], [X1, GROUND, z]], kerb, 1.05, 0.8);
    along(420, 0, (x) => p.path([[x, GROUND, 250], [x, GROUND, 330]], kerb, 0.85, 0.6));
    along(420, 210, (x) => p.path([[x, GROUND, -640], [x, GROUND, -720]], kerb, 0.85, 0.5));
    // the centre line, in dashes
    along(900, 0, (x) => p.path([[x, GROUND, -195], [x + 380, GROUND, -195]], V.amber, 1.3, 0.55));
    // palms on both pavements
    const palm = (x: number, z: number, n: number) => {
      const h = 780 + 260 * hash(n, 1), lean = 60 * (hash(n, 2) - 0.5);
      const top: P3 = [x + lean, GROUND + h, z];
      p.path([[x, GROUND, z], [x + lean * 0.35, GROUND + h * 0.5, z], top], kerb, 1.05, 0.8);
      for (let k = 0; k < 7; k++) {
        const a = (k * TAU) / 7 + hash(n, 3), cx = Math.cos(a), cz = Math.sin(a);
        p.path([top, [top[0] + 90 * cx, top[1] + 50, top[2] + 90 * cz], [top[0] + 190 * cx, top[1] - 10, top[2] + 190 * cz], [top[0] + 240 * cx, top[1] - 120, top[2] + 240 * cz]], kerb, 0.85, 0.7);
      }
    };
    along(1700, 300, (x, n) => palm(x, 360, n));
    along(1700, 1150, (x, n) => palm(x, -760, n + 1000));
    // low buildings behind them
    const block = (x: number, z: number, depth: number, n: number) => {
      const w = 520 + 300 * hash(n, 4), h = 330 + 420 * hash(n, 5), y0 = GROUND, y1 = GROUND + h;
      p.path([[x, y0, z], [x, y1, z], [x + w, y1, z], [x + w, y0, z]], far, 1.05, 0.9);
      p.path([[x, y1, z], [x, y1, z + depth], [x + w, y1, z + depth], [x + w, y1, z]], far, 0.85, 0.7);
      // a door and a row of windows
      const d = x + w * (0.2 + 0.5 * hash(n, 6));
      p.path([[d, y0, z], [d, y0 + 210, z], [d + 100, y0 + 210, z], [d + 100, y0, z]], far, 0.85, 0.7);
      for (let k = 0; k < 4; k++) {
        const wx = x + (w * (k + 0.3)) / 4;
        p.path([[wx, y1 - 60, z], [wx + w / 8, y1 - 60, z], [wx + w / 8, y1 - 150, z], [wx, y1 - 150, z]], far, 0.85, 0.6, true);
      }
    };
    along(900, 0, (x, n) => block(x, 520, 400, n));
    along(900, 450, (x, n) => block(x, -900, -400, n + 500));
  }
}

// -------------------------------------------------------------------- hair
/**
 * Hair for a head, in the head's own frame (body cm; k is the body's scale): add `group` under
 * the head's root so it nods with it. Drawn once.
 *
 * The scalp is an ellipsoid a little outside the skull: angle a runs in the midline plane from
 * the face (0) over the crown (90°) to the nape; b is the latitude towards an ear.
 */
export class Hair {
  private readonly beams = new Beams();
  readonly group = this.beams.group;

  constructor(style: HairStyle, k: number) {
    const p = new Pen(this.beams);
    const scalp = (a: number, b: number, out = 1): P3 => {
      const ca = Math.cos(a), cb = Math.cos(b);
      return [k * (-0.6 + (ca > 0 ? 8.9 : 8.7) * out * ca * cb), k * (14.2 + 9.1 * out * Math.sin(a) * cb), k * 8.0 * out * Math.sin(b)];
    };
    const deg = Math.PI / 180;
    this.beams.begin();
    if (style === "short") {
      // cropped, brushed to one side
      for (let i = -5; i <= 5; i++) {
        const b = i * 13 * deg;
        const pts: P3[] = [];
        for (let a = (56 + 2 * Math.abs(i)) * deg; a <= (172 + 3 * Math.abs(i)) * deg; a += 9 * deg) pts.push(scalp(a, b + 0.1 * Math.sin(a * 2), 1.025));
        p.path(pts, V.blue, 1.05, 0.65);
      }
      for (const a of [80, 120, 160]) {
        const pts: P3[] = [];
        for (let i = -5; i <= 5; i++) pts.push(scalp(a * deg, i * 13 * deg, 1.025));
        p.path(pts, V.blue, 0.85, 0.45);
      }
    } else if (style === "slick") {
      // combed straight back from the brow, long over the collar
      for (let i = -5; i <= 5; i++) {
        const b = i * 13.5 * deg;
        const pts: P3[] = [];
        const a0 = (50 + 3 * Math.abs(i)) * deg;
        for (let a = a0; a <= 207 * deg; a += 7 * deg) pts.push(scalp(a, b, 1.03));
        const e = pts[pts.length - 1];
        pts.push([e[0] - 0.5 * k, e[1] - 2.6 * k, e[2] * 1.02], [e[0] - 0.2 * k, e[1] - 5.2 * k, e[2] * 1.0], [e[0] + 0.5 * k, e[1] - 7 * k, e[2] * 0.96]);
        p.path(pts, V.blue, i % 2 ? 1.05 : 1.3, 0.75);
      }
      // the hairline
      const line: P3[] = [];
      for (let i = -5; i <= 5; i++) line.push(scalp((50 + 3 * Math.abs(i)) * deg, i * 13.5 * deg, 1.03));
      p.path(line, V.blue, 1.05, 0.6);
    } else {
      // tight curls all over, a moustache and sideburns
      let n = 0;
      for (let a = 44; a <= 204; a += 14.5) {
        const row = Math.round((a - 44) / 14.5);
        for (let b = -66; b <= 66; b += 13.2) {
          n++;
          const aa = (a + 5 * (hash(n, 1) - 0.5)) * deg, bb = (b + (row % 2 ? 6.6 : 0) + 4 * (hash(n, 2) - 0.5)) * deg;
          if (Math.abs(bb) > 70 * deg) continue;
          const c = scalp(aa, bb, 1.08), ca = scalp(aa + 0.02, bb, 1.08), cb = scalp(aa, bb + 0.02, 1.08);
          const u = unit([ca[0] - c[0], ca[1] - c[1], ca[2] - c[2]]), v = unit([cb[0] - c[0], cb[1] - c[1], cb[2] - c[2]]);
          const r = k * (1.0 + 0.5 * hash(n, 3)), ph = TAU * hash(n, 4);
          const pts: P3[] = [];
          for (let j = 0; j <= 14; j++) {
            const th = ph + (j / 14) * TAU * 1.35, rr = r * (0.45 + (0.55 * j) / 14);
            pts.push([c[0] + rr * (u[0] * Math.cos(th) + v[0] * Math.sin(th)), c[1] + rr * (u[1] * Math.cos(th) + v[1] * Math.sin(th)), c[2] + rr * (u[2] * Math.cos(th) + v[2] * Math.sin(th))]);
          }
          p.path(pts, V.blue, 1.05, 0.7);
        }
      }
      for (const m of [-1, 1]) {
        p.path([[1.9 * k, 14 * k, 7.75 * m * k], [2.1 * k, 11.6 * k, 7.6 * m * k], [2.6 * k, 9.8 * k, 7.2 * m * k]], V.blue, 1.6, 0.7);
        p.path([[1.1 * k, 14 * k, 7.8 * m * k], [1.3 * k, 11.4 * k, 7.65 * m * k], [2.6 * k, 9.8 * k, 7.2 * m * k]], V.blue, 1.05, 0.6);
      }
      for (const dy of [0, -0.35]) {
        const pts: P3[] = [];
        for (let z = -3.1; z <= 3.11; z += 0.62) {
          const az = Math.abs(z);
          pts.push([k * (7.75 - 0.13 * z * z), k * (10.15 + dy - (az > 2 ? (az - 2) * 1.5 : 0)), k * z]);
        }
        p.path(pts, V.blue, 1.6, 0.85);
      }
    }
    this.beams.end();
  }

  resize(w: number, h: number): void {
    this.beams.setResolution(w, h);
  }

  dispose(): void {
    this.beams.dispose();
  }
}

function unit(a: P3): P3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
