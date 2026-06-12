import { App, Modal, Setting, TextAreaComponent } from 'obsidian';

/**
 * Generic text input modal (replaces window.prompt which is blocked in Obsidian)
 */
export class TextInputModal extends Modal {
  private result: string = '';
  private onSubmit: (result: string | null) => void;
  private title: string;
  private placeholder: string;
  private defaultValue: string;

  constructor(
    app: App,
    title: string,
    placeholder: string,
    onSubmit: (result: string | null) => void,
    defaultValue = ''
  ) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
    this.defaultValue = defaultValue;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });

    let inputEl: HTMLInputElement;
    new Setting(contentEl)
      .addText(text => {
        inputEl = text.inputEl;
        text.setPlaceholder(this.placeholder)
          .setValue(this.defaultValue)
          .onChange(value => {
            this.result = value;
          });
        text.inputEl.style.width = '100%';
        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.close();
            this.onSubmit(this.result || null);
          }
        });
      });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Load')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.result || null);
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
          this.onSubmit(null);
        }));

    // Focus input
    setTimeout(() => inputEl?.focus(), 10);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Multi-line text paste modal (for pasting Turtle / JSON-LD content)
 */
export class TextAreaModal extends Modal {
  private result: string = '';
  private onSubmit: (result: string | null) => void;
  private title: string;
  private placeholder: string;

  constructor(
    app: App,
    title: string,
    placeholder: string,
    onSubmit: (result: string | null) => void
  ) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });

    const textArea = new TextAreaComponent(contentEl);
    textArea.setPlaceholder(this.placeholder);
    textArea.inputEl.style.width = '100%';
    textArea.inputEl.style.height = '300px';
    textArea.inputEl.style.fontFamily = 'monospace';
    textArea.onChange(value => {
      this.result = value;
    });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Load')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.result || null);
        }))
      .addButton(btn => btn
        .setButtonText('Paste from clipboard')
        .onClick(async () => {
          try {
            const clip = await navigator.clipboard.readText();
            textArea.setValue(clip);
            this.result = clip;
          } catch (e) {
            console.error('Clipboard read failed', e);
          }
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
          this.onSubmit(null);
        }));

    setTimeout(() => textArea.inputEl.focus(), 10);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Choice modal for the second ontology source in an alignment
 */
export type AlignSourceChoice = 'file' | 'uri' | 'lov';

export class AlignSourceModal extends Modal {
  private onChoose: (choice: AlignSourceChoice) => void;

  constructor(app: App, onChoose: (choice: AlignSourceChoice) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Align with ontology from…' });
    contentEl.createEl('p', {
      text: 'Choose where to load the second ontology to compare against the current one.',
      cls: 'setting-item-description'
    });

    const choices: [AlignSourceChoice, string, string][] = [
      ['file', 'Vault file', 'Pick a .ttl/.jsonld file from your vault'],
      ['uri', 'URI / URL', 'Fetch from a web URI (w3id, purl, GitHub...)'],
      ['lov', 'LOV catalog', 'Search Linked Open Vocabularies']
    ];

    for (const [choice, label, desc] of choices) {
      new Setting(contentEl)
        .setName(label)
        .setDesc(desc)
        .addButton(btn => btn
          .setButtonText('Select')
          .setCta()
          .onClick(() => {
            this.close();
            this.onChoose(choice);
          }));
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * SPARQL endpoint modal with query editing
 */
export class SPARQLModal extends Modal {
  private endpoint: string = '';
  private query: string = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 500';
  private onSubmit: (endpoint: string | null, query: string) => void;

  constructor(
    app: App,
    defaultEndpoint: string,
    onSubmit: (endpoint: string | null, query: string) => void
  ) {
    super(app);
    this.endpoint = defaultEndpoint;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Load from SPARQL endpoint' });

    new Setting(contentEl)
      .setName('Endpoint URL')
      .addText(text => {
        text.setPlaceholder('https://dbpedia.org/sparql')
          .setValue(this.endpoint)
          .onChange(value => {
            this.endpoint = value;
          });
        text.inputEl.style.width = '100%';
      });

    contentEl.createEl('p', { text: 'CONSTRUCT query:', cls: 'setting-item-name' });
    const textArea = new TextAreaComponent(contentEl);
    textArea.setValue(this.query);
    textArea.inputEl.style.width = '100%';
    textArea.inputEl.style.height = '150px';
    textArea.inputEl.style.fontFamily = 'monospace';
    textArea.onChange(value => {
      this.query = value;
    });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Execute & Load')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.endpoint || null, this.query);
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
          this.onSubmit(null, this.query);
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
