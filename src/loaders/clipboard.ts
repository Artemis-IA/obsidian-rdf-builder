import { RDFDataset, RDFParser } from '../rdf/parser';

export class ClipboardLoader {
  private parser: RDFParser;

  constructor() {
    this.parser = new RDFParser();
  }

  /**
   * Load RDF from clipboard content
   */
  async loadFromClipboard(content: string): Promise<RDFDataset> {
    try {
      return await this.parser.parse(content);
    } catch (error) {
      throw new Error(`Error parsing clipboard content: ${error}`);
    }
  }
}
