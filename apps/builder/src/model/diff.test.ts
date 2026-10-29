import type { Questionnaire } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { diffQuestionnaires } from './diff.js';

const before: Questionnaire = {
  resourceType: 'Questionnaire',
  status: 'draft',
  title: 'Intake',
  item: [
    { linkId: 'a', type: 'string', text: 'Name' },
    { linkId: 'b', type: 'choice', text: 'Colour', answerOption: [{ valueString: 'Red' }] },
    {
      linkId: 'g',
      type: 'group',
      text: 'Group',
      item: [{ linkId: 'c', type: 'boolean', text: 'Smoker' }],
    },
    { linkId: 'gone', type: 'string', text: 'Old question' },
  ],
};

describe('diffQuestionnaires', () => {
  it('reports form, added, removed, changed and moved items', () => {
    const after: Questionnaire = {
      ...before,
      title: 'Clinic intake',
      status: 'active',
      item: [
        {
          linkId: 'b',
          type: 'choice',
          text: 'Favourite colour',
          required: true,
          answerOption: [{ valueString: 'Red' }, { valueString: 'Blue' }],
        },
        { linkId: 'a', type: 'string', text: 'Name' },
        { linkId: 'g', type: 'group', text: 'Group', item: [] },
        { linkId: 'c', type: 'boolean', text: 'Smoker' },
        { linkId: 'new', type: 'date', text: 'Date of birth' },
      ],
    };
    const d = diffQuestionnaires(before, after);
    expect(d.form).toEqual([
      { field: 'Status', before: 'draft', after: 'active' },
      { field: 'Title', before: 'Intake', after: 'Clinic intake' },
    ]);
    const by = (kind: string) =>
      d.items
        .filter((i) => i.kind === kind)
        .map((i) => i.linkId)
        .sort();
    expect(by('added')).toEqual(['new']);
    expect(by('removed')).toEqual(['gone']);
    expect(by('changed')).toEqual(['b']);
    expect(by('moved')).toEqual(['a', 'b', 'c']);
    expect(d.items.find((i) => i.kind === 'changed')!.changes).toEqual([
      { field: 'Text', before: 'Colour', after: 'Favourite colour' },
      { field: 'Answer options', before: 'Red', after: 'Red, Blue' },
      { field: 'Required', before: '—', after: 'true' },
    ]);
  });

  it('finds no differences between identical forms', () => {
    expect(diffQuestionnaires(before, structuredClone(before))).toEqual({ form: [], items: [] });
  });
});
