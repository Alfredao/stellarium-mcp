#!/usr/bin/env node

/**
 * Stellarium MCP Server
 *
 * An MCP server that provides AI agents with tools to control
 * the Stellarium planetarium software via its Remote Control HTTP API.
 *
 * Designed for astronomy workflows including telescope alignment,
 * observation planning, and sky exploration — especially useful
 * in the southern hemisphere where Polaris is not available.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StellariumClient } from "./stellarium-client.js";

// ─── Configuration ───────────────────────────────────────────────────

const STELLARIUM_HOST = process.env.STELLARIUM_HOST ?? "localhost";
const STELLARIUM_PORT = parseInt(process.env.STELLARIUM_PORT ?? "8090", 10);
const STELLARIUM_PASSWORD = process.env.STELLARIUM_PASSWORD;

const client = new StellariumClient({
  host: STELLARIUM_HOST,
  port: STELLARIUM_PORT,
  password: STELLARIUM_PASSWORD,
});

// ─── Server Setup ────────────────────────────────────────────────────

const server = new McpServer({
  name: "stellarium-mcp",
  version: "0.1.0",
});

// ─── Helper: format a tool response ─────────────────────────────────

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ═══════════════════════════════════════════════════════════════════════
//  CORE TOOLS
// ═══════════════════════════════════════════════════════════════════════

// ─── 1. get_status ───────────────────────────────────────────────────

server.tool(
  "get_status",
  "Get the current Stellarium status including observer location, simulation time, view direction, and field of view. Use this to understand the current state before performing other operations.",
  {},
  async () => {
    try {
      const [status, view] = await Promise.all([client.getStatus(), client.getView()]);
      return textResult({
        location: status.location,
        time: status.time,
        view: {
          fov_degrees: status.view.fov,
          ...view,
        },
        selected_object: status.selectionInfo || "none",
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 2. search_object ────────────────────────────────────────────────

server.tool(
  "search_object",
  "Search for celestial objects by name. Returns a list of matching object names. Use this to find stars, planets, deep sky objects, constellations, etc.",
  {
    query: z
      .string()
      .describe("The name or partial name to search for (e.g. 'Sirius', 'M42', 'Alpha Cen')"),
  },
  async ({ query }) => {
    try {
      const results = await client.findObject(query);
      return textResult({
        query,
        matches: results,
        count: results.length,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 3. get_object_info ──────────────────────────────────────────────

server.tool(
  "get_object_info",
  "Get detailed information about a specific celestial object including coordinates (RA/Dec, Alt/Az), magnitude, type, rise/set times, and more. The object must be an exact name (use search_object first if needed).",
  {
    name: z
      .string()
      .describe("The exact name of the object (e.g. 'Sirius', 'Jupiter', 'M42')"),
  },
  async ({ name }) => {
    try {
      const info = await client.getObjectInfo(name);
      return textResult(info);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 4. point_to_object ─────────────────────────────────────────────

server.tool(
  "point_to_object",
  "Point the Stellarium view (and connected telescope, if any) to a named celestial object. The view will center on the object.",
  {
    name: z
      .string()
      .describe("The exact name of the object to point to (e.g. 'Canopus', 'Saturn')"),
  },
  async ({ name }) => {
    try {
      await client.focusObject(name);
      // Give Stellarium a moment to slew, then get the object info
      await new Promise((r) => setTimeout(r, 500));
      const info = await client.getObjectInfo(name);
      return textResult({
        message: `Now pointing at ${name}`,
        object_info: info,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 5. get_current_view ─────────────────────────────────────────────

server.tool(
  "get_current_view",
  "Get the current viewing direction in multiple coordinate systems (J2000 equatorial, current epoch, and altitude/azimuth). Also returns the current field of view.",
  {},
  async () => {
    try {
      const [status, view] = await Promise.all([client.getStatus(), client.getView()]);
      return textResult({
        fov_degrees: status.view.fov,
        coordinates: view,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 6. set_fov ──────────────────────────────────────────────────────

server.tool(
  "set_fov",
  "Set the field of view (zoom level) in degrees. Smaller values zoom in, larger values zoom out. Typical eyepiece view is 1-2 degrees, naked eye is about 60-120 degrees.",
  {
    fov: z
      .number()
      .positive()
      .describe("Field of view in degrees (e.g. 60 for wide view, 1 for telescopic view)"),
  },
  async ({ fov }) => {
    try {
      await client.setFov(fov);
      return textResult({ message: `Field of view set to ${fov}°` });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  ALIGNMENT HELPER TOOLS
// ═══════════════════════════════════════════════════════════════════════

// ─── 7. suggest_alignment_stars ──────────────────────────────────────

server.tool(
  "suggest_alignment_stars",
  `Suggest the best stars for telescope multi-star alignment based on the current observer location and time. Returns bright stars that are currently above the horizon, well-spaced in azimuth, and suitable for alignment. Especially useful in the southern hemisphere where Polaris is not available.`,
  {
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Number of alignment stars to suggest (default: 3)"),
    min_altitude: z
      .number()
      .default(15)
      .describe("Minimum altitude above horizon in degrees (default: 15)"),
    max_magnitude: z
      .number()
      .default(2.0)
      .describe("Maximum (faintest) apparent magnitude to consider (default: 2.0, brighter stars only)"),
  },
  async ({ count, min_altitude, max_magnitude }) => {
    try {
      // Well-known bright stars used for alignment, covering all parts of the sky
      const alignmentCandidates = [
        "Sirius", "Canopus", "Rigil Kentaurus", "Arcturus", "Vega",
        "Capella", "Rigel", "Procyon", "Achernar", "Betelgeuse",
        "Hadar", "Acrux", "Altair", "Aldebaran", "Antares",
        "Spica", "Pollux", "Fomalhaut", "Mimosa", "Deneb",
        "Regulus", "Adhara", "Gacrux", "Shaula", "Bellatrix",
        "Alnath", "Alnilam", "Alioth", "Dubhe", "Mirfak",
        "Wezen", "Sargas", "Kaus Australis", "Avior", "Menkalinan",
        "Atria", "Alhena", "Peacock", "Alsephina", "Mirzam",
        "Alphard", "Polaris", "Hamal", "Algieba", "Diphda",
        "Miaplacidus", "Ankaa", "Suhail", "Aspidiske", "Naos",
      ];

      // Query each candidate for current position
      const starData: Array<{
        name: string;
        altitude: number;
        azimuth: number;
        magnitude: number;
      }> = [];

      for (const starName of alignmentCandidates) {
        try {
          const info = await client.getObjectInfo(starName);
          if (!info || !info.found) continue;

          const alt = info.altitude;
          const az = info.azimuth;
          const mag = info.vmag;
          if (alt === undefined || az === undefined || mag === undefined) continue;

          if (alt >= min_altitude && mag <= max_magnitude) {
            starData.push({
              name: starName,
              altitude: Math.round(alt * 100) / 100,
              azimuth: Math.round(((az + 360) % 360) * 100) / 100,
              magnitude: Math.round(mag * 100) / 100,
            });
          }
        } catch {
          // Star not found or error — skip
          continue;
        }
      }

      // Sort by magnitude (brightest first)
      starData.sort((a, b) => a.magnitude - b.magnitude);

      // Select well-spaced stars using a greedy algorithm
      const selected: typeof starData = [];
      const remaining = [...starData];

      if (remaining.length > 0) {
        // Start with the brightest star
        selected.push(remaining.shift()!);

        while (selected.length < count && remaining.length > 0) {
          // Find the star that maximizes minimum angular separation from already selected stars
          let bestIdx = 0;
          let bestMinSep = -1;

          for (let i = 0; i < remaining.length; i++) {
            let minSep = Infinity;
            for (const sel of selected) {
              // Angular separation approximation using azimuth difference
              const azDiff = Math.abs(remaining[i].azimuth - sel.azimuth);
              const sep = Math.min(azDiff, 360 - azDiff);
              minSep = Math.min(minSep, sep);
            }
            if (minSep > bestMinSep) {
              bestMinSep = minSep;
              bestIdx = i;
            }
          }
          selected.push(remaining.splice(bestIdx, 1)[0]);
        }
      }

      return textResult({
        suggested_alignment_stars: selected.map((s, i) => ({
          order: i + 1,
          name: s.name,
          altitude_deg: s.altitude,
          azimuth_deg: s.azimuth,
          magnitude: s.magnitude,
        })),
        total_visible_bright_stars: starData.length,
        criteria: {
          min_altitude_deg: min_altitude,
          max_magnitude: max_magnitude,
          requested_count: count,
        },
        tip: "Stars are selected to be well-spaced in azimuth for best alignment accuracy. Point to each star in order using point_to_object.",
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 8. list_visible_objects ─────────────────────────────────────────

server.tool(
  "list_visible_objects",
  "List objects of a given type that are currently catalogued in Stellarium. Note: this returns all objects of that type in the catalogue, not just those above the horizon. Use get_object_info to check individual object positions.",
  {
    type: z
      .string()
      .describe("Object type key (e.g. 'Star', 'Planet', 'Nebula', 'Galaxy', 'Constellation'). Use list_object_types to see all available types."),
    english: z
      .boolean()
      .default(true)
      .describe("Return names in English (default: true)"),
  },
  async ({ type, english }) => {
    try {
      const objects = await client.listObjectsByType(type, { english });
      return textResult({
        type,
        objects: objects.slice(0, 100), // Limit to prevent huge responses
        total_count: objects.length,
        note:
          objects.length > 100
            ? "Showing first 100 results. Use search_object for specific targets."
            : undefined,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 9. list_object_types ────────────────────────────────────────────

server.tool(
  "list_object_types",
  "List all available celestial object type categories in Stellarium (e.g. Star, Planet, Nebula, Galaxy). Use these type keys with list_visible_objects.",
  {},
  async () => {
    try {
      const types = await client.listObjectTypes();
      return textResult(types);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  TIME & LOCATION TOOLS
// ═══════════════════════════════════════════════════════════════════════

// ─── 10. set_time ────────────────────────────────────────────────────

server.tool(
  "set_time",
  "Set the simulation time in Stellarium. You can set an absolute time (as Julian Day or ISO UTC string) and/or change the time rate. Use time rate 0 to pause, 1 for real-time, or larger values for fast-forward.",
  {
    jday: z
      .number()
      .optional()
      .describe("Julian Day number to set the time to"),
    utc: z
      .string()
      .optional()
      .describe("ISO 8601 UTC time string (e.g. '2026-04-06T03:00:00Z')"),
    timerate: z
      .number()
      .optional()
      .describe("Time rate in seconds per second (0 = paused, 1 = real-time, 3600 = 1 hour/sec)"),
  },
  async ({ jday, utc, timerate }) => {
    try {
      await client.setTime({
        time: jday,
        utc: utc,
        timerate: timerate,
      });
      // Get updated status
      await new Promise((r) => setTimeout(r, 200));
      const status = await client.getStatus();
      return textResult({
        message: "Time updated",
        current_time: status.time,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 11. set_time_to_now ─────────────────────────────────────────────

server.tool(
  "set_time_to_now",
  "Reset the simulation time to the current real-world time. Useful after fast-forwarding or rewinding.",
  {},
  async () => {
    try {
      // Setting timerate to 1 and using the action to sync to now
      await client.doAction("actionSet_TimeRate_0");
      await new Promise((r) => setTimeout(r, 100));
      await client.doAction("actionReturn_To_Current_Time");
      await new Promise((r) => setTimeout(r, 200));
      const status = await client.getStatus();
      return textResult({
        message: "Time reset to now",
        current_time: status.time,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  ADVANCED TOOLS
// ═══════════════════════════════════════════════════════════════════════

// ─── 12. simbad_lookup ───────────────────────────────────────────────

server.tool(
  "simbad_lookup",
  "Look up an object in the SIMBAD astronomical database. Returns professional astronomical data about the object.",
  {
    name: z
      .string()
      .describe("Object name or designation to look up in SIMBAD"),
  },
  async ({ name }) => {
    try {
      const result = await client.simbadLookup(name);
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 13. run_script ──────────────────────────────────────────────────

server.tool(
  "run_script",
  "Execute a Stellarium script command directly. This gives low-level access to Stellarium's scripting engine for advanced operations. See Stellarium scripting documentation for available commands.",
  {
    code: z
      .string()
      .describe("Stellarium Script code to execute (e.g. 'core.setObserverLocation(-19.73, -42.63, 300, 0, \"My Location\", \"Earth\")')"),
  },
  async ({ code }) => {
    try {
      const result = await client.directScript(code);
      return textResult({
        message: "Script executed",
        result: result || "ok",
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 14. get_property ────────────────────────────────────────────────

server.tool(
  "get_property",
  "Get the value of a Stellarium internal property. Properties control many aspects of Stellarium's behavior and display.",
  {
    id: z
      .string()
      .describe("Property ID (e.g. 'StelMovementMgr.currentFov', 'StelSkyDrawer.limitMagnitude')"),
  },
  async ({ id }) => {
    try {
      const result = await client.getProperty(id);
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 15. set_property ────────────────────────────────────────────────

server.tool(
  "set_property",
  "Set a Stellarium internal property value. Use with caution — this can change any aspect of Stellarium's behavior.",
  {
    id: z
      .string()
      .describe("Property ID to set"),
    value: z
      .string()
      .describe("New value for the property (as string)"),
  },
  async ({ id, value }) => {
    try {
      await client.setProperty(id, value);
      return textResult({ message: `Property ${id} set to ${value}` });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── 16. toggle_display_feature ──────────────────────────────────────

server.tool(
  "toggle_display_feature",
  "Toggle Stellarium display features on/off. Common features: constellation_lines, constellation_labels, constellation_art, atmosphere, ground, cardinal_points, equatorial_grid, azimuthal_grid, stars, planets, nebulae, milky_way.",
  {
    feature: z
      .enum([
        "constellation_lines",
        "constellation_labels",
        "constellation_art",
        "atmosphere",
        "ground",
        "cardinal_points",
        "equatorial_grid",
        "azimuthal_grid",
        "stars",
        "planets",
        "nebulae",
        "milky_way",
      ])
      .describe("The display feature to toggle"),
  },
  async ({ feature }) => {
    try {
      const actionMap: Record<string, string> = {
        constellation_lines: "actionShow_Constellation_Lines",
        constellation_labels: "actionShow_Constellation_Labels",
        constellation_art: "actionShow_Constellation_Art",
        atmosphere: "actionShow_Atmosphere",
        ground: "actionShow_Ground",
        cardinal_points: "actionShow_Cardinal_Points",
        equatorial_grid: "actionShow_Equatorial_Grid",
        azimuthal_grid: "actionShow_Azimuthal_Grid",
        stars: "actionShow_Stars",
        planets: "actionShow_Planets",
        nebulae: "actionShow_Nebulae",
        milky_way: "actionShow_MilkyWay",
      };

      const actionId = actionMap[feature];
      if (!actionId) {
        return errorResult(`Unknown feature: ${feature}`);
      }

      const result = await client.doAction(actionId);
      return textResult({
        message: `Toggled ${feature}`,
        result,
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (not stdout — stdout is reserved for MCP JSON-RPC)
  console.error("Stellarium MCP server running on stdio");
  console.error(`Connecting to Stellarium at ${STELLARIUM_HOST}:${STELLARIUM_PORT}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
