const DATA_CENTER_HUES = [214, 12, 174, 31, 164, 262, 88, 334, 194, 48];
const WORLD_LIGHTNESS = [36, 44, 52, 60, 68];

function hueAt(index: number): number {
  return DATA_CENTER_HUES[index % DATA_CENTER_HUES.length]!;
}

export function getDataCenterLineColor(index: number): string {
  return `hsl(${hueAt(index)} 72% 52%)`;
}

export function getDataCenterBandColor(index: number): string {
  return `hsla(${hueAt(index)}, 72%, 52%, 0.18)`;
}

export function getDataCenterWorldColor(dataCenterIndex: number, worldIndex: number): string {
  const lightness = WORLD_LIGHTNESS[worldIndex % WORLD_LIGHTNESS.length]!;
  return `hsl(${hueAt(dataCenterIndex)} 68% ${lightness}%)`;
}
