import { vehicleType } from './vehicleTypes.js';

// Reuse the scene's instanced batches for every detail of the new traffic.
export function drawTrafficVehicle(part, car, pose) {
  if (car.taxi || !car.kind || car.kind === 'car') return false;
  const { length, width } = vehicleType(car), color = car.color;
  const box = (x, y, z, w, h, d, tint = color) => part('car', x, y, z, w, h, d, tint);
  if (car.kind === 'tram') {
    // Two long carriages with a short accordion joint and roof pantograph.
    box(0, 0.48, 0, width * 0.88, 0.25, length, '#414b49');
    for (const center of [-1.9, 1.9]) {
      box(0, 1.12, center, width, 1.18, 3.4);
      box(0, 1.77, center, width * 1.02, 0.14, 3.4, '#e0e2d9');
      for (const side of [-1, 1]) {
        for (const along of [-1.15, -0.4, 0.4, 1.15])
          box(side * (width / 2 + 0.01), 1.35, center + along, 0.025, 0.55, 0.6, '#354846');
        box(side * (width / 2 + 0.02), 0.77, center, 0.025, 0.12, 3.3, '#e0e2d9');
      }
    }
    box(0, 1.1, 0, width * 0.9, 1.15, 0.4, '#58635f');
    for (const along of [-0.14, 0, 0.14]) box(0, 1.1, along, width * 0.96, 1.2, 0.045, '#89928b');
    for (const side of [-1, 1]) {
      box(0, 1.32, side * (length / 2 + 0.01), width * 0.85, 0.58, 0.025, '#354846');
      box(side * 0.35, 0.72, length / 2 + 0.02, 0.16, 0.15, 0.035, '#fff2c2');
      box(side * 0.35, 0.72, -length / 2 - 0.02, 0.14, 0.12, 0.035, '#9e5c4f');
    }
    box(0, 1.92, 1.2, 0.7, 0.18, 1, '#747e77');
    for (const side of [-1, 1]) box(side * 0.25, 2.18, 1.2, 0.055, 0.42, 0.055, '#515c56');
    box(0, 2.4, 1.2, 0.85, 0.06, 0.12, '#515c56');
    for (const [axle, along] of [-length * 0.31, length * 0.31].entries()) {
      for (const [index, side] of [-1, 1].entries())
        part('wheel', side * 0.43, 0.25 + pose.wheels[axle * 2 + index], along,
          0.14, 0.45, 0.45, '#343b38', false);
    }
    return true;
  }
  if (car.kind === 'motorcycle') {
    for (const [index, z] of [-0.57, 0.57].entries()) {
      const height = (pose.wheels[index * 2] + pose.wheels[index * 2 + 1]) / 2;
      part('wheel', 0, 0.25 + height, z, 0.17, 0.5, 0.5, '#242424', false);
    }
    box(0, 0.42, 0, 0.22, 0.2, 1.1, '#424242');
    box(0, 0.61, 0.19, 0.35, 0.26, 0.46);
    box(0, 0.66, -0.27, 0.31, 0.12, 0.45, '#252525');
    box(0, 0.84, 0.45, 0.55, 0.08, 0.1, '#333333');
    box(0, 0.63, 0.73, 0.22, 0.2, 0.13, '#fff5d5');
    // Seated rider, legs, arms and helmet remain readable at city scale.
    for (const side of [-1, 1]) {
      box(side * 0.2, 0.54, -0.14, 0.12, 0.42, 0.32, '#343434');
      box(side * 0.19, 0.9, 0.22, 0.12, 0.12, 0.5, '#555555');
    }
    box(0, 0.92, -0.04, 0.4, 0.48, 0.3, '#555555');
    part('crown', 0, 1.26, 0.04, 0.23, 0.25, 0.23, '#e6e6e6');
    box(0, 1.27, 0.23, 0.29, 0.12, 0.06, '#292929');
    return true;
  }

  box(0, 0.43, 0, width, 0.3, length, '#444444');
  if (car.kind === 'truck') {
    box(0, 1.17, -0.5, width, 1.25, 2.35, '#deded8');
    box(0, 0.94, 1.17, width, 1.05, 1.05);
    box(0, 1.17, 1.706, 0.96, 0.42, 0.025, '#343e43');
    for (const side of [-1, 1]) box(side * 0.58, 1.17, 1.14, 0.025, 0.42, 0.63, '#343e43');
    box(0, 0.63, 1.71, 0.56, 0.23, 0.035, '#393939');
    box(0, 1.17, -1.686, 0.04, 1.1, 0.025, '#a0a09b');
  } else if (car.kind === 'bus') {
    box(0, 1.04, 0, width, 1.25, length);
    box(0, 1.26, 1.91, 1.02, 0.6, 0.025, '#343e43');
    box(0, 1.3, -1.91, 1.0, 0.48, 0.025, '#343e43');
    for (const side of [-1, 1]) {
      for (const z of [-1.4, -0.7, 0, 0.7, 1.4]) box(side * 0.583, 1.3, z, 0.025, 0.5, 0.55, '#343e43');
      box(side * 0.586, 0.68, 0, 0.025, 0.16, 3.65, '#778c8b');
    }
    box(0.591, 0.98, 1.38, 0.035, 1.07, 0.5, '#343e43');
    box(0.615, 0.98, 1.38, 0.025, 1.07, 0.04, '#b9b9b9');
    box(0, 1.74, -0.3, 0.72, 0.18, 1.0, '#ccccca');
    box(0, 1.59, 1.93, 0.6, 0.13, 0.025, '#dedcc5');
  } else return false;

  for (const [a, z] of [-length * 0.31, length * 0.31].entries()) {
    for (const [s, side] of [-1, 1].entries()) {
      part('wheel', side * width / 2, 0.29 + pose.wheels[a * 2 + s], z, 0.18, 0.55, 0.55, '#292929', false);
    }
  }
  for (const side of [-1, 1]) {
    box(side * 0.4, 0.65, length / 2 + 0.025, 0.22, 0.16, 0.04, '#fff5d5');
    box(side * 0.4, 0.65, -length / 2 - 0.025, 0.17, 0.14, 0.04, '#a05b51');
  }
  return true;
}
