import { Color } from 'three'

/** Display assumptions, not operational alert thresholds. */
export const WAIT_ORANGE_SECONDS = 5 * 60
export const WAIT_RED_SECONDS = 15 * 60
export const QUEUE_BAR_BASE_M = 6
export const QUEUE_BAR_MAX_COUNT = 5000
export const QUEUE_BAR_MAX_HEIGHT_M = 18
const fresh = new Color('#f4cf4b'), orange = new Color('#ef8c2f'), red = new Color('#db302c')

/** Continuous fresh yellow → 5-minute orange → 15-minute red, saturated thereafter. */
export function writeWaitColor(waitSeconds: number, output: Color): Color {
  const wait = Number.isFinite(waitSeconds) ? Math.max(0, waitSeconds) : 0
  return wait <= WAIT_ORANGE_SECONDS
    ? output.copy(fresh).lerp(orange, wait / WAIT_ORANGE_SECONDS)
    : output.copy(orange).lerp(red, Math.min(1, (wait - WAIT_ORANGE_SECONDS) / (WAIT_RED_SECONDS - WAIT_ORANGE_SECONDS)))
}

/** A 0.18 m idle marker plus sqrt scaling, capped at 5,000 queued / 18 m of added height. */
export function queueBarHeightM(queuedCount: number): number {
  const count = Number.isFinite(queuedCount) ? Math.max(0, queuedCount) : 0
  return 0.18 + QUEUE_BAR_MAX_HEIGHT_M * Math.sqrt(Math.min(count, QUEUE_BAR_MAX_COUNT) / QUEUE_BAR_MAX_COUNT)
}
