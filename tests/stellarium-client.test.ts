import { describe, it, expect, vi, beforeEach } from "vitest";
import * as http from "node:http";
import { EventEmitter } from "node:events";
import { StellariumClient } from "../src/stellarium-client.js";

// ─── Mock http.request ──────────────────────────────────────────────

vi.mock("node:http", () => {
  const actual = vi.importActual("node:http");
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockRequest = http.request as ReturnType<typeof vi.fn>;

function setupMockResponse(statusCode: number, body: string) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;

  const req = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  req.write = vi.fn();
  req.end = vi.fn();

  mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
    process.nextTick(() => {
      callback(res);
      process.nextTick(() => {
        res.emit("data", body);
        res.emit("end");
      });
    });
    return req;
  });

  return { req, res };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("StellariumClient", () => {
  let client: StellariumClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new StellariumClient({ host: "testhost", port: 1234 });
  });

  describe("constructor", () => {
    it("uses default host and port", () => {
      const c = new StellariumClient();
      setupMockResponse(200, "ok");
      c.setFov(10);
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.hostname).toBe("localhost");
      expect(opts.port).toBe(8090);
    });

    it("sets auth header when password provided", () => {
      const c = new StellariumClient({ password: "secret" });
      setupMockResponse(200, "ok");
      c.setFov(10);
      const opts = mockRequest.mock.calls[0][0];
      const expected = `Basic ${Buffer.from(":secret").toString("base64")}`;
      expect(opts.headers.Authorization).toBe(expected);
    });

    it("does not set auth header without password", () => {
      setupMockResponse(200, "ok");
      client.setFov(10);
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.headers.Authorization).toBeUndefined();
    });
  });

  describe("HTTP method routing", () => {
    it("GET requests use correct path and query params", async () => {
      setupMockResponse(200, JSON.stringify([{ key: "StarMgr", name: "Stars" }]));
      await client.listObjectTypes();
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.method).toBe("GET");
      expect(opts.path).toBe("/api/objects/listobjecttypes");
    });

    it("GET with params encodes query string", async () => {
      setupMockResponse(200, "Sirius\n");
      await client.findObject("Alpha Cen");
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.method).toBe("GET");
      expect(opts.path).toContain("str=Alpha+Cen");
    });

    it("POST requests set Content-Type and Content-Length", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.setFov(45);
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(opts.headers["Content-Length"]).toBe(
        Buffer.byteLength("fov=45").toString()
      );
      expect(req.write).toHaveBeenCalledWith("fov=45");
    });
  });

  describe("response parsing", () => {
    it("parses JSON responses", async () => {
      const data = { location: { name: "Test" }, time: {}, view: { fov: 60 } };
      setupMockResponse(200, JSON.stringify(data));
      const result = await client.getStatus();
      expect(result.location.name).toBe("Test");
    });

    it("returns plain text for non-JSON responses", async () => {
      setupMockResponse(200, "Sirius\nCanopus\n");
      const result = await client.findObject("star");
      expect(result).toEqual(["Sirius", "Canopus"]);
    });

    it("throws on non-2xx status", async () => {
      setupMockResponse(404, "not found");
      await expect(client.getStatus()).rejects.toThrow("Stellarium API error 404: not found");
    });

    it("throws on 500 status", async () => {
      setupMockResponse(500, "internal error");
      await expect(client.setFov(10)).rejects.toThrow("Stellarium API error 500");
    });
  });

  describe("request errors", () => {
    it("rejects on connection error", async () => {
      const req = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      req.write = vi.fn();
      req.end = vi.fn();

      mockRequest.mockImplementation(() => {
        process.nextTick(() => req.emit("error", new Error("ECONNREFUSED")));
        return req;
      });

      await expect(client.ping()).resolves.toBe(false);
    });
  });

  describe("getObjectInfo", () => {
    it("requests JSON format", async () => {
      setupMockResponse(200, JSON.stringify({ found: true, name: "Sirius", altitude: 45 }));
      await client.getObjectInfo("Sirius");
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.path).toContain("format=json");
      expect(opts.path).toContain("name=Sirius");
    });
  });

  describe("findObject", () => {
    it("parses newline-delimited results", async () => {
      setupMockResponse(200, "Sirius\nSirius B\n");
      const result = await client.findObject("Sirius");
      expect(result).toEqual(["Sirius", "Sirius B"]);
    });

    it("handles JSON array response", async () => {
      setupMockResponse(200, JSON.stringify(["Sirius", "Sirius B"]));
      const result = await client.findObject("Sirius");
      expect(result).toEqual(["Sirius", "Sirius B"]);
    });

    it("filters empty lines", async () => {
      setupMockResponse(200, "Sirius\n\n\nCanopus\n");
      const result = await client.findObject("star");
      expect(result).toEqual(["Sirius", "Canopus"]);
    });
  });

  describe("listObjectsByType", () => {
    it("parses newline-delimited results", async () => {
      setupMockResponse(200, "Jupiter\nSaturn\n");
      const result = await client.listObjectsByType("SolarSystem:planet");
      expect(result).toEqual(["Jupiter", "Saturn"]);
    });

    it("passes english param", async () => {
      setupMockResponse(200, "Jupiter\n");
      await client.listObjectsByType("SolarSystem:planet", { english: true });
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.path).toContain("english=true");
    });
  });

  describe("setTime", () => {
    it("converts UTC string to Julian Day", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.setTime({ utc: "2000-01-01T12:00:00Z" });
      // J2000.0 epoch = JD 2451545.0
      const body = req.write.mock.calls[0][0];
      const params = new URLSearchParams(body);
      expect(parseFloat(params.get("time")!)).toBeCloseTo(2451545.0, 1);
    });

    it("passes Julian Day directly", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.setTime({ time: 2451545.0 });
      const body = req.write.mock.calls[0][0];
      expect(body).toContain("time=2451545");
    });

    it("prefers UTC over jday when both provided", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.setTime({ utc: "2000-01-01T12:00:00Z", time: 9999999 });
      const body = req.write.mock.calls[0][0];
      const params = new URLSearchParams(body);
      expect(parseFloat(params.get("time")!)).toBeCloseTo(2451545.0, 1);
    });

    it("passes timerate parameter", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.setTime({ timerate: 3600 });
      const body = req.write.mock.calls[0][0];
      expect(body).toContain("timerate=3600");
    });
  });

  describe("getProperty", () => {
    it("returns single matching property", async () => {
      setupMockResponse(
        200,
        JSON.stringify({
          "StelMovementMgr.userMaxFov": { value: 360 },
          "StelMovementMgr.other": { value: 1 },
        })
      );
      const result = await client.getProperty("StelMovementMgr.userMaxFov");
      expect(result).toEqual({
        "StelMovementMgr.userMaxFov": { value: 360 },
      });
    });

    it("throws when property not found", async () => {
      setupMockResponse(200, JSON.stringify({ "other.prop": { value: 1 } }));
      await expect(client.getProperty("nonexistent")).rejects.toThrow(
        "Property not found: nonexistent"
      );
    });
  });

  describe("POST methods send correct bodies", () => {
    it("focusObject sends target param", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.focusObject("Canopus");
      expect(req.write).toHaveBeenCalledWith("target=Canopus");
    });

    it("doAction sends id param", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.doAction("actionShow_Stars");
      expect(req.write).toHaveBeenCalledWith("id=actionShow_Stars");
    });

    it("setProperty sends id and value", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.setProperty("some.prop", "42");
      const body = req.write.mock.calls[0][0];
      const params = new URLSearchParams(body);
      expect(params.get("id")).toBe("some.prop");
      expect(params.get("value")).toBe("42");
    });

    it("directScript sends code param", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.directScript('core.debug("test")');
      const body = req.write.mock.calls[0][0];
      const params = new URLSearchParams(body);
      expect(params.get("code")).toBe('core.debug("test")');
    });

    it("moveView sends x and y", async () => {
      const { req } = setupMockResponse(200, "ok");
      await client.moveView(1.5, -2.3);
      const body = req.write.mock.calls[0][0];
      const params = new URLSearchParams(body);
      expect(params.get("x")).toBe("1.5");
      expect(params.get("y")).toBe("-2.3");
    });
  });

  describe("ping", () => {
    it("returns true on success", async () => {
      setupMockResponse(200, JSON.stringify({ location: {}, time: {}, view: {} }));
      expect(await client.ping()).toBe(true);
    });

    it("returns false on error", async () => {
      setupMockResponse(500, "error");
      expect(await client.ping()).toBe(false);
    });
  });
});
