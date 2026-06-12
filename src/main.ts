import { Plugin, WorkspaceLeaf, Notice, PluginSettingTab, Modal, App, TFile } from 'obsidian';
import { RDFGraphView, VIEW_TYPE_RDF, RDFFilePickerModal } from './views/RDFGraphView';
import { URILoader } from './loaders/uri-loader';
import { FileLoader } from './loaders/file-loader';
import { ClipboardLoader } from './loaders/clipboard';
import { SPARQLLoader } from './loaders/sparql-loader';
import { RDFViewerSettingTab, RDFViewerSettings, DEFAULT_SETTINGS } from './ui/settings';
import { TextInputModal, TextAreaModal, SPARQLModal, AlignSourceModal } from './ui/modals';
import { LOVSearchModal, LOVTermSearchModal, LOVVocab, LOVTerm } from './ui/lov';
import { computeAlignment } from './rdf/alignment';
import { RDFDataset } from './rdf/parser';

export default class RDFViewerPlugin extends Plugin {
  private uriLoader: URILoader;
  private fileLoader: FileLoader;
  private clipboardLoader: ClipboardLoader;
  private sparqlLoader: SPARQLLoader;
  settings: RDFViewerSettings;

  async onload() {
    console.log('Loading RDF Viewer Plugin');

    // Load settings
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Initialize loaders
    this.uriLoader = new URILoader();
    this.fileLoader = new FileLoader(this.app);
    this.clipboardLoader = new ClipboardLoader();
    this.sparqlLoader = new SPARQLLoader();

    // Register the RDF graph view
    this.registerView(
      VIEW_TYPE_RDF,
      (leaf) => new RDFGraphView(leaf)
    );

    // Register RDF file extensions → clicking a .ttl/.jsonld file opens the graph view
    try {
      this.registerExtensions(
        ['ttl', 'turtle', 'nt', 'ntriples', 'jsonld', 'rdf'],
        VIEW_TYPE_RDF
      );
    } catch (e) {
      console.warn('RDF Viewer: some extensions already registered by another plugin', e);
    }

    // Add ribbon icon ('network' is a valid lucide icon)
    this.addRibbonIcon('network', 'Open RDF Graph View', () => {
      this.activateView();
    });

    // Register commands
    this.addCommand({
      id: 'rdf-load-uri',
      name: 'Load RDF from URI',
      callback: () => this.loadFromURI()
    });

    this.addCommand({
      id: 'rdf-load-file',
      name: 'Load RDF from local file',
      callback: () => this.loadFromFile()
    });

    this.addCommand({
      id: 'rdf-load-clipboard',
      name: 'Load RDF from clipboard',
      callback: () => this.loadFromClipboard()
    });

    this.addCommand({
      id: 'rdf-toggle-view',
      name: 'Toggle RDF Graph View',
      callback: () => this.activateView()
    });

    this.addCommand({
      id: 'rdf-load-sparql',
      name: 'Load RDF from SPARQL endpoint',
      callback: () => this.loadFromSPARQL()
    });

    this.addCommand({
      id: 'rdf-export-mermaid',
      name: 'Export graph to Mermaid',
      callback: () => this.exportToMermaid()
    });

    this.addCommand({
      id: 'rdf-export-canvas',
      name: 'Export graph to Obsidian Canvas',
      callback: () => this.exportToCanvas()
    });

    this.addCommand({
      id: 'rdf-export-png',
      name: 'Export graph to PNG',
      callback: () => this.exportToPNG()
    });

    this.addCommand({
      id: 'rdf-search-lov',
      name: 'Search Linked Open Vocabularies (LOV)',
      callback: () => this.searchLOV()
    });

    this.addCommand({
      id: 'rdf-insert-lov-term',
      name: 'Insert term from LOV (classes & properties)',
      callback: () => this.insertLOVTerm()
    });

    this.addCommand({
      id: 'rdf-align',
      name: 'Align current ontology with another',
      callback: () => this.alignOntologies()
    });

    // Register settings tab
    this.addSettingTab(new RDFViewerSettingTab(this.app, this));
  }

  onunload() {
    console.log('Unloading RDF Viewer Plugin');
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_RDF);

