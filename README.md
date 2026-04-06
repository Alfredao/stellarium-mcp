# Stellarium MCP Server

An MCP (Model Context Protocol) server that lets AI agents control [Stellarium](https://stellarium.org/) — the open-source planetarium software — via its Remote Control HTTP API.

Built for astronomy workflows including telescope alignment, observation planning, and sky exploration. Especially useful in the southern hemisphere where Polaris is not available for polar alignment.

## Prerequisites

- **Node.js** 18+ installed
- **Stellarium** installed with the **Remote Control** plugin enabled
  - Open Stellarium → Press `F2` → Plugins → Remote Control
  - Check "Load at startup"
  - Click "configure" → Check "Server enabled" and "Enable automatically on startup"
  - Default port: `8090`

## Installation

```bash
cd stellarium-mcp
npm install
npm run build
```

## Usage with Claude Desktop

Add this to your Claude Desktop configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "stellarium": {
      "command": "node",
      "args": ["/FULL/PATH/TO/stellarium-mcp/build/index.js"],
      "env": {
        "STELLARIUM_HOST": "localhost",
        "STELLARIUM_PORT": "8090"
      }
    }
  }
}
```

## Usage with Claude Code

```bash
claude mcp add stellarium node /FULL/PATH/TO/stellarium-mcp/build/index.js
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STELLARIUM_HOST` | `localhost` | Stellarium Remote Control host |
| `STELLARIUM_PORT` | `8090` | Stellarium Remote Control port |
| `STELLARIUM_PASSWORD` | *(none)* | Password if authentication is enabled |

## Available Tools

### Core Tools

| Tool | Description |
|---|---|
| `get_status` | Get current observer location, time, view direction, and FOV |
| `search_object` | Search for celestial objects by name |
| `get_object_info` | Get detailed info (coordinates, magnitude, rise/set times) |
| `point_to_object` | Point the view/telescope to a named object |
| `get_current_view` | Get current viewing direction in multiple coordinate systems |
| `set_fov` | Set the field of view (zoom level) |

### Alignment Helpers

| Tool | Description |
|---|---|
| `suggest_alignment_stars` | Suggest optimal stars for telescope multi-star alignment |
| `list_visible_objects` | List objects of a given type in the catalogue |
| `list_object_types` | List all available object type categories |

### Time & Location

| Tool | Description |
|---|---|
| `set_time` | Set simulation time (Julian Day, UTC string, or time rate) |
| `set_time_to_now` | Reset simulation to current real-world time |

### Advanced

| Tool | Description |
|---|---|
| `simbad_lookup` | Query the SIMBAD astronomical database |
| `run_script` | Execute Stellarium Script commands directly |
| `get_property` | Read a Stellarium internal property |
| `set_property` | Write a Stellarium internal property |
| `toggle_display_feature` | Toggle display features (grids, constellations, atmosphere, etc.) |

## Example Conversations

**"What bright stars can I use to align my telescope tonight?"**
→ Agent uses `get_status` to check location/time, then `suggest_alignment_stars` to find the best 3 stars.

**"Show me where the Southern Cross is"**
→ Agent uses `search_object` for "Crux", then `point_to_object` to center the view.

**"What planets are visible right now?"**
→ Agent uses `list_visible_objects` with type "Planet", then `get_object_info` on each to check altitude.

## License

MIT
