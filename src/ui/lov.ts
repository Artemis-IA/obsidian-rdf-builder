import { App, SuggestModal, Notice, requestUrl } from 'obsidian';

export interface LOVVocab {
  prefix: string;
  uri: string;
  titles: string;
  descriptions: string;
}

export interface LOVTerm {
  uri: string;
  type: string;
  prefixedName: string;
  vocabPrefix: string;
  score: number;
}

const LOV_API = 'https://lov.linkeddata.es/dataset/lov/api/v2';

/**
 * Client for the Linked Open Vocabularies (LOV) API
 * https://lov.linkeddata.es/dataset/lov/api
 */
export class LOVClient {
  /**
   * Search vocabularies by keyword
   */
  async searchVocabularies(query: string): Promise<LOVVocab[]> {
    const response = await requestUrl({
      url: `${LOV_API}/vocabulary/search?q=${encodeURIComponent(query)}`,
      method: 'GET',
      throw: false
    });

    if (response.status >= 400) return [];

    const data = response.json;
    const results = data?.results || [];
    return results.map((r: any) => ({
      prefix: r.prefix?.[0] || r._source?.prefix || '',
      uri: r.uri?.[0] || r._source?.uri || r._id || '',
      titles: (r.titles || r['titles.en'] || []).join?.(' / ') || r._source?.titles?.[0]?.value || '',
      descriptions: ''
    })).filter((v: LOVVocab) => v.uri);
  }

  /**
   * Search terms (classes/properties) across all LOV vocabularies
   */
  async searchTerms(query: string, type?: 'class' | 'property'): Promise<LOVTerm[]> {
    let url = `${LOV_API}/term/search?q=${encodeURIComponent(query)}`;
    if (type) url += `&type=${type}`;

    const response = await requestUrl({ url, method: 'GET', throw: false });
    if (response.status >= 400) return [];

    const data = response.json;
    const results = data?.results || [];
    return results.map((r: any) => ({
      uri: r.uri?.[0] || r._id || '',
      type: r.type?.[0] || '',
      prefixedName: r.prefixedName?.[0] || '',
      vocabPrefix: r['vocabulary.prefix']?.[0] || '',
      score: r.score || 0
    })).filter((t: LOVTerm) => t.uri);
  }

  /**
   * Get vocabulary info (including the latest version download URL)
   */
  async getVocabularyInfo(prefixOrUri: string): Promise<any> {
    const response = await requestUrl({
      url: `${LOV_API}/vocabulary/info?vocab=${encodeURIComponent(prefixOrUri)}`,
      method: 'GET',
      throw: false
    });
    if (response.status >= 400) return null;
    return response.json;
  }
}

/**
 * Modal to search LOV TERMS (classes & properties) across all vocabularies.
 * Used to insert a term into the Turtle source being edited.
 */
export class LOVTermSearchModal extends SuggestModal<LOVTerm> {
  private client: LOVClient;
  private onChoose: (term: LOVTerm) => void;
  private searchTimer: number | null = null;

  constructor(app: App, onChoose: (term: LOVTerm) => void) {
    super(app);
    this.client = new LOVClient();
    this.onChoose = onChoose;
    this.setPlaceholder('Search LOV terms — classes & properties (e.g. "Person", "temperature")...');
    this.emptyStateText = 'Type at least 2 characters to search LOV terms';
  }

  async getSuggestions(query: string): Promise<LOVTerm[]> {
    if (query.length < 2) return [];

    return new Promise(resolve => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(async () => {
        try {
          resolve(await this.client.searchTerms(query));
        } catch (e) {
          console.error('LOV term search failed', e);
          resolve([]);
        }
      }, 350);
    });
  }

  renderSuggestion(term: LOVTerm, el: HTMLElement) {
    const wrap = el.createDiv({ cls: 'rdf-lov-suggestion' });
    const head = wrap.createDiv();
    head.createEl('strong', { text: term.prefixedName || term.uri });
    if (term.type) {
      const t = term.type.includes('class') || term.type.includes('Class') ? 'class' : 'property';
      head.createSpan({ text: `  [${t}]`, cls: 'rdf-lov-type' });
    }
    wrap.createDiv({ text: term.uri, cls: 'rdf-lov-uri' });
  }

  onChooseSuggestion(term: LOVTerm) {
    this.onChoose(term);
  }
}

/**
 * Modal to search LOV vocabularies and load one into the graph view
 */
export class LOVSearchModal extends SuggestModal<LOVVocab> {
  private client: LOVClient;
  private onChoose: (vocab: LOVVocab) => void;
  private searchTimer: number | null = null;
  private lastResults: LOVVocab[] = [];

  constructor(app: App, onChoose: (vocab: LOVVocab) => void) {
    super(app);
    this.client = new LOVClient();
    this.onChoose = onChoose;
    this.setPlaceholder('Search Linked Open Vocabularies (e.g. "ocean", "sensor", "foaf")...');
    this.emptyStateText = 'Type at least 2 characters to search LOV';
  }

  async getSuggestions(query: string): Promise<LOVVocab[]> {
    if (query.length < 2) return [];

    // Debounce LOV API calls
    return new Promise(resolve => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(async () => {
        try {
          this.lastResults = await this.client.searchVocabularies(query);
          resolve(this.lastResults);
        } catch (e) {
          console.error('LOV search failed', e);
          resolve([]);
        }
      }, 350);
    });
  }

  renderSuggestion(vocab: LOVVocab, el: HTMLElement) {
    const wrap = el.createDiv({ cls: 'rdf-lov-suggestion' });
    wrap.createEl('strong', { text: vocab.prefix || '(no prefix)' });
    if (vocab.titles) {
      wrap.createSpan({ text: ` — ${vocab.titles}`, cls: 'rdf-lov-title' });
    }
    wrap.createDiv({ text: vocab.uri, cls: 'rdf-lov-uri' });
  }

  onChooseSuggestion(vocab: LOVVocab) {
    this.onChoose(vocab);
  }
}
