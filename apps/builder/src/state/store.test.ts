import type { Questionnaire } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { EditorStore, HISTORY_LIMIT } from './store.js';
import { createActions } from './actions.js';
import { flatten, getItem } from '../model/tree.js';
import { canonicalJson, exportJson, parseImport } from '../model/io.js';
import { createFormEngineSync, lintQuestionnaire } from '@qb/core';
import { resolveLayout, setLayoutColumns } from '@qb/extensions';

const blank = (): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  title: 'T',
  item: [],
});

describe('EditorStore', () => {
  it('undoes and redoes with selection restore', () => {
    const store = new EditorStore(blank());
    const a = createActions(store);
    const id = a.add('string', null)!;
    expect(store.getState().selected).toBe(id);
    a.update(id, (i) => ({ ...i, text: 'Name' }));
    expect(store.undo()).toBe('Edit item');
    expect(getItem(store.getState().questionnaire, [0])?.text).toBe('New question');
    store.undo();
    expect(store.getState().questionnaire.item).toEqual([]);
    expect(store.getState().selected).toBeNull();
    store.redo();
    store.redo();
    expect(getItem(store.getState().questionnaire, [0])?.text).toBe('Name');
    expect(store.getState().canRedo).toBe(false);
  });

  it('coalesces edits with the same merge key inside the window', () => {
    let now = 0;
    const store = new EditorStore(blank(), () => now);
    const a = createActions(store);
    const id = a.add('string', null)!;
    for (const t of ['N', 'Na', 'Nam', 'Name']) {
      now += 100;
      a.update(id, (i) => ({ ...i, text: t }), 'text');
    }
    store.undo();
    expect(getItem(store.getState().questionnaire, [0])?.text).toBe('New question');
    store.redo();
    now += 5000;
    a.update(id, (i) => ({ ...i, text: 'Names' }), 'text');
    store.undo();
    expect(getItem(store.getState().questionnaire, [0])?.text).toBe('Name');
  });

  it('caps history and ignores no-op edits', () => {
    const store = new EditorStore(blank());
    const a = createActions(store);
    const id = a.add('string', null)!;
    const rev = store.getState().revision;
    expect(a.update(id, (i) => ({ ...i }))).toBe(false);
    expect(store.getState().revision).toBe(rev);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) a.update(id, (it) => ({ ...it, text: `t${i}` }));
    let n = 0;
    while (store.undo()) n++;
    expect(n).toBe(HISTORY_LIMIT);
  });

  it('removes items and selects a neighbour; renames safely', () => {
    const store = new EditorStore(blank());
    const a = createActions(store);
    const x = a.add('boolean', null)!;
    const y = a.add('string', x)!;
    a.update(y, (i) => ({
      ...i,
      enableWhen: [{ question: x, operator: '=', answerBoolean: true }],
    }));
    expect(a.rename(x, 'has space')).toMatch(/without spaces/);
    expect(a.rename(x, y)).toMatch(/already used/);
    expect(a.rename(x, 'smoker')).toBeUndefined();
    expect(getItem(store.getState().questionnaire, [1])?.enableWhen?.[0]?.question).toBe('smoker');
    expect(a.remove('smoker')).toBe(y);
    expect(a.remove(y)).toBeNull();
  });

  it('exit criterion: author a 50-item form, export and re-import losslessly', () => {
    const store = new EditorStore(blank());
    const a = createActions(store);
    const types = [
      'string',
      'boolean',
      'choice',
      'integer',
      'date',
      'text',
      'decimal',
      'open-choice',
      'display',
    ] as const;
    let last: string | null = null;
    let group: string | undefined;
    let placeholder: string | undefined;
    for (let i = 0; i < 50; i++) {
      if (i % 10 === 0) {
        group = a.add('group', group ?? null)!;
        a.update(group, (it) => ({ ...it, text: `Section ${i / 10 + 1}`, repeats: i === 20 }));
        placeholder = store.getState().questionnaire.item!.find((g) => g.linkId === group)!
          .item![0]!.linkId;
        last = null;
      }
      const id = a.add(types[i % types.length]!, last ?? group!, last === null)!;
      a.update(id, (it) => {
        let next = { ...it, text: `Question ${i + 1} — ā ē ī ō ū` };
        if (it.type !== 'display' && i % 3 === 0) next.required = true;
        if (i % 4 === 0) next = setLayoutColumns(next, [{ breakpoint: 'md', span: 6 }]);
        return next;
      });
      if (types[i % types.length] === 'string' && i > 0) {
        const prevBool = flatten(store.getState().questionnaire).find(
          (f) => f.item.type === 'boolean',
        );
        if (prevBool)
          a.update(id, (it) => ({
            ...it,
            enableWhen: [{ question: prevBool.item.linkId, operator: '=', answerBoolean: true }],
          }));
      }
      if (i % 10 === 0) a.remove(placeholder!);
      last = id;
    }
    const q = store.getState().questionnaire;
    expect(flatten(q).filter((f) => f.item.type !== 'group')).toHaveLength(50);
    expect(
      lintQuestionnaire(q)
        .filter((i) => i.severity === 'error')
        .map((i) => `${i.code} ${i.linkId} ${i.message}`),
    ).toEqual([]);
    expect(() => createFormEngineSync(q)).not.toThrow();
    expect(
      resolveLayout(flatten(q).find((f) => f.item.text?.startsWith('Question 1 '))!.item).md.span,
    ).toBe(6);

    const reimported = parseImport(exportJson(q)).questionnaires[0]!;
    expect(canonicalJson(reimported)).toBe(canonicalJson(q));
    expect(exportJson(reimported)).toBe(exportJson(q));
  });
});
