export interface WorldInfo {
  id: number;
  name: string;
  dataCenter: string;
  region?: string;
}

export const worlds: WorldInfo[] = [
  { id: 73, name: "Adamantoise", dataCenter: "Aether" },
  { id: 79, name: "Cactuar", dataCenter: "Aether" },
  { id: 54, name: "Faerie", dataCenter: "Aether" },
  { id: 63, name: "Gilgamesh", dataCenter: "Aether" },
  { id: 40, name: "Jenova", dataCenter: "Aether" },
  { id: 65, name: "Midgardsormr", dataCenter: "Aether" },
  { id: 99, name: "Sargatanas", dataCenter: "Aether" },
  { id: 57, name: "Siren", dataCenter: "Aether" },
  { id: 91, name: "Balmung", dataCenter: "Crystal" },
  { id: 34, name: "Brynhildr", dataCenter: "Crystal" },
  { id: 74, name: "Coeurl", dataCenter: "Crystal" },
  { id: 62, name: "Diabolos", dataCenter: "Crystal" },
  { id: 81, name: "Goblin", dataCenter: "Crystal" },
  { id: 75, name: "Malboro", dataCenter: "Crystal" },
  { id: 37, name: "Mateus", dataCenter: "Crystal" },
  { id: 41, name: "Zalera", dataCenter: "Crystal" },
  { id: 78, name: "Behemoth", dataCenter: "Primal" },
  { id: 93, name: "Excalibur", dataCenter: "Primal" },
  { id: 53, name: "Exodus", dataCenter: "Primal" },
  { id: 35, name: "Famfrit", dataCenter: "Primal" },
  { id: 95, name: "Hyperion", dataCenter: "Primal" },
  { id: 55, name: "Lamia", dataCenter: "Primal" },
  { id: 64, name: "Leviathan", dataCenter: "Primal" },
  { id: 77, name: "Ultros", dataCenter: "Primal" },
  { id: 404, name: "Halicarnassus", dataCenter: "Dynamis" },
  { id: 405, name: "Maduin", dataCenter: "Dynamis" },
  { id: 406, name: "Marilith", dataCenter: "Dynamis" },
  { id: 407, name: "Seraph", dataCenter: "Dynamis" },
  { id: 408, name: "Cuchulainn", dataCenter: "Dynamis" },
  { id: 409, name: "Golem", dataCenter: "Dynamis" },
  { id: 410, name: "Kraken", dataCenter: "Dynamis" },
  { id: 411, name: "Rafflesia", dataCenter: "Dynamis" }
];

export const worldById = new Map(worlds.map((world) => [world.id, world]));
