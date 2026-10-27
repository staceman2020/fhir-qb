import { describe, expect, it } from 'vitest';
import { validateQuestionnaireExtensions } from '@qb/extensions';
import { fixtures, stressQuestionnaire } from './index.js';

describe('fixtures', () => {
  it.each(Object.entries(fixtures))(
    '%s is a Questionnaire with valid qb extensions',
    (_name, load) => {
      const q = load();
      expect(q.resourceType).toBe('Questionnaire');
      expect(validateQuestionnaireExtensions(q).filter((i) => i.severity === 'error')).toEqual([]);
    },
  );

  it('stress form has the requested number of questions', () => {
    const q = stressQuestionnaire(1000);
    expect(q.item?.flatMap((g) => g.item ?? []).length).toBe(1000);
  });
});