    if (leaves.length > 0) {
      // Activate existing view
      leaf = leaves[0];
    } else {
      // Open in MAIN workspace area (full size, not the narrow sidebar)
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_RDF, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async loadFromURI() {
    const uri = await this.inputURI();
    if (!uri) return;

    try {
      new Notice('Loading RDF from URI...');
      const dataset = await this.uriLoader.loadFromURI(uri);
      
      const leaf = await this.getOrCreateView();
      if (leaf) {
        const view = leaf.view as RDFGraphView;
        await view.loadDataset(dataset);
      }
      
      new Notice('RDF loaded successfully');
    } catch (error) {
      new Notice(`Error loading RDF: ${error}`);
      console.error(error);
    }
  }

  async loadFromFile() {
    const files = await this.fileLoader.findTTLFiles();
    if (files.length === 0) {
      new Notice('No .ttl/.rdf/.nt files found in vault');
      return;
    }

    // Show file picker modal
    const picker = new RDFFilePickerModal(this.app, files, async (file: TFile) => {
      try {
        new Notice('Loading RDF from file...');
        const dataset = await this.fileLoader.loadFromFile(file);

        const leaf = await this.getOrCreateView();
        if (leaf) {
          const view = leaf.view as RDFGraphView;
          await view.loadDataset(dataset);
        }

        new Notice('RDF loaded successfully');
      } catch (error) {
        new Notice(`Error loading RDF: ${error}`);
        console.error(error);
      }
    });
    picker.open();
  }

  async loadFromClipboard() {
    const content = await this.inputClipboard();
    if (!content) return;

    try {
      new Notice('Loading RDF from clipboard...');
      const dataset = await this.clipboardLoader.loadFromClipboard(content);
      
      const leaf = await this.getOrCreateView();
      if (leaf) {
        const view = leaf.view as RDFGraphView;
        await view.loadDataset(dataset);
      }
      
      new Notice('RDF loaded successfully');
    } catch (error) {
      new Notice(`Error loading RDF: ${error}`);
      console.error(error);
    }
  }

  /**
   * Search a class/property on LOV and insert it at the cursor
   * in the source editor (adds the @prefix if needed).
   */
  insertLOVTerm() {
    new LOVTermSearchModal(this.app, async (term: LOVTerm) => {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RDF)[0];
      const view = leaf?.view as RDFGraphView | undefined;

      // Derive prefix + namespace from the term
      const prefixedName = term.prefixedName || '';
      const prefix = term.vocabPrefix || prefixedName.split(':')[0] || '';
      const local = prefixedName.includes(':') ? prefixedName.split(':')[1] : '';
      let ns = '';
      if (local && term.uri.endsWith(local)) {
        ns = term.uri.slice(0, term.uri.length - local.length);
      }

      if (view && prefixedName) {
        const inserted = view.insertTerm(prefixedName, prefix, ns);
        if (inserted) {
          new Notice(`Inserted ${prefixedName}`);
          return;
        }
      }

      // Fallback: copy the full URI
      await navigator.clipboard.writeText(`<${term.uri}>`);
      new Notice(`No source editor open — <${term.uri}> copied to clipboard`);
    }).open();
  }

