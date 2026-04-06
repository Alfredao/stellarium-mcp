/**
 * Stellarium Remote Control HTTP Client
 *
 * Wraps the Stellarium Remote Control plugin API (default: http://localhost:8090).
 * See: https://stellarium.org/doc/23.0/remoteControlApi.html
 *
 * Uses Node's http module instead of fetch because Stellarium's built-in HTTP
 * server does not support chunked Transfer-Encoding, which Node's undici-based
 * fetch sends for POST requests.
 */

import * as http from "node:http";

export interface StellariumClientOptions {
  host?: string;
  port?: number;
  password?: string;
}

export interface StellariumStatus {
  location: {
    name: string;
    latitude: number;
    longitude: number;
    altitude: number;
    planet: string;
  };
  time: {
    jDay: number;
    utc: string;
    local: string;
    deltaT: number;
    gmtShift: number;
    timeRate: number;
    isTimeNow: boolean;
  };
  view: {
    fov: number;
    j2000: [number, number, number];
    jNow: [number, number, number];
    altAz: [number, number, number];
  };
  selectionInfo: string;
  actionChanges: Record<string, boolean>;
  propertyChanges: Record<string, unknown>;
}

export interface ObjectInfo {
  found: boolean;
  name: string;
  "localized-name": string;
  type: string;
  "star-type"?: string;
  ra: number;
  dec: number;
  raJ2000: number;
  decJ2000: number;
  altitude: number;
  azimuth: number;
  vmag: number;
  "absolute-mag"?: number;
  "distance-ly"?: number;
  rise?: string;
  "rise-dhr"?: number;
  transit?: string;
  "transit-dhr"?: number;
  set?: string;
  "set-dhr"?: number;
  "above-horizon": boolean;
  iauConstellation: string;
  "size-deg"?: string;
  "spectral-class"?: string;
  [key: string]: unknown;
}

export class StellariumClient {
  private host: string;
  private port: number;
  private authHeader?: string;

  constructor(options: StellariumClientOptions = {}) {
    this.host = options.host ?? "localhost";
    this.port = options.port ?? 8090;

    if (options.password) {
      const encoded = Buffer.from(`:${options.password}`).toString("base64");
      this.authHeader = `Basic ${encoded}`;
    }
  }

  // ─── Low-level HTTP helpers ────────────────────────────────────────

  private request(
    method: string,
    path: string,
    body?: string
  ): Promise<{ status: number; data: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers["Content-Length"] = Buffer.byteLength(body).toString();
      }
      if (this.authHeader) {
        headers["Authorization"] = this.authHeader;
      }

