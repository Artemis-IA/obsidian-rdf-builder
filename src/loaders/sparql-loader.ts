import { requestUrl } from 'obsidian';
import { RDFDataset, RDFParser } from '../rdf/parser';

export class SPARQLLoader {
  private parser: RDFParser;

  constructor() {
    this.parser = new RDFParser();
  }

  /**
   * Load RDF from a SPARQL endpoint using CONSTRUCT query
   */
  async loadFromEndpoint(endpoint: string, query?: string): Promise<RDFDataset> {
    try {
      // Default CONSTRUCT query to get all triples
      const defaultQuery = `
        CONSTRUCT {
          ?s ?p ?o
        }
        WHERE {
          ?s ?p ?o
        }
        LIMIT 10000
      `;

      const sparqlQuery = query || defaultQuery;

      const response = await requestUrl({
        url: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          'Accept': 'text/turtle'
        },
        body: sparqlQuery,
        throw: false
      });

      if (response.status >= 400) {
        // Some endpoints only accept GET — retry
        return await this.loadFromEndpointGET(endpoint, query);
      }

      const turtleContent = response.text;
      return await this.parser.parse(turtleContent);
    } catch (error) {
      throw new Error(`Error loading from SPARQL endpoint: ${error}`);
    }
  }

  /**
   * Load RDF from a SPARQL endpoint using GET request
   */
  async loadFromEndpointGET(endpoint: string, query?: string): Promise<RDFDataset> {
    try {
      const defaultQuery = `
        CONSTRUCT {
          ?s ?p ?o
        }
        WHERE {
          ?s ?p ?o
        }
        LIMIT 10000
      `;

      const sparqlQuery = encodeURIComponent(query || defaultQuery);
      const url = `${endpoint}?query=${sparqlQuery}`;

      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        },
        throw: false
      });

      if (response.status >= 400) {
        throw new Error(`SPARQL endpoint error: HTTP ${response.status}`);
      }

      const turtleContent = response.text;
      return await this.parser.parse(turtleContent);
    } catch (error) {
      throw new Error(`Error loading from SPARQL endpoint: ${error}`);
    }
  }

  /**
   * Test if a SPARQL endpoint is accessible
   */
  async testEndpoint(endpoint: string): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: endpoint,
        method: 'GET',
        headers: {
          'Accept': 'application/sparql-results+json'
        },
        throw: false
      });
      return response.status < 400;
    } catch {
      return false;
    }
  }
}
