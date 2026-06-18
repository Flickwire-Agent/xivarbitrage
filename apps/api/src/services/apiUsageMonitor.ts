import { createClient, type RedisClientType } from "redis";
import { config } from "../config.js";

const REDIS_PREFIX = "api_usage:";
const KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

interface RequestRecord {
  ip: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  userAgent: string;
  origin: string;
  timestamp: number;
}

interface HourlyBucket {
  hour: string;
  total: number;
}

interface EndpointStats {
  endpoint: string;
  total: number;
  avgResponseTimeMs: number;
  statusCodes: Record<string, number>;
}

interface ConsumerStats {
  ip: string;
  userAgent: string;
  origin: string;
  requestCount: number;
  firstSeen: string;
  lastSeen: string;
  endpoints: Record<string, number>;
}

interface UsageSummary {
  period: { from: string; to: string };
  totalRequests: number;
  uniqueConsumers: number;
  avgResponseTimeMs: number;
  requestsByHour: HourlyBucket[];
  topEndpoints: EndpointStats[];
  topConsumers: ConsumerStats[];
  statusCodes: Record<string, number>;
}

function hourKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13).replace("T", "-");
}

function normalizeEndpoint(url: string): string {
  const path = url.split("?")[0] ?? "";
  return path.replace(/\/items\/\d+/, "/items/:itemId");
}

