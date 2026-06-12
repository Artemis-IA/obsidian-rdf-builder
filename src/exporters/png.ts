import { Core } from 'cytoscape';

export class PNGExporter {
  /**
   * Export Cytoscape graph to PNG
   */
  exportToPNG(cy: Core, options: {
    scale?: number;
    full?: boolean;
    bg?: string;
  } = {}): string {
    const { scale = 1, full = true, bg = 'white' } = options;
    
    const png = cy.png({
      scale,
      full,
      bg
    });
    
    return png;
  }

  /**
   * Download PNG
   */
  downloadPNG(cy: Core, filename: string = 'rdf-graph.png', options: any = {}): void {
    const png = this.exportToPNG(cy, options);
    
    const link = document.createElement('a');
    link.href = png;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
