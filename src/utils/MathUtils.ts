/** 数学工具：Lerp / Clamp / 低通滤波 / 随机插值 / 重映射 */

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite 平滑阶跃：x 在 [edge0,edge1] 间做 smoothstep，外部钳制到 0/1 */
export const smooth01 = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 一阶低通滤波：current += (target - current) * alpha */
export const lowPass = (current: number, target: number, alpha: number): number =>
  current + (target - current) * alpha;

/** 将 v 从 [inMin, inMax] 线性映射到 [outMin, outMax] */
export const remap = (
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number => {
  const t = (v - inMin) / (inMax - inMin);
  return outMin + (outMax - outMin) * clamp(t, 0, 1);
};

/** 在 [-1,1] 范围内做平滑插值，并附带 deadzone */
export const smoothAxis = (
  current: number,
  target: number,
  alpha: number,
  deadzone = 0.02
): number => {
  const t = Math.abs(target) < deadzone ? 0 : target;
  return lowPass(current, t, alpha);
};

/** [0,1) 之间的随机浮点 */
export const rand01 = (): number => Math.random();

/** [min,max] 之间的随机浮点 */
export const randRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

/** 整数 [min,max] */
export const randInt = (min: number, max: number): number =>
  Math.floor(randRange(min, max + 1));

/** 在数组中随机取一个 */
export const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

/** 期望概率下返回 true */
export const chance = (p: number): boolean => Math.random() < p;
