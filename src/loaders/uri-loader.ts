import { requestUrl } from 'obsidian';
import { RDFDataset, RDFParser } from '../rdf/parser';

export class URILoader {
  private parser: RDFParser;

  constructor() {
    this.parser = new RDFParser();
  }

  /**
   * Normalize "web page" URLs into raw content URLs:
   * - github.com/.../blob/... → raw.githubusercontent.com/...
   * - gitlab.com/.../-/blob/... → .../-/raw/...
   */
  normalizeURL(uri: string): string {
    // GitHub blob page → raw content
    const ghMatch = uri.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (ghMatch) {
      return `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
    }

    // GitLab blob page → raw content
    const glMatch = uri.match(/^(https?:\/\/[^/]+\/.+)\/-\/blob\/(.+)$/);
    if (glMatch) {
      return `${glMatch[1]}/-/raw/${glMatch[2]}`;
    }

    return uri;
  }

  /**
   * Load RDF from a URI (HTTP/HTTPS).
   * Uses Obsidian requestUrl to bypass CORS, with RDF content negotiation.
   * Accepts both ontology URIs (w3id.org, purl.org) and direct file URLs (GitHub, etc.)
   */
  async loadFromURI(uri: string): Promise<RDFDataset> {
    try {
      const url = this.normalizeURL(uri.trim());

      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Accept': 'text/turtle, application/ld+json;q=0.9, application/n-triples;q=0.8, application/rdf+xml;q=0.5, */*;q=0.1'
        },
        throw: false
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`);
      }

      const content = response.text;
      return await this.parser.parse(content);
    } catch (error) {
      throw new Error(`Error loading from URI ${uri}: ${error}`);
    }
  }

  /**
   * Load RDF from multiple URIs
   */
  async loadFromURIs(uris: string[]): Promise<RDFDataset> {
    const datasets = await Promise.all(
      uris.map(uri => this.loadFromURI(uri))
    );

    // Merge datasets
    const mergedQuads = datasets.flatMap(d => d.quads);
    const mergedPrefixes: Record<string, string> = {};
    
    datasets.forEach(d => {
      Object.assign(mergedPrefixes, d.prefixes);
    });

    return {
      quads: mergedQuads,
      prefixes: mergedPrefixes
    };
  }
}
