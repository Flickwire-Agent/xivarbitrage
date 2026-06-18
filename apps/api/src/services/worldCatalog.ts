import { worlds as fallbackWorlds, type WorldInfo } from "../data/worlds.js";
import { worldDcMapping } from "./worldDcMapping.js";

const FALLBACK_REGIONS = ["North-America"];

export class WorldCatalog {
  private cachedWorlds: WorldInfo[] | null = null;

  async getWorlds(): Promise<WorldInfo[]> {
    if (this.cachedWorlds) {
      return this.cachedWorlds;
    }

    try {
      const mapping = await worldDcMapping.getMapping();
      this.cachedWorlds = mapping.worlds;
    } catch {
      this.cachedWorlds = fallbackWorlds;
    }

    return this.cachedWorlds;
  }

  async getRegions(): Promise<string[]> {
    const worlds = await this.getWorlds();
    const regions = [...new Set(worlds.map((world) => world.region ?? "North-America"))];
    return regions.length > 0 ? regions.sort() : FALLBACK_REGIONS;
  }

  async getWorldById(): Promise<Map<number, WorldInfo>> {
    return new Map((await this.getWorlds()).map((world) => [world.id, world]));
  }
}
