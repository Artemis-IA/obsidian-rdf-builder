import { PluginSettingTab, App, Setting } from 'obsidian';

export interface RDFViewerSettings {
  defaultLayout: string;
  defaultIncludeTBox: boolean;
  defaultIncludeABox: boolean;
  defaultIncludeLiterals: boolean;
  defaultIncludeBlanks: boolean;
  nodeSize: number;
  edgeWidth: number;
  fontSize: number;
  showLabels: boolean;
  colorScheme: string;
  defaultEndpoint: string;
}

export const DEFAULT_SETTINGS: RDFViewerSettings = {
  defaultLayout: 'cose',
  defaultIncludeTBox: true,
  defaultIncludeABox: true,
  defaultIncludeLiterals: true,
  defaultIncludeBlanks: false,
  nodeSize: 30,
  edgeWidth: 2,
  fontSize: 12,
  showLabels: true,
  colorScheme: 'default',
  defaultEndpoint: ''
};

export class RDFViewerSettingTab extends PluginSettingTab {
  plugin: any; // Will be the plugin instance

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'RDF Graph Viewer Settings' });

    // Layout settings
    new Setting(containerEl)
      .setName('Default layout')
      .setDesc('Default graph layout algorithm')
      .addDropdown(dropdown => dropdown
        .addOption('cose', 'COSE (Compound Spring Embedder)')
        .addOption('dagre', 'Dagre (Directed)')
        .addOption('concentric', 'Concentric')
        .addOption('breadthfirst', 'Breadthfirst')
        .addOption('circle', 'Circle')
        .addOption('grid', 'Grid')
        .setValue(this.plugin.settings.defaultLayout)
        .onChange(async (value) => {
          this.plugin.settings.defaultLayout = value;
          await this.plugin.saveSettings();
        }));

    // TBox/ABox settings
    new Setting(containerEl)
      .setName('Include TBox by default')
      .setDesc('Include classes and properties (terminology)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultIncludeTBox)
        .onChange(async (value) => {
          this.plugin.settings.defaultIncludeTBox = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include ABox by default')
      .setDesc('Include instances and data (assertions)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultIncludeABox)
        .onChange(async (value) => {
          this.plugin.settings.defaultIncludeABox = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include literals by default')
      .setDesc('Include literal values in the graph')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultIncludeLiterals)
        .onChange(async (value) => {
          this.plugin.settings.defaultIncludeLiterals = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include blank nodes by default')
      .setDesc('Include blank nodes in the graph')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultIncludeBlanks)
        .onChange(async (value) => {
          this.plugin.settings.defaultIncludeBlanks = value;
          await this.plugin.saveSettings();
        }));

    // Visual settings
    new Setting(containerEl)
      .setName('Node size')
      .setDesc('Size of graph nodes in pixels')
      .addSlider(slider => slider
        .setLimits(10, 100, 5)
        .setValue(this.plugin.settings.nodeSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.nodeSize = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Edge width')
      .setDesc('Width of graph edges in pixels')
      .addSlider(slider => slider
        .setLimits(1, 10, 0.5)
        .setValue(this.plugin.settings.edgeWidth)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.edgeWidth = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Font size')
      .setDesc('Font size for labels in pixels')
      .addSlider(slider => slider
        .setLimits(8, 24, 1)
        .setValue(this.plugin.settings.fontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.fontSize = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show labels')
      .setDesc('Display node and edge labels')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showLabels)
        .onChange(async (value) => {
          this.plugin.settings.showLabels = value;
          await this.plugin.saveSettings();
        }));

    // Color scheme
    new Setting(containerEl)
      .setName('Color scheme')
      .setDesc('Color scheme for the graph')
      .addDropdown(dropdown => dropdown
        .addOption('default', 'Default (Blue/Green/Orange)')
        .addOption('dark', 'Dark Theme')
        .addOption('light', 'Light Theme')
        .addOption('pastel', 'Pastel')
        .setValue(this.plugin.settings.colorScheme)
        .onChange(async (value) => {
          this.plugin.settings.colorScheme = value;
          await this.plugin.saveSettings();
        }));

    // SPARQL endpoint
    new Setting(containerEl)
      .setName('Default SPARQL endpoint')
      .setDesc('Default SPARQL endpoint for loading RDF data')
      .addText(text => text
        .setPlaceholder('https://example.org/sparql')
        .setValue(this.plugin.settings.defaultEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.defaultEndpoint = value;
          await this.plugin.saveSettings();
        }));
  }
}
