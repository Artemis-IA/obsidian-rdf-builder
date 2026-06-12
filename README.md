# Obsidian RDF Graph Viewer

Interactive RDF graph visualization plugin for Obsidian. Load ontologies from URIs, SPARQL endpoints, or local `.ttl` files and explore them with an interactive graph interface.

## Features

- **Load RDF from multiple sources**:
  - HTTP/HTTPS URIs (remote ontologies)
  - SPARQL endpoints (with custom CONSTRUCT queries)
  - Local `.ttl` files from your vault
  - Clipboard (paste Turtle content directly)
  
- **Interactive graph visualization**:
  - Force-directed layout (cose)
  - Multiple layout options (dagre, concentric, breadthfirst, circle, grid)
  - Zoom, pan, and node selection
  - Color-coded nodes by type (classes, properties, instances, literals)

- **TBox/ABox distinction**:
  - TBox (terminology): classes and properties (blue/green)
  - ABox (assertions): instances and data (orange)
  - Toggle visibility of TBox/ABox independently

- **Prefix compression**:
  - Automatic URI compression (e.g., `http://www.w3.org/2000/01/rdf-schema#Class` → `rdfs:Class`)
  - Support for custom prefixes defined in Turtle files

- **Export options**:
  - Export to Mermaid (for Markdown rendering)
  - Export to Obsidian Canvas (native Obsidian format)
  - Export to PNG (image)

- **Configurable settings**:
  - Default layout algorithm
  - TBox/ABox/Literals inclusion preferences
  - Visual customization (node size, edge width, font size)
  - Color schemes
  - Default SPARQL endpoint

## Installation

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/Artemis-IA/obsidian-rdf-builder/releases)
2. Extract the downloaded zip file
3. Copy the extracted folder to your vault's `.obsidian/plugins/` directory
4. Enable the plugin in Obsidian Settings → Community Plugins

### Development Installation

```bash
# Clone the repository
git clone https://github.com/Artemis-IA/obsidian-rdf-builder.git
cd obsidian-rdf-builder

# Install dependencies
npm install

# Build the plugin
npm run build

# Copy to your vault's plugins directory
cp main.js styles.css manifest.json ~/.obsidian/plugins/obsidian-rdf-builder/
```

## Usage

### Load RDF from URI

1. Open Command Palette (`Ctrl/Cmd + P`)
2. Search for "RDF: Load RDF from URI"
3. Enter the URI of the ontology (e.g., `https://example.org/ontology.ttl`)
4. The graph will be displayed in the right sidebar

### Load RDF from SPARQL Endpoint

1. Configure default SPARQL endpoint in plugin settings
2. Open Command Palette
3. Search for "RDF: Load RDF from SPARQL endpoint"
4. The plugin will use the configured endpoint or prompt for one
5. Graph data is loaded via CONSTRUCT query

### Load RDF from Local File

1. Place `.ttl` files in your vault
2. Open Command Palette
3. Search for "RDF: Load RDF from local file"
4. The plugin will find and load the first `.ttl file

### Load RDF from Clipboard

1. Copy Turtle content to clipboard
2. Open Command Palette
3. Search for "RDF: Load RDF from clipboard"
4. Paste the content when prompted

### Export Graph

- **To Mermaid**: Command "RDF: Export graph to Mermaid" - creates a new note with Mermaid code
- **To Canvas**: Command "RDF: Export graph to Obsidian Canvas" - creates a .canvas file
- **To PNG**: Command "RDF: Export graph to PNG" - downloads the graph as an image

## Supported RDF Formats

- Turtle (`.ttl`, `.turtle`)
- N-Triples (`.nt`, `.ntriples`)
- N-Quads (`.nq`, `.nquads`)
- TriG (`.trig`)

## Graph Controls

- **Zoom**: Mouse wheel or pinch gesture
- **Pan**: Click and drag on empty space
- **Select node**: Click on a node to see its properties in the console
- **Fit to view**: Command "RDF: Fit graph to view"

## Commands

| Command | Description |
|---------|-------------|
| RDF: Load RDF from URI | Load ontology from a remote URI |
| RDF: Load RDF from local file | Load ontology from vault .ttl files |
| RDF: Load RDF from clipboard | Load ontology from clipboard content |
| RDF: Load RDF from SPARQL endpoint | Load ontology from SPARQL endpoint |
| RDF: Toggle RDF Graph View | Open/close the graph view |
| RDF: Export graph to Mermaid | Export to Mermaid format |
| RDF: Export graph to Obsidian Canvas | Export to Canvas format |
| RDF: Export graph to PNG | Export to PNG image |

## Settings

### Layout Settings
- **Default layout**: Choose between cose, dagre, concentric, breadthfirst, circle, or grid

### Content Settings
- **Include TBox by default**: Show classes and properties
- **Include ABox by default**: Show instances and data
- **Include literals by default**: Show literal values
- **Include blank nodes by default**: Show blank nodes

### Visual Settings
- **Node size**: Size of graph nodes (10-100px)
- **Edge width**: Width of graph edges (1-10px)
- **Font size**: Font size for labels (8-24px)
- **Show labels**: Display node and edge labels
- **Color scheme**: Default, Dark, Light, or Pastel

### SPARQL Settings
- **Default SPARQL endpoint**: Configure default endpoint for quick loading

## Development

### Project Structure

```
obsidian-rdf-builder/
├── src/
│   ├── main.ts              # Plugin entry point
│   ├── views/
│   │   └── RDFGraphView.ts  # Custom view with Cytoscape
│   ├── rdf/
│   │   ├── parser.ts        # N3.js RDF parser
│   │   ├── prefix.ts        # Prefix compression/expansion
│   │   ├── classifier.ts    # TBox/ABox classification
│   │   └── converter.ts     # RDF → Cytoscape conversion
│   ├── loaders/
│   │   ├── uri-loader.ts    # Load from HTTP URIs
│   │   ├── file-loader.ts   # Load from vault files
│   │   ├── clipboard.ts     # Load from clipboard
│   │   └── sparql-loader.ts # Load from SPARQL endpoints
│   ├── exporters/
│   │   ├── mermaid.ts       # Export to Mermaid
│   │   ├── canvas.ts        # Export to Obsidian Canvas
│   │   └── png.ts           # Export to PNG
│   └── ui/
│       └── settings.ts      # Plugin settings
├── styles.css               # Plugin styles
├── manifest.json            # Plugin manifest
├── package.json             # NPM dependencies
├── tsconfig.json            # TypeScript config
└── esbuild.config.mjs       # Build configuration
```

### Build

```bash
# Development mode (watch for changes)
npm run dev

# Production build
npm run build
```

## Dependencies

- [N3.js](https://github.com/rdfjs/N3.js) - RDF parsing and serialization
- [Cytoscape.js](https://js.cytoscape.org/) - Graph visualization library
- [Obsidian API](https://docs.obsidian.md/) - Obsidian plugin API

## Roadmap

- [ ] File selector for local file loading
- [ ] Sidebar with node details panel
- [ ] Graph search and filtering
- [ ] Multiple graph tabs
- [ ] Custom color schemes
- [ ] SPARQL query builder UI
- [ ] Incremental loading from large endpoints

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Credits

- Built with [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- RDF parsing powered by [N3.js](https://github.com/rdfjs/N3.js)
- Graph visualization powered by [Cytoscape.js](https://js.cytoscape.org/)
