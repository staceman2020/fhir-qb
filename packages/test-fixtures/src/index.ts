import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import allTypes from '../questionnaires/all-types.json' with { type: 'json' };
import channelContent from '../questionnaires/channel-content.json' with { type: 'json' };
import enableWhen from '../questionnaires/enable-when.json' with { type: 'json' };
import layoutGrid from '../questionnaires/layout-grid.json' with { type: 'json' };
import nzPatient from '../questionnaires/nz-patient.json' with { type: 'json' };
import repeats from '../questionnaires/repeats.json' with { type: 'json' };

/** Returns a deep copy so tests cannot mutate shared fixtures. */
const q =
  (json: unknown): (() => Questionnaire) =>
  () =>
    JSON.parse(JSON.stringify(json)) as Questionnaire;

export const fixtures = {
  allTypes: q(allTypes),
  enableWhen: q(enableWhen),
  repeats: q(repeats),
  layoutGrid: q(layoutGrid),
  channelContent: q(channelContent),
  nzPatient: q(nzPatient),
} as const;

export type FixtureName = keyof typeof fixtures;

/**
 * Synthetic stress form (plan §11.2): `count` items in groups of 10, every other item conditional
 * on the previous one.
 */
export function stressQuestionnaire(count = 1000): Questionnaire {
  const groups: QuestionnaireItem[] = [];
  for (let g = 0; g * 10 < count; g++) {
    const item: QuestionnaireItem[] = [];
    for (let i = 0; i < 10 && g * 10 + i < count; i++) {
      const n = g * 10 + i;
      const it: QuestionnaireItem = {
        linkId: `q${n}`,
        type: i % 2 ? 'string' : 'boolean',
        text: `Question ${n}`,
      };
      if (i % 2) it.enableWhen = [{ question: `q${n - 1}`, operator: '=', answerBoolean: true }];
      item.push(it);
    }
    groups.push({ linkId: `g${g}`, type: 'group', text: `Section ${g + 1}`, item });
  }
  return {
    resourceType: 'Questionnaire',
    status: 'draft',
    title: `Stress test (${count} items)`,
    item: groups,
  };
}
