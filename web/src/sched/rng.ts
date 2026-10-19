/**
 * A seeded random source with the handful of calls padel.py makes on
 * random.Random, so the scheduler ports line for line. The same seed always
 * gives the same rotation here (not the same one the Python app gave).
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Float in [0, 1) - mulberry32. */
  random(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, stop), or [start, stop) with two arguments. */
  randrange(start: number, stop?: number): number {
    if (stop === undefined) [start, stop] = [0, start];
    return start + Math.floor(this.random() * (stop - start));
  }

  choice<T>(items: readonly T[]): T {
    return items[this.randrange(items.length)];
  }

  /** k distinct items, in random order. */
  sample<T>(items: readonly T[], k: number): T[] {
    const pool = [...items];
    for (let i = 0; i < k; i++) {
      const j = i + this.randrange(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }

  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randrange(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function newSeed(): number {
  return 1 + Math.floor(Math.random() * (10 ** 6 - 1)); // random.randrange(1, 10**6)
}
