import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { Questionnaire } from 'fhir/r4';

enablePatches();

export const HISTORY_LIMIT = 200;
/** Edits with the same merge key within this window become one undo step (e.g. typing in a field). */
export const MERGE_WINDOW_MS = 1500;

interface HistoryEntry {
  forward: Patch[];
  inverse: Patch[];
  label: string;
  mergeKey: string | undefined;
  at: number;
  /** Selection before the change, restored on undo. */
  selection: string | null;
}

export interface EditorState {
  questionnaire: Questionnaire;
  /** Selected item linkId; null = form settings. */
  selected: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Increments on every questionnaire change (drives autosave). */
  revision: number;
}

export interface ApplyOptions {
  label?: string;
  mergeKey?: string;
  /** Selection after the change. */
  select?: string | null;
}

/**
 * Editor state: the Questionnaire JSON (source of truth, ADR-005), selection and undo history as
 * Immer patches. A tiny external store for useSyncExternalStore.
 */
export class EditorStore {
  #state: EditorState;
  #past: HistoryEntry[] = [];
  #future: HistoryEntry[] = [];
  #listeners = new Set<() => void>();
  #now: () => number;

  constructor(questionnaire: Questionnaire, now: () => number = Date.now) {
    this.#state = { questionnaire, selected: null, canUndo: false, canRedo: false, revision: 0 };
    this.#now = now;
  }

  getState = (): EditorState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(patch: Partial<EditorState>) {
    this.#state = {
      ...this.#state,
      ...patch,
      canUndo: this.#past.length > 0,
      canRedo: this.#future.length > 0,
    };
    for (const l of [...this.#listeners]) l();
  }

  select(linkId: string | null) {
    if (linkId !== this.#state.selected) this.#set({ selected: linkId });
  }

  /** Applies a recipe to the Questionnaire. Returns false if nothing changed. */
  apply(recipe: (draft: Draft<Questionnaire>) => void, opts: ApplyOptions = {}): boolean {
    const [next, forward, inverse] = produceWithPatches(this.#state.questionnaire, recipe);
    if (!forward.length) {
      if (opts.select !== undefined) this.select(opts.select);
      return false;
    }
    const now = this.#now();
    const last = this.#past[this.#past.length - 1];
    if (
      opts.mergeKey &&
      last &&
      last.mergeKey === opts.mergeKey &&
      now - last.at < MERGE_WINDOW_MS
    ) {
      last.forward = [...last.forward, ...forward];
      last.inverse = [...inverse, ...last.inverse];
      last.at = now;
    } else {
      this.#past.push({
        forward,
        inverse,
        label: opts.label ?? 'Edit',
        mergeKey: opts.mergeKey,
        at: now,
        selection: this.#state.selected,
      });
      if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
    }
    this.#future = [];
    this.#set({
      questionnaire: next,
      revision: this.#state.revision + 1,
      ...(opts.select !== undefined ? { selected: opts.select } : {}),
    });
    return true;
  }

  /** Replaces the whole Questionnaire (e.g. restoring a version) as one undoable step. */
  replace(questionnaire: Questionnaire, label = 'Replace form') {
    this.apply(() => questionnaire as Draft<Questionnaire>, { label, select: null });
  }

  undo(): string | undefined {
    const entry = this.#past.pop();
    if (!entry) return undefined;
    this.#future.push(entry);
    this.#set({
      questionnaire: applyPatches(this.#state.questionnaire, entry.inverse),
      selected: entry.selection,
      revision: this.#state.revision + 1,
    });
    return entry.label;
  }

  redo(): string | undefined {
    const entry = this.#future.pop();
    if (!entry) return undefined;
    this.#past.push({ ...entry, mergeKey: undefined });
    this.#set({
      questionnaire: applyPatches(this.#state.questionnaire, entry.forward),
      revision: this.#state.revision + 1,
    });
    return entry.label;
  }

  /** Breaks merging so the next edit starts a new undo step (e.g. on field blur). */
  sealHistory() {
    const last = this.#past[this.#past.length - 1];
    if (last) last.mergeKey = undefined;
  }
}
