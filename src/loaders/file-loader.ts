import { App, TFile } from 'obsidian';
import { RDFDataset, RDFParser } from '../rdf/parser';

export class FileLoader {
  private app: App;
  private parser: RDFParser;

  constructor(app: App) {
    this.app = app;
    this.parser = new RDFParser();
  }

  /**
   * Load RDF from a local file in the vault
   */
  async loadFromFile(file: TFile): Promise<RDFDataset> {
    try {
      const content = await this.app.vault.read(file);
      return await this.parser.parse(content);
    } catch (error) {
      throw new Error(`Error loading from file ${file.path}: ${error}`);
    }
  }

  /**
   * Load RDF from multiple local files
   */
  async loadFromFiles(files: TFile[]): Promise<RDFDataset> {
    const datasets = await Promise.all(
      files.map(file => this.loadFromFile(file))
    );

    // Merge datasets
    const mergedQuads = datasets.flatMap((d: RDFDataset) => d.quads);
    const mergedPrefixes: Record<string, string> = {};
    
    datasets.forEach((d: RDFDataset) => {
      Object.assign(mergedPrefixes, d.prefixes);
    });

    return {
      quads: mergedQuads,
      prefixes: mergedPrefixes
    };
  }

  /**
   * Find all .ttl files in the vault
   */
  async findTTLFiles(): Promise<TFile[]> {
    const files = this.app.vault.getFiles();
    const rdfExtensions = ['ttl', 'turtle', 'nt', 'ntriples', 'jsonld', 'rdf'];
    return files.filter(file => rdfExtensions.includes(file.extension));
  }
}
