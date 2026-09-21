// Work sites close only the outer normal lane. The shoulder stays available.
export const WORK_MARGIN = 1.75;

export function nextRoadwork(car, direction) {
  let result = null, nearest = Infinity;
  for (const work of car.roadworks ?? []) {
    const start = (direction > 0 ? work.start : -work.end) - car.position * direction;
    const end = (direction > 0 ? work.end : -work.start) - car.position * direction;
    if (end < -WORK_MARGIN || start >= nearest) continue;
    nearest = start; result = work;
  }
  return result;
}

export const workEntryDistance = (work, position, direction) =>
  (direction > 0 ? work.start - position : position - work.end);

export function workMergeClear(car, targetTrack, direction, duration) {
  if (targetTrack !== 1) return true;
  for (const work of car.roadworks ?? []) {
    const entry = workEntryDistance(work, car.position, direction);
    const exit = entry + work.end - work.start;
    const travel = Math.max(car.speed, car.cruise) * duration + WORK_MARGIN;
    if (exit > -WORK_MARGIN && entry < travel + 3) return false;
  }
  return true;
}
