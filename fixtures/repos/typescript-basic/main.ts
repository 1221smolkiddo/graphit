import { add as sum, Base, Runnable } from './math';
import external from 'external-library';

export class Worker extends Base implements Runnable {
  helper(value: number): number { return sum(value, 1); }
  run(value: number): number { return this.helper(value); }
}
export function entry(): number {
  function nested(): number { return sum(1, 2); }
  return nested();
}
export function duplicate(): number { return 1; }
export function uncertain(candidate: () => number): number { return candidate(); }
export const outside = external;
