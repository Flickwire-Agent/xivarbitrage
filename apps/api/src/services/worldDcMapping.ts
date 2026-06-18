import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UniversalisClient } from "./universalis.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, "../../data/world-dc-mapping.json");

export interface WorldDcMapping {
  worldIdToDc: Record<number, string>;
  dcRegions: Record<string, string>;
  worlds: { id: number; name: string; dataCenter: string; region: string }[];
  dataCenters: string[];
  regions: string[];
  updatedAt: string;
}

const TARGET_REGIONS = new Set(["North-America", "Europe", "Oceania"]);

export class WorldDcMappingService {
  private universalis = new UniversalisClient();
  private mapping: WorldDcMapping | null = null;
  private refreshPromise: Promise<void> | null = null;

  async getMapping(): Promise<WorldDcMapping> {
    if (this.mapping) return this.mapping;

    const fromFile = await this.loadFromFile();
    if (fromFile) {
      this.mapping = fromFile;
      return fromFile;
    }

    await this.refresh();
    return this.mapping!;
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchAndSave()
      .catch((error) => {
        console.error(`[WorldDcMapping] Refresh failed: ${error}`);
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private async fetchAndSave(): Promise<void> {
    const [availableWorlds, dataCenters] = await Promise.all([
      this.universalis.getWorlds(),
      this.universalis.getDataCenters(),
    ]);

    const worldNames = new Map(availableWorlds.map((w) => [w.id, w.name]));
    const worldIdToDc: Record<number, string> = {};
    const dcRegions: Record<string, string> = {};
    const worlds: WorldDcMapping["worlds"] = [];

    for (const dc of dataCenters) {
      dcRegions[dc.name] = dc.region;
      for (const worldId of dc.worlds) {
        worldIdToDc[worldId] = dc.name;
      }
    }

    for (const dc of dataCenters.filter((dc) => TARGET_REGIONS.has(dc.region))) {
      for (const worldId of dc.worlds) {
        worlds.push({
          id: worldId,
          name: worldNames.get(worldId) ?? `World ${worldId}`,
          dataCenter: dc.name,
          region: dc.region,
        });
      }
    }

    const mapping: WorldDcMapping = {
      worldIdToDc,
      dcRegions,
      worlds,
      dataCenters: [...new Set(dataCenters.map((dc) => dc.name))].sort(),
      regions: [...new Set(dataCenters.map((dc) => dc.region))].sort(),
      updatedAt: new Date().toISOString(),
    };

    this.mapping = mapping;
    await this.saveToFile(mapping);
    console.log(
      `[WorldDcMapping] Refreshed ${worlds.length} worlds, ${mapping.dataCenters.length} DCs`,
    );
  }

  private async loadFromFile(): Promise<WorldDcMapping | null> {
    try {
      const raw = await fs.readFile(CACHE_FILE, "utf-8");
      return JSON.parse(raw) as WorldDcMapping;
    } catch {
      return null;
    }
  }

  private async saveToFile(mapping: WorldDcMapping): Promise<void> {
    const dir = path.dirname(CACHE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(mapping, null, 2), "utf-8");
  }
}

export const worldDcMapping = new WorldDcMappingService();
