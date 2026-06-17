import { worlds as fallbackWorlds, type WorldInfo } from "../data/worlds.js";
import {
  UniversalisClient,
  type UniversalisDataCenter,
  type UniversalisWorld,
} from "./universalis.js";

const TARGET_REGIONS = new Set(["North-America", "Europe", "Oceania"]);
const FALLBACK_REGIONS = ["North-America"];

export class WorldCatalog {
  private cachedWorlds: WorldInfo[] | null = null;

  constructor(private readonly universalis = new UniversalisClient()) {}

  async getWorlds(): Promise<WorldInfo[]> {
    if (this.cachedWorlds) {
      return this.cachedWorlds;
    }

    try {
      this.cachedWorlds = await this.fetchSupportedWorlds();
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

  private async fetchSupportedWorlds(): Promise<WorldInfo[]> {
    const [availableWorlds, dataCenters] = await Promise.all([
      this.universalis.getWorlds(),
      this.universalis.getDataCenters(),
    ]);
    const worldNames = new Map(
      availableWorlds.map((world: UniversalisWorld) => [world.id, world.name]),
    );

    return dataCenters
      .filter((dataCenter: UniversalisDataCenter) => TARGET_REGIONS.has(dataCenter.region))
      .flatMap((dataCenter: UniversalisDataCenter) =>
        dataCenter.worlds.map((worldId) => ({
          id: worldId,
          name: worldNames.get(worldId) ?? `World ${worldId}`,
          dataCenter: dataCenter.name,
          region: dataCenter.region,
        })),
      );
  }
}
