import { FileView, WorkspaceLeaf, Modal, FuzzySuggestModal, App, TFile, Notice } from 'obsidian';
import cytoscape, { Core, NodeSingular } from 'cytoscape';
import { RDFDataset, RDFParser } from '../rdf/parser';
import { RDFToCytoscapeConverter } from '../rdf/converter';
import { OntologyAnalyzer, ClassNode } from '../rdf/ontology';
import { RDFSourceEditor } from '../ui/source-editor';
import { URILoader } from '../loaders/uri-loader';
import { AlignmentResult } from '../rdf/alignment';

/** Cache of remotely fetched vocabularies (shared across views) */
const remoteVocabCache = new Map<string, Promise<RDFDataset | null>>();

export const VIEW_TYPE_RDF = 'rdf-graph-view';

/**
 * File picker modal for selecting .ttl files from the vault
 */
export class RDFFilePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder('Select an RDF file...');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(item);
  }
}

export type RDFViewMode = 'graph' | 'hierarchy' | 'properties' | 'stats';

export class RDFGraphView extends FileView {
  allowNoFile = true;

  private cy: Core | null = null;
  private converter: RDFToCytoscapeConverter;
  private currentDataset: RDFDataset | null = null;
  private graphContainer: HTMLDivElement | null = null;
  private hierarchyContainer: HTMLDivElement | null = null;
  private propertiesContainer: HTMLDivElement | null = null;
  private statsContainer: HTMLDivElement | null = null;
  private sidebarEl: HTMLDivElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private selectedNode: NodeSingular | null = null;
  private viewMode: RDFViewMode = 'graph';
  private modeButtons: Map<RDFViewMode, HTMLButtonElement> = new Map();
  private statusBar: HTMLDivElement | null = null;
  private currentLayoutName = 'cose';
  private sourceContainer: HTMLDivElement | null = null;
  private sourceEditor: RDFSourceEditor | null = null;
  private sourceVisible = false;
  private sourceToggleBtn: HTMLButtonElement | null = null;
  private currentSource: string = '';
  private saveTimer: number | null = null;
  private parseErrorEl: HTMLDivElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.converter = new RDFToCytoscapeConverter();
  }

  getViewType() {
    return VIEW_TYPE_RDF;
  }

  getDisplayText() {
    return this.file ? this.file.basename : 'RDF Graph';
  }

  getIcon() {
    return 'network';
  }

  /**
   * Called when a registered file (.ttl, .jsonld, ...) is opened in this view
   */
  async onLoadFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      this.currentSource = content;
      if (this.sourceEditor) {
        this.sourceEditor.setContent(content);
      }
      const parser = new RDFParser();
      const dataset = await parser.parse(content);
      await this.loadDataset(dataset);
      new Notice(`Loaded ${dataset.quads.length} triples from ${file.name}`);
    } catch (error) {
      new Notice(`Error parsing ${file.name}: ${error}`);
      console.error(error);
    }
  }

  async onUnloadFile(file: TFile): Promise<void> {
    // Keep dataset in memory; nothing to clean per-file
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';

    // === Toolbar ===
    const toolbar = container.createDiv('rdf-toolbar');

    // Search input
    this.searchInput = toolbar.createEl('input', {
      type: 'text',
      placeholder: 'Search nodes...',
      cls: 'rdf-search-input'
    });
    this.searchInput.addEventListener('input', () => this.onSearch());

    // Layout selector
    const layoutSelect = toolbar.createEl('select', { cls: 'rdf-layout-select' });
    const layouts = ['cose', 'dagre', 'concentric', 'breadthfirst', 'circle', 'grid'];
    for (const l of layouts) {
      layoutSelect.createEl('option', { text: l, value: l });
    }
    layoutSelect.addEventListener('change', () => {
      this.setLayout(layoutSelect.value);
    });

    // Filter toggles
    const filterGroup = toolbar.createDiv('rdf-filter-group');

    const filterTBox = filterGroup.createEl('label', { cls: 'rdf-filter-label' });
    const tboxCheck = filterTBox.createEl('input', { type: 'checkbox' });
    tboxCheck.checked = true;
    filterTBox.createSpan({ text: ' TBox' });
    tboxCheck.addEventListener('change', () => this.filterByType('tbox', tboxCheck.checked));

    const filterABox = filterGroup.createEl('label', { cls: 'rdf-filter-label' });
    const aboxCheck = filterABox.createEl('input', { type: 'checkbox' });
    aboxCheck.checked = true;
    filterABox.createSpan({ text: ' ABox' });
    aboxCheck.addEventListener('change', () => this.filterByType('abox', aboxCheck.checked));

    const filterLit = filterGroup.createEl('label', { cls: 'rdf-filter-label' });
    const litCheck = filterLit.createEl('input', { type: 'checkbox' });
    litCheck.checked = true;
    filterLit.createSpan({ text: ' Literals' });
    litCheck.addEventListener('change', () => this.filterByType('literal', litCheck.checked));

    // Fit button
    const fitBtn = toolbar.createEl('button', { text: 'Fit', cls: 'rdf-toolbar-btn' });
    fitBtn.addEventListener('click', () => this.fitGraph());

    // Source pane toggle (split editing)
    this.sourceToggleBtn = toolbar.createEl('button', { text: '☰ Source', cls: 'rdf-toolbar-btn' });
    this.sourceToggleBtn.addEventListener('click', () => this.toggleSource());

    // === View mode tabs ===
    const modeBar = container.createDiv('rdf-mode-bar');
    const modes: { mode: RDFViewMode; label: string }[] = [
      { mode: 'graph', label: 'Graph' },
      { mode: 'hierarchy', label: 'Hierarchy' },
      { mode: 'properties', label: 'Properties' },
      { mode: 'stats', label: 'Stats' }
    ];
    for (const { mode, label } of modes) {
      const btn = modeBar.createEl('button', { text: label, cls: 'rdf-mode-btn' });
      if (mode === this.viewMode) btn.addClass('rdf-mode-active');
      btn.addEventListener('click', () => this.switchMode(mode));
      this.modeButtons.set(mode, btn);
    }

    // === Main content area (source + graph + sidebar) ===
    const mainArea = container.createDiv('rdf-main-area');

    // Source editor pane (hidden until toggled)
    this.sourceContainer = mainArea.createDiv('rdf-source-container');
    this.sourceContainer.style.display = 'none';

    // Graph container
    this.graphContainer = mainArea.createDiv('rdf-graph-container');
    this.graphContainer.style.flex = '1';

    // Alternative view containers (hidden by default)
    this.hierarchyContainer = mainArea.createDiv('rdf-hierarchy-container');
    this.hierarchyContainer.style.display = 'none';
    this.propertiesContainer = mainArea.createDiv('rdf-properties-container');
    this.propertiesContainer.style.display = 'none';
    this.statsContainer = mainArea.createDiv('rdf-stats-container');
    this.statsContainer.style.display = 'none';

    // Sidebar
    this.sidebarEl = mainArea.createDiv('rdf-sidebar');
    this.sidebarEl.style.display = 'none';
    this.renderSidebarEmpty();

    // Legend overlay (graph mode)
    const legend = this.graphContainer.createDiv('rdf-legend');
    const legendItems: [string, string, string][] = [
      ['#5b9bd5', '●', 'Class'],
      ['#6bc77d', '◆', 'Property'],
      ['#f0a04b', '▢', 'Instance'],
      ['#8a8f98', '▫', 'Literal']
    ];
    for (const [color, glyph, name] of legendItems) {
      const item = legend.createSpan({ cls: 'rdf-legend-item' });
      const dot = item.createSpan({ text: glyph, cls: 'rdf-legend-glyph' });
      dot.style.color = color;
      item.createSpan({ text: name });
    }

    // Status bar (bottom)
    this.statusBar = container.createDiv('rdf-status-bar');
    this.statusBar.setText('No data loaded — click a .ttl file or use the command palette');

    // Initialize Cytoscape with a refined scientific style
    this.cy = cytoscape({
      container: this.graphContainer,
      wheelSensitivity: 0.2,
      pixelRatio: 1, // perf: avoid hidpi over-rendering on large graphs
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#8a8f98',
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#c8cdd4',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'text-wrap': 'ellipsis',
            'text-max-width': '110px',
            'width': 'mapData(degree, 0, 20, 14, 46)',
            'height': 'mapData(degree, 0, 20, 14, 46)',
            'border-width': 1.5,
            'border-color': 'rgba(255,255,255,0.25)',
            'transition-property': 'opacity',
            'transition-duration': 150
          } as any
        },
        {
          selector: 'node[nodeType="class"]',
          style: {
            'background-color': '#5b9bd5',
            'shape': 'ellipse',
            'font-weight': 'bold',
            'font-size': '10px',
            'color': '#9cc3e8'
          } as any
        },
        {
          selector: 'node[nodeType="property"]',
          style: {
            'background-color': '#6bc77d',
            'shape': 'diamond',
            'color': '#a3d9af'
          }
        },
        {
          selector: 'node[nodeType="instance"]',
          style: {
            'background-color': '#f0a04b',
            'shape': 'round-rectangle',
            'color': '#f4c08a'
          }
        },
        {
          selector: 'node[nodeType="literal"]',
          style: {
            'background-color': '#3d4148',
            'shape': 'round-rectangle',
            'border-style': 'dashed',
            'border-color': '#8a8f98',
            'width': '10px',
            'height': '10px',
            'font-size': '8px',
            'font-style': 'italic',
            'color': '#8a8f98'
          } as any
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': 'rgba(150,155,165,0.4)',
            'target-arrow-color': 'rgba(150,155,165,0.6)',
            'target-arrow-shape': 'vee',
            'arrow-scale': 0.8,
            'curve-style': 'straight',
            'label': 'data(label)',
            'font-size': '7px',
            'color': 'rgba(170,175,185,0.8)',
            'text-rotation': 'autorotate',
            'text-margin-y': -6,
            'text-background-color': '#1e2127',
            'text-background-opacity': 0.7,
            'text-background-padding': '1px'
          } as any
        },
        {
          selector: 'edge[edgeType="tbox"]',
          style: {
            'line-color': 'rgba(91,155,213,0.55)',
            'target-arrow-color': 'rgba(91,155,213,0.8)',
            'line-style': 'solid',
            'width': 1.5
          }
        },
        {
          selector: 'edge[edgeType="abox"]',
          style: {
            'line-color': 'rgba(240,160,75,0.45)',
            'target-arrow-color': 'rgba(240,160,75,0.7)'
          }
        },
        // === Alignment styles ===
        {
          selector: 'node[graphSrc="A"]',
          style: {
            'border-width': 3,
            'border-color': '#5b9bd5'
          }
        },
        {
          selector: 'node[graphSrc="B"]',
          style: {
            'border-width': 3,
            'border-color': '#f0a04b'
          }
        },
        {
          selector: 'node[graphSrc="both"]',
          style: {
            'background-color': '#9b6bd5',
            'border-width': 3,
            'border-color': '#c9aef0'
          }
        },
        {
          selector: 'edge[edgeType="structure"]',
          style: {
            'line-color': 'rgba(150,155,165,0.25)',
            'target-arrow-color': 'rgba(150,155,165,0.4)',
            'label': ''
          } as any
        },
        {
          selector: 'edge[edgeType="align-explicit"]',
          style: {
            'line-color': 'rgba(107,199,125,0.85)',
            'target-arrow-color': 'rgba(107,199,125,1)',
            'line-style': 'dashed',
            'width': 2.5,
            'curve-style': 'unbundled-bezier'
          } as any
        },
        {
          selector: 'edge[edgeType="align-suggested"]',
          style: {
            'line-color': 'rgba(230,200,80,0.7)',
            'target-arrow-color': 'rgba(230,200,80,0.9)',
            'line-style': 'dotted',
            'width': 2,
            'curve-style': 'unbundled-bezier'
          } as any
        },
        // Selection: accent ring
        {
          selector: 'node.rdf-selected',
          style: {
            'border-width': 3,
            'border-color': '#e8556d',
            'border-style': 'solid',
            'z-index': 999
          } as any
        },
        // Neighborhood emphasis on selection
        {
          selector: '.rdf-neighborhood',
          style: {
            'opacity': 1,
            'z-index': 900
          } as any
        },
        {
          selector: 'edge.rdf-neighborhood',
          style: {
            'width': 2,
            'line-color': 'rgba(232,85,109,0.7)',
            'target-arrow-color': 'rgba(232,85,109,0.9)'
          }
        },
        // Dim style (search filtering / selection focus)
        {
          selector: 'node.rdf-dimmed',
          style: {
            'opacity': 0.12,
            'label': ''
          } as any
        },
        {
          selector: 'edge.rdf-dimmed',
          style: {
            'opacity': 0.05,
            'label': ''
          } as any
        }
      ],
      layout: {
        name: 'cose',
        animate: false
      }
    });

    // Node click — sidebar details + neighborhood spotlight
    if (this.cy) {
      this.cy.on('tap', 'node', (evt: any) => {
        const node = evt.target;
        this.selectNode(node);
        this.spotlightNeighborhood(node);
      });

      // Click on background deselects
      this.cy.on('tap', (evt: any) => {
        if (evt.target === this.cy) {
          this.deselectNode();
          this.clearSpotlight();
        }
      });

      // Double-click background → fit
      this.cy.on('dbltap', (evt: any) => {
        if (evt.target === this.cy) this.fitGraph();
      });

      // Hover → live highlight of matching lines in the source editor
      this.cy.on('mouseover', 'node', (evt: any) => {
        if (!this.sourceVisible || !this.sourceEditor) return;
        const node = evt.target;
        const tokens = this.tokensForNode(node);
        const lines = this.sourceEditor.findLinesContaining(tokens);
        this.sourceEditor.highlightLines(lines);
      });

      this.cy.on('mouseout', 'node', () => {
        if (!this.sourceVisible || !this.sourceEditor) return;
        this.sourceEditor.highlightLines([]);
      });
    }
  }

  // =====================
  // Source ↔ Graph split editing
  // =====================

  /**
   * Compute the textual tokens a node may appear as in the Turtle source:
   * full IRI form <uri>, prefixed form pre:local, or literal value.
   */
  private tokensForNode(node: NodeSingular): string[] {
    const uri: string = node.data('fullUri') || node.id();
    const nodeType: string = node.data('nodeType');
    const tokens: string[] = [];

    if (nodeType === 'literal') {
      // Search for the quoted literal value (truncate very long ones)
      const val = uri.length > 60 ? uri.slice(0, 60) : uri;
      tokens.push(`"${val}`);
      return tokens;
    }

    tokens.push(`<${uri}>`);

    // Prefixed form using dataset prefixes
    if (this.currentDataset) {
      for (const [prefix, ns] of Object.entries(this.currentDataset.prefixes)) {
        if (uri.startsWith(ns)) {
          tokens.push(`${prefix}:${uri.slice(ns.length)}`);
        }
      }
    }

    return tokens;
  }

  toggleSource() {
    this.sourceVisible = !this.sourceVisible;

    if (this.sourceVisible) {
      if (this.sourceContainer) {
        this.sourceContainer.style.display = 'flex';
        if (!this.sourceEditor) {
          // Error banner (parse feedback)
          this.parseErrorEl = this.sourceContainer.createDiv('rdf-parse-error');
          this.parseErrorEl.style.display = 'none';

          const editorHost = this.sourceContainer.createDiv('rdf-source-editor-host');
          this.sourceEditor = new RDFSourceEditor(editorHost, this.currentSource, {
            onChange: (content) => this.onSourceEdited(content),
            onTermHover: (prefix, local, ns) => this.buildTermTooltip(prefix, local, ns)
          });
        } else {
          this.sourceEditor.setContent(this.currentSource);
        }
      }
      this.sourceToggleBtn?.addClass('rdf-toolbar-btn-active');
    } else {
      if (this.sourceContainer) this.sourceContainer.style.display = 'none';
      this.sourceToggleBtn?.removeClass('rdf-toolbar-btn-active');
    }

    // Graph must resize after the split change
    setTimeout(() => {
      if (this.cy) {
        this.cy.resize();
        this.cy.fit(undefined, 30);
      }
    }, 60);
  }

  /**
   * Live pipeline: source edited → parse → update graph → autosave file.
   * Parse errors are shown inline without destroying the current graph.
   */
  private async onSourceEdited(content: string) {
    this.currentSource = content;

    try {
      const parser = new RDFParser();
      const dataset = await parser.parse(content);
      this.showParseError(null);
      await this.loadDataset(dataset, { preservePositions: true });
    } catch (error: any) {
      this.showParseError(String(error?.message || error));
      return; // keep last valid graph; don't save broken content? → still save (user's file)
    } finally {
      // Autosave to the underlying file (debounced)
      if (this.file) {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(async () => {
          if (this.file) {
            await this.app.vault.modify(this.file, this.currentSource);
          }
        }, 800);
      }
    }
  }

  /**
   * Build the hover tooltip for a prefixed term: resolves the namespace,
   * fetches the remote vocabulary (cached) and shows label/comment/type
   * plus a mini graph preview and a button to load the full remote graph.
   */
  private async buildTermTooltip(prefix: string, local: string, ns: string | null): Promise<HTMLElement | null> {
    if (!ns) return null;

    const card = createDiv({ cls: 'rdf-term-tooltip' });
    const header = card.createDiv({ cls: 'rdf-term-tooltip-header' });
    header.createEl('strong', { text: `${prefix}:${local}` });

    const uri = ns + local;
    card.createDiv({ text: uri, cls: 'rdf-term-tooltip-uri' });

    const body = card.createDiv({ cls: 'rdf-term-tooltip-body' });
    body.setText('Fetching vocabulary…');

    // Mini graph container for preview
    const graphPreview = card.createDiv({ cls: 'rdf-term-tooltip-graph' });
    graphPreview.style.height = '180px';
    graphPreview.style.width = '100%';
    graphPreview.style.display = 'none';

    // Fetch remote vocabulary (cached per namespace)
    let promise = remoteVocabCache.get(ns);
    if (!promise) {
      const loader = new URILoader();
      promise = loader.loadFromURI(ns).catch((): RDFDataset | null => null);
      remoteVocabCache.set(ns, promise);
    }

    promise.then(dataset => {
      body.empty();
      if (!dataset) {
        body.createDiv({ text: 'Could not fetch remote vocabulary', cls: 'rdf-term-tooltip-muted' });
        return;
      }

      const analyzer = new OntologyAnalyzer(dataset);
      const label = analyzer.getLabel(uri);
      const comment = analyzer.getComment(uri);

      if (label && label !== uri) {
        body.createDiv({ text: label, cls: 'rdf-term-tooltip-label' });
      }
      if (comment) {
        const c = comment.length > 220 ? comment.slice(0, 217) + '…' : comment;
        body.createDiv({ text: c, cls: 'rdf-term-tooltip-comment' });
      }
      if (!comment && (!label || label === uri)) {
        // Term not described in the fetched doc — show vocab stats instead
        const stats = analyzer.computeStats();
        body.createDiv({
          text: `Vocabulary: ${stats.totalTriples.toLocaleString()} triples · ${stats.classCount} classes`,
          cls: 'rdf-term-tooltip-muted'
        });
      }

      // Render mini graph preview (focused on the hovered term)
      graphPreview.style.display = 'block';
      this.renderMiniGraph(graphPreview, dataset, uri);

      // Action: load the remote vocabulary into the graph
      const btn = body.createEl('button', { text: '⧉ Load full vocabulary graph', cls: 'rdf-term-tooltip-btn' });
      btn.addEventListener('click', async () => {
        await this.loadDataset(dataset);
        new Notice(`${prefix}: vocabulary loaded (${dataset.quads.length} triples)`);
      });
    });

    return card;
  }

  /**
   * Render a mini Cytoscape graph preview focused on a specific term
   */
  private renderMiniGraph(container: HTMLElement, dataset: RDFDataset, focusUri: string) {
    const converter = new RDFToCytoscapeConverter();
    const elements = converter.convert(dataset, {
      includeTBox: true,
      includeABox: false,
      includeLiterals: false,
      includeBlanks: false
    });

    // Filter to show only the focus term and its 1-hop neighborhood
    const focusNode = elements.nodes.find(n => n.data.id === focusUri);
    const focusId = focusNode ? focusUri : null;

    const neighborhoodIds = new Set<string>();
    if (focusId) {
      neighborhoodIds.add(focusId);
      // Find connected nodes
      elements.edges.forEach(e => {
        if (e.data.source === focusId) neighborhoodIds.add(e.data.target);
        if (e.data.target === focusId) neighborhoodIds.add(e.data.source);
      });
    }

    // If focus not found, show top 20 classes as fallback
    if (neighborhoodIds.size === 0) {
      const classNodes = elements.nodes.filter(n => n.data.nodeType === 'class').slice(0, 20);
      classNodes.forEach(n => neighborhoodIds.add(n.data.id));
    }

    const filteredNodes = elements.nodes.filter(n => neighborhoodIds.has(n.data.id));
    const filteredEdges = elements.edges.filter(e => 
      neighborhoodIds.has(e.data.source) && neighborhoodIds.has(e.data.target)
    );

    const miniCy = cytoscape({
      container,
      elements: [...filteredNodes, ...filteredEdges],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#5b9bd5',
            'label': 'data(label)',
            'font-size': '8px',
            'color': '#c8cdd4',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': 20,
            'height': 20,
            'border-width': 1,
            'border-color': 'rgba(255,255,255,0.3)'
          }
        },
        {
          selector: 'node[nodeType="property"]',
          style: {
            'background-color': '#6bc77d',
            'shape': 'diamond'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': 'rgba(150,155,165,0.5)',
            'target-arrow-color': 'rgba(150,155,165,0.7)',
            'target-arrow-shape': 'vee',
            'curve-style': 'straight'
          }
        }
      ],
      layout: {
        name: 'cose',
        animate: false,
        numIter: 200,
        nodeRepulsion: 400,
        idealEdgeLength: 50
      },
      wheelSensitivity: 0.3,
      pixelRatio: 1
    });

    // Auto-fit to show the preview
    setTimeout(() => {
      miniCy.fit(undefined, 20);
    }, 50);
  }

  /**
   * Insert a term at the cursor in the source editor (opening it if needed).
   * Adds the @prefix declaration when missing.
   */
  insertTerm(prefixedName: string, prefix: string, ns: string): boolean {
    if (!this.sourceVisible) this.toggleSource();
    if (!this.sourceEditor) return false;

    if (prefix && ns) {
      const added = this.sourceEditor.ensurePrefix(prefix, ns);
      if (added) new Notice(`@prefix ${prefix}: added`);
    }
    this.sourceEditor.insertAtCursor(prefixedName);
    return true;
  }

  private showParseError(message: string | null) {
    if (!this.parseErrorEl) return;
    if (message) {
      this.parseErrorEl.setText(`⚠ ${message}`);
      this.parseErrorEl.style.display = 'block';
    } else {
      this.parseErrorEl.style.display = 'none';
    }
  }

  /**
   * Spotlight the 1-hop neighborhood of a node, dim the rest
   */
  private spotlightNeighborhood(node: NodeSingular) {
    if (!this.cy) return;
    this.clearSpotlight();
    const hood = node.closedNeighborhood();
    this.cy.elements().not(hood).addClass('rdf-dimmed');
    hood.addClass('rdf-neighborhood');
  }

  private clearSpotlight() {
    if (!this.cy) return;
    this.cy.elements().removeClass('rdf-dimmed rdf-neighborhood');
  }

  private updateStatusBar() {
    if (!this.statusBar || !this.cy) return;
    const n = this.cy.nodes().length;
    const e = this.cy.edges().length;
    const t = this.currentDataset?.quads.length || 0;
    this.statusBar.setText(`${t.toLocaleString()} triples · ${n.toLocaleString()} nodes · ${e.toLocaleString()} edges · layout: ${this.currentLayoutName}`);
  }

  getCurrentDataset(): RDFDataset | null {
    return this.currentDataset;
  }

  async onClose() {
    if (this.cy) {
      this.cy.destroy();
      this.cy = null;
    }
    if (this.sourceEditor) {
      this.sourceEditor.destroy();
      this.sourceEditor = null;
    }
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
  }

  // =====================
  // View modes
  // =====================

  switchMode(mode: RDFViewMode) {
    this.viewMode = mode;

    // Update tab styles
    this.modeButtons.forEach((btn, m) => {
      if (m === mode) btn.addClass('rdf-mode-active');
      else btn.removeClass('rdf-mode-active');
    });

    // Show/hide containers
    if (this.graphContainer) this.graphContainer.style.display = mode === 'graph' ? 'block' : 'none';
    if (this.hierarchyContainer) this.hierarchyContainer.style.display = mode === 'hierarchy' ? 'block' : 'none';
    if (this.propertiesContainer) this.propertiesContainer.style.display = mode === 'properties' ? 'block' : 'none';
    if (this.statsContainer) this.statsContainer.style.display = mode === 'stats' ? 'block' : 'none';

    // Render content for the selected mode
    if (mode === 'graph') {
      // Cytoscape needs resize after being shown again
      setTimeout(() => {
        if (this.cy) {
          this.cy.resize();
          this.cy.fit();
        }
      }, 50);
    } else if (this.currentDataset) {
      const analyzer = new OntologyAnalyzer(this.currentDataset);
      if (mode === 'hierarchy') this.renderHierarchy(analyzer);
      else if (mode === 'properties') this.renderProperties(analyzer);
      else if (mode === 'stats') this.renderStats(analyzer);
    }
  }

  private renderHierarchy(analyzer: OntologyAnalyzer) {
    if (!this.hierarchyContainer) return;
    this.hierarchyContainer.empty();

    const roots = analyzer.buildClassHierarchy();
    if (roots.length === 0) {
      this.hierarchyContainer.createEl('p', {
        text: 'No class hierarchy found (no rdfs:subClassOf or skos:broader relations)',
        cls: 'rdf-empty-message'
      });
      return;
    }

    this.hierarchyContainer.createEl('h3', { text: 'Class Hierarchy', cls: 'rdf-panel-title' });
    const treeEl = this.hierarchyContainer.createDiv('rdf-tree');
    for (const root of roots) {
      this.renderTreeNode(treeEl, root, 0);
    }
  }

  private renderTreeNode(parent: HTMLElement, node: ClassNode, depth: number) {
    const item = parent.createDiv('rdf-tree-item');
    item.style.paddingLeft = `${depth * 20}px`;

    const hasChildren = node.children.length > 0;
    const toggle = item.createSpan({ cls: 'rdf-tree-toggle' });
    toggle.setText(hasChildren ? '▾ ' : '· ');

    const labelEl = item.createSpan({ text: node.label, cls: 'rdf-tree-label' });
    if (node.instanceCount > 0) {
      item.createSpan({ text: ` (${node.instanceCount})`, cls: 'rdf-tree-count' });
    }
    if (node.comment) {
      labelEl.setAttr('title', node.comment);
    }

    // Click label → highlight node in graph view
    labelEl.addEventListener('click', () => {
      this.switchMode('graph');
      if (this.cy) {
        const cyNode = this.cy.getElementById(node.uri);
        if (cyNode.length > 0) {
          this.selectNode(cyNode as unknown as NodeSingular);
          this.cy.animate({ center: { eles: cyNode }, zoom: 1.5 }, { duration: 300 });
        }
      }
    });

    const childrenWrap = parent.createDiv('rdf-tree-children');
    for (const child of node.children) {
      this.renderTreeNode(childrenWrap, child, depth + 1);
    }

    if (hasChildren) {
      toggle.style.cursor = 'pointer';
      toggle.addEventListener('click', () => {
        const hidden = childrenWrap.style.display === 'none';
        childrenWrap.style.display = hidden ? 'block' : 'none';
        toggle.setText(hidden ? '▾ ' : '▸ ');
      });
    }
  }

  private renderProperties(analyzer: OntologyAnalyzer) {
    if (!this.propertiesContainer) return;
    this.propertiesContainer.empty();

    const props = analyzer.findProperties();
    this.propertiesContainer.createEl('h3', { text: 'Properties', cls: 'rdf-panel-title' });

    if (props.length === 0) {
      this.propertiesContainer.createEl('p', {
        text: 'No declared properties found (owl:ObjectProperty, owl:DatatypeProperty, rdf:Property)',
        cls: 'rdf-empty-message'
      });
      return;
    }

    const table = this.propertiesContainer.createEl('table', { cls: 'rdf-props-table' });
    const head = table.createEl('tr');
    ['Property', 'Type', 'Domain', 'Range'].forEach(h => head.createEl('th', { text: h }));

    for (const p of props) {
      const row = table.createEl('tr');
      row.createEl('td', { text: p.label, cls: 'rdf-prop-name' });
      row.createEl('td', { text: p.type, cls: 'rdf-prop-type rdf-prop-type-' + p.type });
      row.createEl('td', { text: p.domain || '—' });
      row.createEl('td', { text: p.range || '—' });
    }
  }

  private renderStats(analyzer: OntologyAnalyzer) {
    if (!this.statsContainer) return;
    this.statsContainer.empty();

    const stats = analyzer.computeStats();
    this.statsContainer.createEl('h3', { text: 'Ontology Statistics', cls: 'rdf-panel-title' });

    if (stats.ontologyUri) {
      const uriEl = this.statsContainer.createDiv('rdf-stats-uri');
      uriEl.createSpan({ text: 'Ontology: ', cls: 'rdf-stats-label' });
      uriEl.createSpan({ text: stats.ontologyUri, cls: 'rdf-stats-value-mono' });
    }

    const grid = this.statsContainer.createDiv('rdf-stats-grid');
    const cards: [string, number][] = [
      ['Triples', stats.totalTriples],
      ['Classes', stats.classCount],
      ['Object Properties', stats.objectPropertyCount],
      ['Datatype Properties', stats.datatypePropertyCount],
      ['Annotation Properties', stats.annotationPropertyCount],
      ['Individuals', stats.individualCount],
      ['SKOS Concepts', stats.skosConceptCount],
      ['Namespaces', stats.namespaces]
    ];

    for (const [label, value] of cards) {
      const card = grid.createDiv('rdf-stats-card');
      card.createDiv({ text: String(value), cls: 'rdf-stats-number' });
      card.createDiv({ text: label, cls: 'rdf-stats-caption' });
    }

    // Namespace listing
    if (this.currentDataset && Object.keys(this.currentDataset.prefixes).length > 0) {
      this.statsContainer.createEl('h4', { text: 'Namespaces', cls: 'rdf-panel-subtitle' });
      const nsTable = this.statsContainer.createEl('table', { cls: 'rdf-props-table' });
      for (const [prefix, ns] of Object.entries(this.currentDataset.prefixes)) {
        const row = nsTable.createEl('tr');
        row.createEl('td', { text: prefix + ':', cls: 'rdf-prop-name' });
        row.createEl('td', { text: ns, cls: 'rdf-stats-value-mono' });
      }
    }
  }

  // =====================
  // Search & Filtering
  // =====================

  private onSearch() {
    if (!this.cy || !this.searchInput) return;
    const query = this.searchInput.value.trim().toLowerCase();

    if (query === '') {
      // Clear search — show all
      this.cy.elements().removeClass('rdf-dimmed');
      return;
    }

    // Dim all, then highlight matching
    this.cy.elements().addClass('rdf-dimmed');

    const matchedNodes = this.cy.nodes().filter((node: NodeSingular) => {
      const label = (node.data('label') as string || '').toLowerCase();
      const id = (node.id() as string || '').toLowerCase();
      return label.includes(query) || id.includes(query);
    });

    matchedNodes.removeClass('rdf-dimmed');
    matchedNodes.connectedEdges().removeClass('rdf-dimmed');
  }

  // =====================
  // Sidebar
  // =====================

  private selectNode(node: NodeSingular) {
    if (!this.cy) return;

    // Remove previous selection
    this.cy.nodes().removeClass('rdf-selected');
    node.addClass('rdf-selected');
    this.selectedNode = node;

    // Show sidebar
    if (this.sidebarEl) {
      this.sidebarEl.style.display = 'block';
      this.renderSidebarNode(node);
    }
  }

  private deselectNode() {
    if (!this.cy) return;
    this.cy.nodes().removeClass('rdf-selected');
    this.selectedNode = null;

    if (this.sidebarEl) {
      this.sidebarEl.style.display = 'none';
    }
  }

  private renderSidebarEmpty() {
    if (!this.sidebarEl) return;
    this.sidebarEl.empty();
    this.sidebarEl.createEl('p', { text: 'Click a node to see details', cls: 'rdf-sidebar-hint' });
  }

  private renderSidebarNode(node: NodeSingular) {
    if (!this.sidebarEl) return;
    this.sidebarEl.empty();

    const data = node.data();
    const nodeType = data.nodeType || 'unknown';

    // Header
    const header = this.sidebarEl.createDiv('rdf-sidebar-header');
    header.createEl('h3', { text: data.label || node.id() });

    // Type badge
    const badge = this.sidebarEl.createDiv('rdf-sidebar-badge rdf-sidebar-badge-' + nodeType);
    badge.setText(nodeType.toUpperCase());

    // URI
    this.sidebarEl.createDiv('rdf-sidebar-section').createEl('p', {
      text: 'URI / ID',
      cls: 'rdf-sidebar-section-title'
    });
    this.sidebarEl.createDiv('rdf-sidebar-uri').setText(node.id());

    // Properties
    const propsSection = this.sidebarEl.createDiv('rdf-sidebar-section');
    propsSection.createEl('p', { text: 'Properties', cls: 'rdf-sidebar-section-title' });

    const propsList = propsSection.createEl('table', { cls: 'rdf-sidebar-table' });
    for (const [key, value] of Object.entries(data)) {
      if (key === 'label' || key === 'nodeType') continue;
      const row = propsList.createEl('tr');
      row.createEl('td', { text: key, cls: 'rdf-sidebar-key' });
      row.createEl('td', { text: String(value), cls: 'rdf-sidebar-value' });
    }

    // Connected edges
    const edgesSection = this.sidebarEl.createDiv('rdf-sidebar-section');
    edgesSection.createEl('p', { text: 'Connections', cls: 'rdf-sidebar-section-title' });

    const edgesList = edgesSection.createEl('ul', { cls: 'rdf-sidebar-connections' });
    const connectedEdges = node.connectedEdges();
    connectedEdges.forEach((edge: any) => {
      const isSource = edge.source().id() === node.id();
      const otherNode = isSource ? edge.target() : edge.source();
      const direction = isSource ? '→' : '←';
      const li = edgesList.createEl('li');
      li.createEl('span', { text: direction + ' ', cls: 'rdf-conn-dir' });
      li.createEl('span', { text: edge.data('label') || edge.id(), cls: 'rdf-conn-pred' });
      li.createEl('span', { text: ' ' + direction + ' ', cls: 'rdf-conn-dir' });
      li.createEl('span', { text: otherNode.data('label') || otherNode.id(), cls: 'rdf-conn-target' });
    });

    // Close button
    const closeBtn = this.sidebarEl.createEl('button', { text: 'Close', cls: 'rdf-sidebar-close' });
    closeBtn.addEventListener('click', () => this.deselectNode());
  }

  // =====================
  // Dataset & Layout
  // =====================

  async loadDataset(dataset: RDFDataset, opts: { preservePositions?: boolean } = {}) {
    this.currentDataset = dataset;

    const isLarge = dataset.quads.length > 2000;

    // Live editing: remember where existing nodes are
    const oldPositions = new Map<string, { x: number; y: number }>();
    if (opts.preservePositions && this.cy) {
      this.cy.nodes().forEach((n: any) => {
        oldPositions.set(n.id(), { ...n.position() });
      });
    }

    const elements = this.converter.convert(dataset, {
      includeTBox: true,
      includeABox: true,
      includeLiterals: !isLarge, // auto-hide literals on big graphs
      includeBlanks: false
    });

    if (this.cy) {
      const nodeCount = elements.nodes.length;

      // Pick layout based on size: cose chokes on >400 nodes
      let layoutName = 'cose';
      let layoutOpts: any = { name: 'cose', animate: false, numIter: 400 };
      if (nodeCount > 1200) {
        layoutName = 'grid';
        layoutOpts = { name: 'grid', animate: false };
      } else if (nodeCount > 400) {
        layoutName = 'concentric';
        layoutOpts = {
          name: 'concentric',
          animate: false,
          concentric: (n: any) => n.data('degree') || 0,
          levelWidth: () => 2,
          minNodeSpacing: 15
        };
      }
      this.currentLayoutName = layoutName;

      this.cy.startBatch();
      this.cy.elements().remove();
      this.cy.add([...elements.nodes, ...elements.edges]);

      // Perf: hide edge labels on dense graphs
      if (elements.edges.length > 400) {
        this.cy.style()
          .selector('edge')
          .style({ 'label': '' } as any)
          .update();
      }
      this.cy.endBatch();

      if (isLarge && !opts.preservePositions) {
        new Notice(`Large graph (${dataset.quads.length.toLocaleString()} triples) — literals hidden, ${layoutName} layout. Use search & filters to explore.`, 6000);
      }

      if (opts.preservePositions && oldPositions.size > 0) {
        // Live edit: keep existing nodes in place, lay out only the new ones
        const newNodes = this.cy.nodes().filter((n: any) => !oldPositions.has(n.id()));
        this.cy.nodes().forEach((n: any) => {
          const pos = oldPositions.get(n.id());
          if (pos) n.position(pos);
        });
        if (newNodes.length > 0) {
          // Place new nodes near the centroid of their neighbors
          newNodes.forEach((n: any) => {
            const placed = n.neighborhood('node').filter((m: any) => oldPositions.has(m.id()));
            if (placed.length > 0) {
              let sx = 0, sy = 0;
              placed.forEach((m: any) => { sx += m.position('x'); sy += m.position('y'); });
              n.position({
                x: sx / placed.length + (Math.random() - 0.5) * 80,
                y: sy / placed.length + (Math.random() - 0.5) * 80
              });
            }
          });
        }
        this.updateStatusBar();
      } else {
        // Full (re)load: run layout from scratch
        setTimeout(() => {
          if (!this.cy) return;
          this.cy.resize();
          this.cy.layout(layoutOpts).run();
          this.cy.fit(undefined, 30);
          this.updateStatusBar();
        }, 50);
      }
    }

    // Refresh the current alternative view if visible
    if (this.viewMode !== 'graph') {
      this.switchMode(this.viewMode);
    }
  }

  /**
   * Render an ontology alignment (two datasets side by side with mapping edges)
   */
  async loadAlignment(result: AlignmentResult, nameA: string, nameB: string) {
    this.currentDataset = result.merged;

    if (!this.cy) return;

    this.cy.startBatch();
    this.cy.elements().remove();
    this.cy.add([...result.nodes, ...result.edges]);
    this.cy.endBatch();

    setTimeout(() => {
      if (!this.cy) return;
      this.cy.resize();
      
      // Side-by-side layout: position A nodes on left, B nodes on right
      const nodesA = this.cy.nodes('[graphSrc="A"]');
      const nodesB = this.cy.nodes('[graphSrc="B"]');
      const nodesBoth = this.cy.nodes('[graphSrc="both"]');
      
      // Calculate positions for side-by-side layout
      const width = this.graphContainer?.clientWidth || 800;
      const centerX = width / 2;
      const leftX = centerX * 0.3;
      const rightX = centerX * 1.7;
      
      // Position A nodes on the left side
      nodesA.positions((node: any) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 150 + Math.random() * 100;
        return {
          x: leftX + Math.cos(angle) * radius,
          y: 300 + Math.sin(angle) * radius
        };
      });
      
      // Position B nodes on the right side
      nodesB.positions((node: any) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 150 + Math.random() * 100;
        return {
          x: rightX + Math.cos(angle) * radius,
          y: 300 + Math.sin(angle) * radius
        };
      });
      
      // Position shared nodes in the center
      nodesBoth.positions((node: any) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 80 + Math.random() * 50;
        return {
          x: centerX + Math.cos(angle) * radius,
          y: 300 + Math.sin(angle) * radius
        };
      });
      
      // Run a gentle layout to refine positions while preserving side-by-side structure
      this.cy.layout({
        name: 'cose',
        animate: false,
        numIter: 300,
        nodeRepulsion: 1000,
        idealEdgeLength: 80,
        randomize: false
      } as any).run();
      
      this.cy.fit(undefined, 30);

      const s = result.stats;
      if (this.statusBar) {
        this.statusBar.setText(
          `Alignment ${nameA} ↔ ${nameB} · ${s.termsA}/${s.termsB} terms · ${s.shared} shared URIs · ${s.explicit} explicit mappings · ${s.suggested} label suggestions`
        );
      }
      
      // Add legend for alignment view
      this.renderAlignmentLegend(nameA, nameB);
    }, 50);

    new Notice(
      `Alignment: ${result.stats.shared} shared · ${result.stats.explicit} explicit · ${result.stats.suggested} suggested matches`
    );
  }

  /**
   * Render a legend for the alignment view showing the color coding
   */
  private renderAlignmentLegend(nameA: string, nameB: string) {
    if (!this.graphContainer) return;
    
    // Remove existing alignment legend if present
    const existing = this.graphContainer.querySelector('.rdf-alignment-legend');
    if (existing) existing.remove();
    
    const legend = this.graphContainer.createDiv('rdf-alignment-legend');
    legend.createEl('div', { text: `${nameA} (left)`, cls: 'rdf-alignment-legend-item rdf-alignment-legend-a' });
    legend.createEl('div', { text: `${nameB} (right)`, cls: 'rdf-alignment-legend-item rdf-alignment-legend-b' });
    legend.createEl('div', { text: 'Shared (center)', cls: 'rdf-alignment-legend-item rdf-alignment-legend-both' });
    legend.createEl('div', { text: '— Explicit mapping', cls: 'rdf-alignment-legend-item rdf-alignment-legend-explicit' });
    legend.createEl('div', { text: '⋯ Suggested match', cls: 'rdf-alignment-legend-item rdf-alignment-legend-suggested' });
  }

  setLayout(layoutName: string) {
    if (this.cy) {
      this.currentLayoutName = layoutName;
      const opts: any = { name: layoutName, animate: false };
      if (layoutName === 'concentric') {
        opts.concentric = (n: any) => n.data('degree') || 0;
        opts.levelWidth = () => 2;
        opts.minNodeSpacing = 15;
      }
      if (layoutName === 'cose') {
        opts.numIter = 400;
      }
      this.cy.layout(opts).run();
      this.updateStatusBar();
    }
  }

  filterByType(nodeType: string, visible: boolean) {
    if (this.cy) {
      this.cy.nodes(`[nodeType="${nodeType}"]`).style('display', visible ? 'element' : 'none');
    }
  }

  fitGraph() {
    if (this.cy) {
      this.cy.fit();
    }
  }

  getCy(): Core | null {
    return this.cy;
  }
}