  /**
   * Align the currently loaded ontology with a second one
   * (from a vault file or a URI).
   */
  async alignOntologies() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RDF)[0];
    const view = leaf?.view as RDFGraphView | undefined;
    const dsA = view?.getCurrentDataset();

    if (!dsA) {
      new Notice('Load a first ontology in the RDF view, then run this command again');
      return;
    }

    const nameA = view?.file?.basename || 'current';

    const loadB = async (dsB: RDFDataset, nameB: string) => {
      try {
        const result = computeAlignment(dsA, dsB, nameA, nameB);
        const targetLeaf = await this.getOrCreateView();
        const targetView = targetLeaf.view as RDFGraphView;
        await targetView.loadAlignment(result, nameA, nameB);
      } catch (error) {
        new Notice(`Alignment error: ${error}`);
        console.error(error);
      }
    };

    // Choose the second ontology: vault file or URI
    new AlignSourceModal(this.app, async (choice) => {
      if (choice === 'file') {
        const files = await this.fileLoader.findTTLFiles();
        if (files.length === 0) {
          new Notice('No RDF files found in vault');
          return;
        }
        new RDFFilePickerModal(this.app, files, async (file: TFile) => {
          new Notice(`Loading ${file.name}...`);
          const dsB = await this.fileLoader.loadFromFile(file);
          await loadB(dsB, file.basename);
        }).open();
      } else if (choice === 'uri') {
        const uri = await this.inputURI();
        if (!uri) return;
        new Notice('Fetching ontology...');
        const dsB = await this.uriLoader.loadFromURI(uri);
        await loadB(dsB, uri.split('/').pop() || 'remote');
      } else if (choice === 'lov') {
        new LOVSearchModal(this.app, async (vocab: LOVVocab) => {
          new Notice(`Fetching ${vocab.prefix}...`);
          const dsB = await this.uriLoader.loadFromURI(vocab.uri);
          await loadB(dsB, vocab.prefix);
        }).open();
      }
    }).open();
  }

  searchLOV() {
    new LOVSearchModal(this.app, async (vocab: LOVVocab) => {
      try {
        new Notice(`Loading ${vocab.prefix || vocab.uri} from LOV...`);
        const dataset = await this.uriLoader.loadFromURI(vocab.uri);

        const leaf = await this.getOrCreateView();
        if (leaf) {
          const view = leaf.view as RDFGraphView;
          await view.loadDataset(dataset);
        }

        new Notice(`${vocab.prefix}: ${dataset.quads.length} triples loaded`);
      } catch (error) {
        new Notice(`Error loading vocabulary: ${error}`);
        console.error(error);
      }
    }).open();
  }

  async loadFromSPARQL() {
    new SPARQLModal(this.app, this.settings.defaultEndpoint, async (endpoint, query) => {
      if (!endpoint) return;

      try {
        new Notice('Loading RDF from SPARQL endpoint...');
        const dataset = await this.sparqlLoader.loadFromEndpoint(endpoint, query);

        const leaf = await this.getOrCreateView();
        if (leaf) {
          const view = leaf.view as RDFGraphView;
          await view.loadDataset(dataset);
        }

        new Notice(`RDF loaded: ${dataset.quads.length} triples`);
      } catch (error) {
        new Notice(`Error loading RDF: ${error}`);
        console.error(error);
      }
    }).open();
  }

  async exportToMermaid() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RDF)[0];
    if (!leaf) {
      new Notice('No RDF graph view open');
      return;
    }

    const view = leaf.view as RDFGraphView;
    const dataset = view.getCurrentDataset();
    
    if (!dataset) {
      new Notice('No dataset loaded');
      return;
    }

    const { MermaidExporter } = await import('./exporters/mermaid');
    const exporter = new MermaidExporter();
    const mermaid = exporter.exportToMermaid(dataset, {
      includeTBox: this.settings.defaultIncludeTBox,
      includeABox: this.settings.defaultIncludeABox,
      includeLiterals: this.settings.defaultIncludeLiterals
    });

    // Create new note with Mermaid code
    const note = await this.app.vault.create('RDF Graph Mermaid.md', mermaid);
    await this.app.workspace.openLinkText(note.path, '', true);
    new Notice('Mermaid export created');
  }

  async exportToCanvas() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RDF)[0];
    if (!leaf) {
      new Notice('No RDF graph view open');
      return;
    }

    const view = leaf.view as RDFGraphView;
    const dataset = view.getCurrentDataset();
    
    if (!dataset) {
      new Notice('No dataset loaded');
      return;
    }

    const { CanvasExporter } = await import('./exporters/canvas');
    const exporter = new CanvasExporter();
    const canvasData = exporter.exportToCanvasFile(dataset, {
      includeTBox: this.settings.defaultIncludeTBox,
      includeABox: this.settings.defaultIncludeABox,
      includeLiterals: this.settings.defaultIncludeLiterals
    });

    // Create new canvas file
    const canvasFile = await this.app.vault.create('RDF Graph.canvas', canvasData);
    await this.app.workspace.openLinkText(canvasFile.path, '', true);
    new Notice('Canvas export created');
  }

  async exportToPNG() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RDF)[0];
    if (!leaf) {
      new Notice('No RDF graph view open');
      return;
    }

    const view = leaf.view as RDFGraphView;
    const { PNGExporter } = await import('./exporters/png');
    const exporter = new PNGExporter();
    exporter.downloadPNG(view.getCy(), 'rdf-graph.png');
    new Notice('PNG export created');
  }

  private async getOrCreateView(): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_RDF);

    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }

    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_RDF, active: true });
    workspace.revealLeaf(leaf);
    return leaf;
  }

  private async inputURI(): Promise<string | null> {
    return new Promise(resolve => {
      new TextInputModal(
        this.app,
        'Load RDF from URI',
        'https://www.w3.org/2009/08/skos-reference/skos.rdf',
        resolve
      ).open();
    });
  }

  private async inputClipboard(): Promise<string | null> {
    return new Promise(resolve => {
      new TextAreaModal(
        this.app,
        'Paste RDF content',
        '@prefix ex: <http://example.org/> .\nex:Alice a ex:Person .',
        resolve
      ).open();
    });
  }
}
