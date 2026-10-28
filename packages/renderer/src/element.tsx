import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Bundle, FhirResource, Questionnaire, QuestionnaireResponse } from 'fhir/r4';
import {
  LruCache,
  resolveTerminologyServer,
  TerminologyClient,
  createFormEngine,
  type FetchLike,
  type FhirClientAdapter,
  type FormEngine,
  type ResponseOptions,
  type ValidationIssue,
} from '@qb/core';
import { QuestionnaireForm, type QuestionnaireFormHandle } from './components/QuestionnaireForm.js';
import { buildStyles } from './styles.js';
import { isBreakpoint } from '@qb/extensions';
import { loadPdf } from './pdf.js';

export interface ExportPdfOptions {
  /** Print the current answers (pre-filled) instead of a blank form. */
  prefilled?: boolean;
  pageSize?: 'A4' | 'Letter';
  /** Large print, 1–2. */
  fontScale?: number;
}

let sharedSheet: CSSStyleSheet | undefined;

/** Constructable stylesheet shared by all instances, with a <style> fallback (plan §7.2). */
function applyStyles(root: ShadowRoot) {
  try {
    if (!sharedSheet) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(buildStyles());
      sharedSheet = sheet;
    }
    root.adoptedStyleSheets = [sharedSheet];
    return;
  } catch {
    // Older engines / jsdom: fall back to a <style> element.
  }
  const style = document.createElement('style');
  style.textContent = buildStyles();
  root.prepend(style);
}

const ATTRS = [
  'terminology-server',
  'terminology-server-override',
  'print-breakpoint',
  'lang',
  'readonly',
  'disabled-display',
  'hide-submit',
  'hide-title',
] as const;

/**
 * `<qb-questionnaire>` (plan §7.1). Form-associated: inside a host <form> its value is the
 * serialised QuestionnaireResponse and its validity mirrors response validation.
 */
