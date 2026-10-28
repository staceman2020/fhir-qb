import type { Extension, Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { STD_EXT, getExtension, replaceExtensions } from '@qb/extensions';

export interface LaunchContextRow {
  name: string;
  type: string;
  description: string;
}

/** SDC launch context names (http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext). */
export const LAUNCH_CONTEXT_NAMES = ['patient', 'encounter', 'location', 'user', 'study'];
export const LAUNCH_CONTEXT_TYPES = [
  'Patient',
  'Encounter',
  'Location',
  'Practitioner',
  'PractitionerRole',
  'RelatedPerson',
  'ResearchStudy',
];

export function getLaunchContexts(q: Questionnaire): LaunchContextRow[] {
  return (q.extension ?? [])
    .filter((e) => e.url === STD_EXT.launchContext)
    .map((e) => {
      const sub = (url: string) => e.extension?.find((x) => x.url === url);
      return {
        name: sub('name')?.valueCoding?.code ?? sub('name')?.valueId ?? '',
        type: sub('type')?.valueCode ?? '',
        description: sub('description')?.valueString ?? '',
      };
    });
}

export function setLaunchContexts(q: Questionnaire, rows: LaunchContextRow[]): Questionnaire {
  const exts: Extension[] = rows.map((r) => ({
    url: STD_EXT.launchContext,
    extension: [
      {
        url: 'name',
        valueCoding: {
          system: 'http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext',
          code: r.name,
        },
      },
      ...(r.type ? [{ url: 'type', valueCode: r.type }] : []),
      ...(r.description ? [{ url: 'description', valueString: r.description }] : []),
    ],
  }));
  return replaceExtensions(q, STD_EXT.launchContext, exts);
}

export interface Duration {
  value: number;
  unit: 'a' | 'mo' | 'wk' | 'd';
}
const UNIT_NAMES: Record<Duration['unit'], string> = {
  a: 'year',
  mo: 'month',
  wk: 'week',
  d: 'day',
};

export function getLinkPeriod(item: QuestionnaireItem): Duration | undefined {
  const d = getExtension(item, STD_EXT.observationLinkPeriod)?.valueDuration;
  if (d?.value === undefined) return undefined;
  const unit = (d.code ?? 'a') as Duration['unit'];
  return { value: d.value, unit: unit in UNIT_NAMES ? unit : 'a' };
}

export function setLinkPeriod(item: QuestionnaireItem, d: Duration | undefined): QuestionnaireItem {
  return replaceExtensions(
    item,
    STD_EXT.observationLinkPeriod,
    d
      ? [
          {
            url: STD_EXT.observationLinkPeriod,
            valueDuration: {
              value: d.value,
              unit: UNIT_NAMES[d.unit],
              system: 'http://unitsofmeasure.org',
              code: d.unit,
            },
          },
        ]
      : [],
  );
}

/** itemPopulationContext: `{ name, expression }` or undefined. */
export function getPopulationContext(
  item: QuestionnaireItem,
): { name: string; expression: string } | undefined {
  const e = getExtension(item, STD_EXT.itemPopulationContext)?.valueExpression;
  return e ? { name: e.name ?? '', expression: e.expression ?? '' } : undefined;
}

export function setPopulationContext(
  item: QuestionnaireItem,
  v: { name: string; expression: string } | undefined,
): QuestionnaireItem {
  return replaceExtensions(
    item,
    STD_EXT.itemPopulationContext,
    v
      ? [
          {
            url: STD_EXT.itemPopulationContext,
            valueExpression: { name: v.name, language: 'text/fhirpath', expression: v.expression },
          },
        ]
      : [],
  );
}

export type ExtractionContext =
  { kind: 'none' } | { kind: 'create'; type: string } | { kind: 'update'; expression: string };

export function getExtractionContext(item: QuestionnaireItem): ExtractionContext {
  const e = getExtension(item, STD_EXT.itemExtractionContext);
  if (e?.valueCode) return { kind: 'create', type: e.valueCode };
  if (e?.valueExpression) return { kind: 'update', expression: e.valueExpression.expression ?? '' };
  return { kind: 'none' };
}

export function setExtractionContext(
  item: QuestionnaireItem,
  c: ExtractionContext,
): QuestionnaireItem {
  const ext: Extension[] =
    c.kind === 'create'
      ? [{ url: STD_EXT.itemExtractionContext, valueCode: c.type }]
      : c.kind === 'update'
        ? [
            {
              url: STD_EXT.itemExtractionContext,
              valueExpression: { language: 'text/fhirpath', expression: c.expression },
            },
          ]
        : [];
  return replaceExtensions(item, STD_EXT.itemExtractionContext, ext);
}
