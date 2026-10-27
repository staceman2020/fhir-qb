import { produce } from 'immer';
import type { Questionnaire } from 'fhir/r4';
import { fixtures } from '@qb/test-fixtures';
import { STD_EXT, QB_EXT, setRenderChannel } from '@qb/extensions';
import { describe, expect, it } from 'vitest';
import {
  flatten,
  findPath,
  getItem,
  indentItem,
  insertItem,
  moveItem,
  outdentItem,
  removeItem,
} from './tree.js';
import { allLinkIds, cloneWithNewLinkIds, generateLinkId, renameLinkId } from './linkIds.js';
import { changeType, getRichText, helpChildIndex, setHelpText, setRichText } from './items.js';
import { canonicalJson, parseImport, stripQbExtensions, exportJson } from './io.js';

const q = (): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  item: [
    { linkId: 'a', type: 'string' },
    {
      linkId: 'g',
      type: 'group',
      item: [
        { linkId: 'g1', type: 'boolean' },
        {
          linkId: 'g2',
          type: 'string',
          enableWhen: [{ question: 'g1', operator: '=', answerBoolean: true }],
        },
      ],
    },
    { linkId: 'd', type: 'display' },
  ],
});

const ids = (x: Questionnaire) => flatten(x).map((f) => `${'  '.repeat(f.depth)}${f.item.linkId}`);

describe('tree ops', () => {
  it('finds, inserts and removes', () => {
    const x = q();
    expect(findPath(x, 'g2')).toEqual([1, 1]);
    expect(getItem(x, [1, 0])?.linkId).toBe('g1');
    const y = produce(x, (d) => {
      insertItem(d, [1], 1, { linkId: 'new', type: 'string' });
      removeItem(d, [0]);
    });
    expect(ids(y)).toEqual(['g', '  g1', '  new', '  g2', 'd']);
    expect(x.item).toHaveLength(3);
  });

  it('removes the empty child array when the last child is removed', () => {
    const y = produce(q(), (d) => {
      removeItem(d, [1, 0]);
      removeItem(d, [1, 0]);
    });
    expect(getItem(y, [1])?.item).toBeUndefined();
  });

  it('moves, indents and outdents', () => {
    let x = produce(q(), (d) => void moveItem(d, [0], 1));
    expect(ids(x)).toEqual(['g', '  g1', '  g2', 'a', 'd']);
    expect(produce(x, (d) => void moveItem(d, [0], -1))).toBe(x);
    x = produce(x, (d) => void indentItem(d, [1]));
    expect(ids(x)).toEqual(['g', '  g1', '  g2', '  a', 'd']);
    x = produce(x, (d) => void outdentItem(d, [0, 0]));
    expect(ids(x)).toEqual(['g', '  g2', '  a', 'g1', 'd']);
  });

  it('refuses to indent into a display item', () => {
    const x = q();
    x.item!.push({ linkId: 'z', type: 'string' });
    expect(produce(x, (d) => void indentItem(d, [3]))).toBe(x);
  });
});

describe('linkIds', () => {
  it('generates unique ids', () => {
    const taken = new Set(['item-1', 'item-2']);
    expect(generateLinkId(taken)).toBe('item-3');
    expect(generateLinkId(taken)).toBe('item-4');
    expect(generateLinkId(new Set(), 'My Q!')).toBe('My-Q-1');
  });

  it('renames with enableWhen references', () => {
    const y = produce(q(), (d) => void renameLinkId(d, 'g1', 'smoker'));
    expect(getItem(y, [1, 0])?.linkId).toBe('smoker');
    expect(getItem(y, [1, 1])?.enableWhen?.[0]?.question).toBe('smoker');
  });

  it('clones with fresh ids and rewrites internal references only', () => {
    const x = q();
    const copy = cloneWithNewLinkIds(x.item![1]!, allLinkIds(x));
    expect(copy.linkId).toBe('g-1');
    expect(copy.item?.map((i) => i.linkId)).toEqual(['g1-1', 'g2-1']);
    expect(copy.item?.[1]?.enableWhen?.[0]?.question).toBe('g1-1');
    expect(x.item![1]!.item![1]!.enableWhen![0]!.question).toBe('g1');
  });
});

describe('item helpers', () => {
  it('cleans up invalid elements when the type changes', () => {
    const choice = {
      linkId: 'c',
      type: 'choice' as const,
      answerOption: [{ valueString: 'x' }],
      maxLength: 3,
      required: true,
      extension: [
        { url: STD_EXT.itemControl, valueCodeableConcept: { coding: [{ code: 'drop-down' }] } },
      ],
    };
    const asDisplay = changeType(choice, 'display');
    expect(asDisplay).toEqual({ linkId: 'c', type: 'display' });
    expect(changeType({ linkId: 'x', type: 'string' }, 'group').item).toHaveLength(1);
  });

  it('manages help text as a child display item', () => {
    let it2 = setHelpText({ linkId: 'q', type: 'string' }, 'Some help', () => 'q-help');
    expect(it2.item?.[0]).toMatchObject({ linkId: 'q-help', type: 'display', text: 'Some help' });
    expect(helpChildIndex(it2)).toBe(0);
    it2 = setHelpText(it2, 'Changed', () => 'unused');
    expect(it2.item).toHaveLength(1);
    expect(it2.item?.[0]?.text).toBe('Changed');
    expect(setHelpText(it2, '', () => '').item).toBeUndefined();
  });

  it('stores rich text in _text with a plain fallback', () => {
    let it2 = setRichText({ linkId: 'q', type: 'display' }, '<p><b>Hi</b></p>', 'Hi');
    expect(it2.text).toBe('Hi');
    expect(getRichText(it2)).toBe('<p><b>Hi</b></p>');
    it2 = setRichText(it2, undefined, 'Hi');
    expect(it2._text).toBeUndefined();
  });
});

describe('import / export', () => {
  it('round-trips every fixture losslessly', () => {
    for (const load of Object.values(fixtures)) {
      const original = load();
      const { questionnaires, errors } = parseImport(exportJson(original));
      expect(errors).toEqual([]);
      expect(canonicalJson(questionnaires[0])).toBe(canonicalJson(original));
    }
  });

  it('accepts Bundles and rejects invalid input with reasons', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: fixtures.repeats() }, { resource: { resourceType: 'Patient' } }],
    };
    expect(parseImport(JSON.stringify(bundle)).questionnaires).toHaveLength(1);
    expect(parseImport('{').errors[0]).toMatch(/not valid JSON/);
    expect(parseImport('{"resourceType":"Patient"}').errors[0]).toMatch(/not a FHIR Questionnaire/);
    expect(
      parseImport(
        JSON.stringify({
          resourceType: 'Questionnaire',
          status: 'draft',
          item: [{ type: 'string' }],
        }),
      ).errors,
    ).toEqual(['Questionnaire.item[0] has no linkId.']);
    expect(parseImport(JSON.stringify({ lformsVersion: '30', items: [] })).errors[0]).toMatch(
      /LHC-Forms/,
    );
  });

  it('strips qb extensions but keeps hidden for pdf-only items', () => {
    const x = fixtures.channelContent();
    const stripped = stripQbExtensions(x);
    expect(JSON.stringify(stripped)).not.toContain(QB_EXT.renderChannel);
    expect(stripped.item?.[0]?.extension?.some((e) => e.url === STD_EXT.hidden)).toBe(true);
    const web = setRenderChannel({ linkId: 'w', type: 'display' }, 'web');
    expect(stripQbExtensions(web).extension).toBeUndefined();
  });

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }),
    );
  });
});