export class QbQuestionnaireElement extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ATTRS;

  #shadow: ShadowRoot;
  #internals: ElementInternals | undefined;
  #mount: HTMLDivElement;
  #root: Root | undefined;
  #formRef = createRef<QuestionnaireFormHandle>();
  #engine: FormEngine | undefined;
  #unsubscribe: (() => void) | undefined;
  #buildToken = 0;
  #changeQueued = false;

  #questionnaire: Questionnaire | undefined;
  #response: QuestionnaireResponse | undefined;
  launchContext: Record<string, FhirResource> | undefined;
  fhirClient: FhirClientAdapter | undefined;
  resolveCanonical: ((url: string) => Promise<FhirResource | undefined>) | undefined;
  #terminologyFetch: typeof fetch | undefined;
  #terminologyClient: TerminologyClient | undefined;
  /** One in-memory cache per element, kept across rebuilds (plan §6.9). */
  #terminologyCache = new LruCache();

  /** Optional fetch override for terminology calls, e.g. to route them through a host proxy (plan §7.6). */
  get terminologyFetch(): typeof fetch | undefined {
    return this.#terminologyFetch;
  }
  set terminologyFetch(f: typeof fetch | undefined) {
    this.#terminologyFetch = f;
    this.#terminologyClient = undefined;
    this.#render();
  }

  #client(): TerminologyClient | undefined {
    const f =
      this.#terminologyFetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!f) return undefined;
    this.#terminologyClient ??= new TerminologyClient(
      f as unknown as FetchLike,
      this.#terminologyCache,
    );
    return this.#terminologyClient;
  }

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: 'open' });
    try {
      const internals = this.attachInternals();
      // Form association is optional: skip it where ElementInternals is incomplete.
      this.#internals = typeof internals.setFormValue === 'function' ? internals : undefined;
    } catch {
      this.#internals = undefined;
    }
    applyStyles(this.#shadow);
    this.#mount = document.createElement('div');
    this.#shadow.append(this.#mount);
  }

  get questionnaire(): Questionnaire | undefined {
    return this.#questionnaire;
  }
  set questionnaire(q: Questionnaire | undefined) {
    this.#questionnaire = q;
    void this.#build(false);
  }

  get questionnaireResponse(): QuestionnaireResponse | undefined {
    return this.#engine ? this.#engine.getResponse() : this.#response;
  }
  set questionnaireResponse(qr: QuestionnaireResponse | undefined) {
    this.#response = qr;
    void this.#build(false);
  }

  /** The underlying engine, for advanced hosts. */
  get engine(): FormEngine | undefined {
    return this.#engine;
  }

  connectedCallback() {
    this.#root ??= createRoot(this.#mount);
    this.#render();
  }

  disconnectedCallback() {
    // Defer so a DOM move (disconnect + connect in one task) does not tear down React.
    queueMicrotask(() => {
      if (!this.isConnected && this.#root) {
        this.#root.unmount();
        this.#root = undefined;
      }
    });
  }

  attributeChangedCallback(
    name: (typeof ATTRS)[number],
    oldValue: string | null,
    newValue: string | null,
  ) {
    if (oldValue === newValue) return;
    if (name === 'terminology-server' || name === 'terminology-server-override')
      void this.#build(true);
    else this.#render();
  }

  formResetCallback() {
    this.reset();
  }

  getQuestionnaireResponse(opts?: ResponseOptions): QuestionnaireResponse | undefined {
    return this.#engine?.getResponse(opts);
  }

  validate(): ValidationIssue[] {
    if (!this.#engine) return [];
    return this.#formRef.current?.validate() ?? this.#engine.validate();
  }

  extract(): Promise<Bundle> {
    return this.#engine
      ? this.#engine.extract()
      : Promise.reject(new Error('No questionnaire loaded'));
  }

  /**
   * Printable PDF (plan §8): blank by default, or pre-filled with the current answers. Loads the
   * PDF converter on first use. External value sets with up to 30 codes print as options.
   */
  async exportPdf(opts: ExportPdfOptions = {}): Promise<Blob> {
    const engine = this.#engine;
    if (!engine) throw new Error('No questionnaire loaded');
    const { generatePdf } = await loadPdf();
    const client = this.#client();
    const bp = this.getAttribute('print-breakpoint');
    const bytes = await generatePdf(engine.questionnaire, {
      ...(opts.prefilled ? { response: engine.getResponse() } : {}),
      ...(this.launchContext ? { launchContext: this.launchContext } : {}),
      locale: this.lang || engine.questionnaire.language,
      pageSize: opts.pageSize ?? 'A4',
      fontScale: opts.fontScale ?? 1,
      ...(isBreakpoint(bp) ? { printBreakpoint: bp } : {}),
      resolveValueSet: async (url, item) => {
        const server = resolveTerminologyServer(
          engine.definitions,
          item.linkId,
          engine.options.terminology,
        );
        if (!client || !server) return undefined;
        const r = await client.expand(server, url, { count: 31 });
        return (r.total ?? r.codings.length) > 30 ? undefined : r.codings;
      },
    });
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  }

  reset() {
    this.#engine?.reset();
  }

  async #build(preserveAnswers: boolean) {
    const token = ++this.#buildToken;
    const q = this.#questionnaire;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    const previous = preserveAnswers ? this.#engine?.getResponse() : undefined;
    this.#engine = undefined;
    if (!q) {
      this.#render();
      return;
    }
    try {
      const terminology: { serverOverride?: string; defaultServer?: string } = {};
      const override = this.getAttribute('terminology-server-override');
      const server = this.getAttribute('terminology-server');
      if (override) terminology.serverOverride = override;
      if (server) terminology.defaultServer = server;
      const response = previous ?? this.#response;
      const engine = await createFormEngine(q, {
        ...(response ? { response } : {}),
        ...(this.launchContext ? { launchContext: this.launchContext } : {}),
        ...(this.fhirClient ? { fhirClient: this.fhirClient } : {}),
        ...(this.resolveCanonical ? { resolveCanonical: this.resolveCanonical } : {}),
        ...(this.lang ? { locale: this.lang } : {}),
        terminology,
      });
      if (token !== this.#buildToken) return;
      this.#engine = engine;
      this.#unsubscribe = engine.subscribe(() => this.#queueChange());
      this.#syncFormValue();
      this.#render();
      this.#emit('qb-ready', { questionnaire: q, issues: engine.loadIssues });
    } catch (error) {
      if (token !== this.#buildToken) return;
      this.#render();
      this.#emit('qb-error', { error });
    }
  }

  #queueChange() {
    if (this.#changeQueued) return;
    this.#changeQueued = true;
    queueMicrotask(() => {
      this.#changeQueued = false;
      if (!this.#engine) return;
      this.#syncFormValue();
      this.#emit('qb-change', { response: this.#engine.getResponse() });
    });
  }

  #syncFormValue() {
    const engine = this.#engine;
    if (!engine || !this.#internals) return;
    const snapshot = engine.getSnapshot();
    this.#internals.setFormValue(JSON.stringify(engine.getResponse()));
    const issues = (snapshot.issues ?? engine.collectIssues()).filter(
      (i) => i.severity === 'error',
    );
    if (issues.length) this.#internals.setValidity({ customError: true }, issues[0]!.message);
    else this.#internals.setValidity({});
  }

  #emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #render() {
    if (!this.#root) return;
    const engine = this.#engine;
    if (!engine) {
      this.#root.render(null);
      return;
    }
    const dd = this.getAttribute('disabled-display');
    this.#root.render(
      <QuestionnaireForm
        ref={this.#formRef}
        engine={engine}
        readOnly={this.hasAttribute('readonly')}
        disabledDisplay={dd === 'protected' ? 'protected' : 'hidden'}
        hideSubmit={this.hasAttribute('hide-submit')}
        hideTitle={this.hasAttribute('hide-title')}
        {...(this.#client() ? { terminologyClient: this.#client()! } : {})}
        {...(this.lang ? { lang: this.lang } : {})}
        onValidate={(issues) => this.#emit('qb-validate', { issues })}
        onSubmit={(response) => this.#emit('qb-submit', { response })}
      />,
    );
  }
}

/** Registers the element (idempotent). Hosts with naming rules can choose another tag. */
export function defineQbQuestionnaire(tagName = 'qb-questionnaire'): typeof QbQuestionnaireElement {
  const existing = customElements.get(tagName);
  if (existing) return existing as typeof QbQuestionnaireElement;
  // A subclass per tag: the same constructor cannot be registered under two names.
  const ctor =
    tagName === 'qb-questionnaire'
      ? QbQuestionnaireElement
      : class extends QbQuestionnaireElement {};
  customElements.define(tagName, ctor);
  return ctor;
}

declare global {
  interface HTMLElementTagNameMap {
    'qb-questionnaire': QbQuestionnaireElement;
  }
}