      const req = http.request(
        { hostname: this.host, port: this.port, path, method, headers },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, data }));
        }
      );
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  private async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(path, `http://${this.host}:${this.port}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const { status, data } = await this.request("GET", url.pathname + url.search);
    if (status < 200 || status >= 300) {
      throw new Error(`Stellarium API error ${status}: ${data}`);
    }
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  private async post(path: string, body?: Record<string, string>): Promise<unknown> {
    const encoded = body ? new URLSearchParams(body).toString() : undefined;
    const { status, data } = await this.request("POST", path, encoded);
    if (status < 200 || status >= 300) {
      throw new Error(`Stellarium API error ${status}: ${data}`);
    }
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  // ─── Main Service ──────────────────────────────────────────────────

  /** Get the full Stellarium status (location, time, view direction, etc.) */
  async getStatus(): Promise<StellariumStatus> {
    return (await this.get("/api/main/status")) as StellariumStatus;
  }

  /** Get the current view direction */
  async getView(): Promise<{ j2000: number[]; jNow: number[]; altAz: number[] }> {
    return (await this.get("/api/main/view")) as {
      j2000: number[];
      jNow: number[];
      altAz: number[];
    };
  }

  /** Set the view direction using a coordinate vector */
  async setView(
    coords: [number, number, number],
    coordSystem: "j2000" | "jNow" | "altAz" = "j2000"
  ): Promise<string> {
    return (await this.post("/api/main/view", {
      [coordSystem]: JSON.stringify(coords),
    })) as string;
  }

  /** Set the field of view in degrees */
  async setFov(fovDegrees: number): Promise<string> {
    return (await this.post("/api/main/fov", {
      fov: fovDegrees.toString(),
    })) as string;
  }

  /** Focus on an object by name */
  async focusObject(objectName: string): Promise<string> {
    return (await this.post("/api/main/focus", {
      target: objectName,
    })) as string;
  }

  /** Move the view (simulates arrow key presses) */
  async moveView(x: number, y: number): Promise<string> {
    return (await this.post("/api/main/move", {
      x: x.toString(),
      y: y.toString(),
    })) as string;
  }

  /** Convert a Date or ISO string to Julian Day number */
  private utcToJulianDay(utc: string | Date): number {
    const d = typeof utc === "string" ? new Date(utc) : utc;
    return d.getTime() / 86400000 + 2440587.5;
  }

  /** Set the simulation time */
  async setTime(params: {
    time?: number;      // Julian Day
    timerate?: number;  // seconds per second
    utc?: string;       // ISO 8601 UTC string (converted to Julian Day)
  }): Promise<string> {
    const body: Record<string, string> = {};
    if (params.utc !== undefined) {
      body["time"] = this.utcToJulianDay(params.utc).toString();
    } else if (params.time !== undefined) {
      body["time"] = params.time.toString();
    }
    if (params.timerate !== undefined) body["timerate"] = params.timerate.toString();
    return (await this.post("/api/main/time", body)) as string;
  }

  // ─── Object Service ────────────────────────────────────────────────

  /** Search for objects by name (returns a list of matching names) */
  async findObject(name: string): Promise<string[]> {
    const result = await this.get("/api/objects/find", { str: name });
    // The API returns a newline-separated list or JSON array
    if (typeof result === "string") {
      return result
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return result as string[];
  }

  /** Get detailed information about a specific object */
  async getObjectInfo(name: string): Promise<ObjectInfo> {
    return (await this.get("/api/objects/info", { name, format: "json" })) as ObjectInfo;
  }

  /** List all available object types */
  async listObjectTypes(): Promise<Array<{ key: string; name: string }>> {
    return (await this.get("/api/objects/listobjecttypes")) as Array<{
      key: string;
      name: string;
    }>;
  }

  /** List objects of a specific type */
  async listObjectsByType(
    type: string,
    options?: { english?: boolean }
  ): Promise<string[]> {
    const params: Record<string, string> = { type };
    if (options?.english) params["english"] = "true";
    const result = await this.get("/api/objects/listobjectsbytype", params);
    if (typeof result === "string") {
      return result
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return result as string[];
  }

  // ─── Location Service ──────────────────────────────────────────────

  /** List available locations */
  async listLocations(): Promise<string[]> {
    const result = await this.get("/api/location/list");
    if (typeof result === "string") {
      return result
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return result as string[];
  }

  /** List countries */
  async listCountries(): Promise<string[]> {
    const result = await this.get("/api/location/countrylist");
    if (typeof result === "string") {
      return result
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return result as string[];
  }

  // ─── SIMBAD Service ────────────────────────────────────────────────

  /** Look up an object in the SIMBAD astronomical database */
  async simbadLookup(name: string): Promise<unknown> {
    return this.get("/api/simbad/lookup", { str: name });
  }

  // ─── StelAction Service ────────────────────────────────────────────

  /** Trigger or toggle a Stellarium action by ID */
  async doAction(actionId: string): Promise<unknown> {
    return this.post("/api/stelaction/do", { id: actionId });
  }

  // ─── StelProperty Service ──────────────────────────────────────────

  /** Get the value of a Stellarium property */
  async getProperty(propId: string): Promise<unknown> {
    const all = (await this.get("/api/stelproperty/list")) as Record<string, unknown>;
    if (propId in all) {
      return { [propId]: all[propId] };
    }
    throw new Error(`Property not found: ${propId}`);
  }

  /** Set a Stellarium property value */
  async setProperty(propId: string, value: string): Promise<string> {
    return (await this.post("/api/stelproperty/set", {
      id: propId,
      value,
    })) as string;
  }

  // ─── Script Service ────────────────────────────────────────────────

  /** List available scripts */
  async listScripts(): Promise<unknown> {
    return this.get("/api/scripts/list");
  }

  /** Run a script by filename */
  async runScript(scriptId: string): Promise<string> {
    return (await this.post("/api/scripts/run", { id: scriptId })) as string;
  }

  /** Execute Stellarium Script code directly */
  async directScript(code: string): Promise<string> {
    return (await this.post("/api/scripts/direct", { code })) as string;
  }

  /** Get script execution status */
  async getScriptStatus(): Promise<unknown> {
    return this.get("/api/scripts/status");
  }

  /** Stop the currently running script */
  async stopScript(): Promise<string> {
    return (await this.post("/api/scripts/stop")) as string;
  }

  // ─── Utility / Health ──────────────────────────────────────────────

  /** Check if the Stellarium API is reachable */
  async ping(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch {
      return false;
    }
  }
}