class ApiUsageMonitor {
  private client: RedisClientType;
  private connected = false;
  private buffer: RequestRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.client = createClient({ url: config.redisUrl }) as RedisClientType;
    this.client.on("error", () => {});
    this.client
      .connect()
      .then(() => {
        this.connected = true;
      })
      .catch(() => {
        this.connected = false;
      });
  }

  start(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 5_000);
    this.flushTimer.unref();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }

  record(record: RequestRecord): void {
    this.buffer.push(record);
    if (this.buffer.length >= 50) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.connected || this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    const pipeline = this.client.multi();

    for (const rec of batch) {
      const hk = hourKey(new Date(rec.timestamp));
      const endpoint = normalizeEndpoint(rec.endpoint);
      const ipKey = rec.ip || "unknown";

      pipeline.incr(`${REDIS_PREFIX}total:${hk}`);
      pipeline.expire(`${REDIS_PREFIX}total:${hk}`, KEY_TTL_SECONDS);

      pipeline.incr(`${REDIS_PREFIX}ep:${endpoint}:${hk}`);
      pipeline.expire(`${REDIS_PREFIX}ep:${endpoint}:${hk}`, KEY_TTL_SECONDS);

      pipeline.incr(`${REDIS_PREFIX}ip:${ipKey}:${hk}`);
      pipeline.expire(`${REDIS_PREFIX}ip:${ipKey}:${hk}`, KEY_TTL_SECONDS);

      pipeline.incr(`${REDIS_PREFIX}status:${rec.statusCode}:${hk}`);
      pipeline.expire(`${REDIS_PREFIX}status:${rec.statusCode}:${hk}`, KEY_TTL_SECONDS);

      pipeline.zAdd(`${REDIS_PREFIX}latency:${endpoint}`, {
        score: rec.responseTimeMs,
        value: `${rec.timestamp}:${rec.responseTimeMs}`,
      });
      pipeline.expire(`${REDIS_PREFIX}latency:${endpoint}`, KEY_TTL_SECONDS);

      const consumerKey = `${REDIS_PREFIX}consumer:${ipKey}`;
      pipeline.hIncrBy(consumerKey, "requests", 1);
      pipeline.hSetNX(consumerKey, "firstSeen", new Date(rec.timestamp).toISOString());
      pipeline.hSet(consumerKey, "lastSeen", new Date(rec.timestamp).toISOString());
      pipeline.hSet(consumerKey, "userAgent", rec.userAgent.slice(0, 200));
      pipeline.hSet(consumerKey, "origin", rec.origin);
      pipeline.hIncrBy(consumerKey, `ep:${endpoint}`, 1);
      pipeline.expire(consumerKey, KEY_TTL_SECONDS);
    }

    try {
      await pipeline.exec();
    } catch (error) {
      console.error(`[ApiUsageMonitor] Flush error: ${error}`);
    }
  }

  async getSummary(hoursBack = 24): Promise<UsageSummary> {
    const now = new Date();
    const from = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

    const hours: string[] = [];
    for (let h = new Date(from); h <= now; h = new Date(h.getTime() + 3_600_000)) {
      hours.push(hourKey(h));
    }

    const totalKeys = hours.map((h) => `${REDIS_PREFIX}total:${h}`);
    const totalCounts = this.connected ? await this.client.mGet(totalKeys) : [];
    const totalRequests = totalCounts.reduce((sum, v) => sum + (Number(v) || 0), 0);

    const requestsByHour: HourlyBucket[] = hours.map((h, i) => ({
      hour: h,
      total: Number(totalCounts[i]) || 0,
    }));

    const statusCodes: Record<string, number> = {};
    if (this.connected) {
      for (const code of [200, 400, 404, 500, 503]) {
        const keys = hours.map((h) => `${REDIS_PREFIX}status:${code}:${h}`);
        const counts = await this.client.mGet(keys);
        const total = counts.reduce((sum, v) => sum + (Number(v) || 0), 0);
        if (total > 0) statusCodes[String(code)] = total;
      }
    }

    const knownEndpoints = [
      "/api/opportunities",
      "/api/bargains",
      "/api/dc-disparities",
      "/api/items/:itemId/history",
      "/api/items/:itemId/listings",
      "/api/worlds",
      "/api/health",
      "/api/worker/status",
    ];

    const topEndpoints: EndpointStats[] = [];
    if (this.connected) {
      for (const ep of knownEndpoints) {
        const keys = hours.map((h) => `${REDIS_PREFIX}ep:${ep}:${h}`);
        const counts = await this.client.mGet(keys);
        const total = counts.reduce((sum, v) => sum + (Number(v) || 0), 0);
        if (total > 0) {
          const latencies = await this.client.zRange(`${REDIS_PREFIX}latency:${ep}`, 0, -1);
          const times = latencies
            .map((l: string) => Number(l.split(":").pop()) || 0)
            .filter((t: number) => t > 0);
          const avgResponseTimeMs =
            times.length > 0
              ? Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length)
              : 0;

          topEndpoints.push({
            endpoint: ep,
            total,
            avgResponseTimeMs,
            statusCodes: {},
          });
        }
      }
    }
    topEndpoints.sort((a, b) => b.total - a.total);

    const topConsumers: ConsumerStats[] = [];
    if (this.connected) {
      const consumerKeys = await this.client.keys(`${REDIS_PREFIX}consumer:*`);
      const consumerData: ConsumerStats[] = [];

      for (const key of consumerKeys) {
        const data = await this.client.hGetAll(key);
        if (!data.requests) continue;

        const endpoints: Record<string, number> = {};
        for (const [k, v] of Object.entries(data)) {
          if (k.startsWith("ep:")) {
            endpoints[k.slice(3)] = Number(v) || 0;
          }
        }

        consumerData.push({
          ip: key.replace(`${REDIS_PREFIX}consumer:`, ""),
          userAgent: data.userAgent || "",
          origin: data.origin || "",
          requestCount: Number(data.requests) || 0,
          firstSeen: data.firstSeen || "",
          lastSeen: data.lastSeen || "",
          endpoints,
        });
      }

      consumerData.sort((a, b) => b.requestCount - a.requestCount);
      topConsumers.push(...consumerData.slice(0, 20));
    }

    const uniqueConsumers = topConsumers.length;

    const allLatencies: number[] = [];
    if (this.connected) {
      for (const ep of knownEndpoints) {
        const latencies = await this.client.zRange(`${REDIS_PREFIX}latency:${ep}`, 0, -1);
        for (const l of latencies) {
          const t = Number(l.split(":").pop()) || 0;
          if (t > 0) allLatencies.push(t);
        }
      }
    }
    const avgResponseTimeMs =
      allLatencies.length > 0
        ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
        : 0;

    return {
      period: { from: from.toISOString(), to: now.toISOString() },
      totalRequests,
      uniqueConsumers,
      avgResponseTimeMs,
      requestsByHour,
      topEndpoints,
      topConsumers,
      statusCodes,
    };
  }
}

export const apiUsageMonitor = new ApiUsageMonitor();
