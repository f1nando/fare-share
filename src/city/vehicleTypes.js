export const VEHICLE_KINDS = ['car', 'truck', 'bus', 'motorcycle'];

export const VEHICLE_TYPES = Object.freeze({
  car: { length: 2.25, width: 0.92, speed: 1, acceleration: 1 },
  truck: { length: 3.4, width: 1.15, speed: 0.8, acceleration: 0.65 },
  bus: { length: 3.8, width: 1.15, speed: 0.85, acceleration: 0.7 },
  motorcycle: { length: 1.65, width: 0.55, speed: 1.2, acceleration: 1.5 },
});

export const vehicleType = car => VEHICLE_TYPES[car?.taxi ? 'car' : car?.kind] ?? VEHICLE_TYPES.car;
// Retain the existing safety envelope for small vehicles.
export const extraHalfLength = car => Math.max(0, (vehicleType(car).length - 2.25) / 2);
export const vehicleGap = (a, b) => 2.9 + extraHalfLength(a) + extraHalfLength(b);

export function chooseVehicleKind(taxi, roll) {
  return taxi ? 'car' : roll < 0.12 ? 'truck' : roll < 0.22 ? 'bus' : roll < 0.36 ? 'motorcycle' : 'car';
}
