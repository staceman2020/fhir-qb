import type {
  Coding,
  Observation,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
} from 'fhir/r4';
import { STD_EXT, getExtension, getExtensions, getSubExtension } from '@qb/extensions';
import type { DefinitionIndex } from './definition.js';
import { variablesOf, type ExpressionEvaluator } from './expressions.js';
import type { AnswerValue, EngineOptions, FhirClientAdapter, ValidationIssue } from './types.js';

/**
 * Client-side population (SDC $populate semantics, plan §6.5). Network work (x-fhir-query
 * variables, observationLinkPeriod searches) happens up front in `createFormEngine`, so the
 * engine itself stays synchronous.
 */

export const X_FHIR_QUERY = 'application/x-fhir-query';

export interface LaunchContextDecl {
  name: string;
  types: string[];
  description: string | undefined;
}

/** `sdc-questionnaire-launchContext` declarations on the Questionnaire. */
export function launchContextsOf(q: Questionnaire): LaunchContextDecl[] {
  return getExtensions(q, STD_EXT.launchContext).flatMap((e) => {
    const nameExt = getSubExtension(e, 'name');
    const name = nameExt?.valueCoding?.code ?? nameExt?.valueId;
    if (!name) return [];
    const types = (e.extension ?? [])
      .filter((x) => x.url === 'type')
      .map((x) => x.valueCode)
      .filter((t): t is string => !!t);
    return [{ name, types, description: getSubExtension(e, 'description')?.valueString }];
  });
}

export interface Prefetched {
  /** x-fhir-query results keyed by `${linkId}\u0000${name}` ('' for Questionnaire-level). */
  queries: Map<string, unknown[]>;
  /** observationLinkPeriod answers by linkId. */
  observations: Map<string, AnswerValue[]>;
}

export const queryKey = (linkId: string | undefined, name: string) =>
  `${linkId ?? ''}\u0000${name}`;

const EMPTY_QR: QuestionnaireResponse = {
  resourceType: 'QuestionnaireResponse',
  status: 'in-progress',
};

async function fetchJson(
  client: FhirClientAdapter,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const url = `${client.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\//, '')}`;
    const res = await client.fetch(url, { headers: { Accept: 'application/fhir+json' } });
    if (!res.ok) return { ok: false, error: `${path} returned ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (e) {
    return { ok: false, error: `${path} failed: ${(e as Error).message}` };
  }
}

/** Replaces `{{expr}}` with the FHIRPath results (URL-encoded, comma-joined). */
function interpolate(
  query: string,
  evaluator: ExpressionEvaluator,
  item: QuestionnaireItem | undefined,
): { query: string; error?: string } {
  let error: string | undefined;
  const out = query.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    const r = evaluator.evaluate(expr.trim(), EMPTY_QR, { context: undefined, item, vars: {} });
    if (!r.ok) {
      error = r.error;
      return '';
    }
    return r.value.map((v) => encodeURIComponent(String(v))).join(',');
  });
  return error === undefined ? { query: out } : { query: out, error };
}

export async function prefetchPopulation(
  index: DefinitionIndex,
  evaluator: ExpressionEvaluator | undefined,
  options: EngineOptions,
  issues: ValidationIssue[],
): Promise<Prefetched> {
  const result: Prefetched = { queries: new Map(), observations: new Map() };
  const q = index.questionnaire;
  const client = options.fhirClient;

  for (const decl of launchContextsOf(q))
    if (!options.launchContext?.[decl.name])
      issues.push({
        severity: 'warning',
        code: 'launch-context-missing',
        message: `Launch context %${decl.name} was not provided; items that depend on it are not pre-filled.`,
      });

  // x-fhir-query variables (Questionnaire and item level).
  const holders: {
    linkId: string | undefined;
    item: QuestionnaireItem | undefined;
    el: { extension?: Questionnaire['extension'] };
  }[] = [
    { linkId: undefined, item: undefined, el: q },
    ...[...index.byLinkId.values()].map((d) => ({ linkId: d.linkId, item: d.item, el: d.item })),
  ];
  for (const h of holders) {
    for (const v of variablesOf(h.el)) {
      if (v.language !== X_FHIR_QUERY || !v.expression) continue;
      if (!client || !evaluator) {
        issues.push({
          severity: 'warning',
          code: 'population-no-server',
          message: `Variable %${v.name} needs a FHIR server (x-fhir-query); it is empty.`,
          ...(h.linkId ? { linkId: h.linkId } : {}),
        });
        continue;
      }
      const { query, error } = interpolate(v.expression, evaluator, h.item);
      if (error) {
        issues.push({
          severity: 'error',
          code: 'population-error',
          message: `Variable %${v.name}: ${error}`,
          ...(h.linkId ? { linkId: h.linkId } : {}),
        });
        continue;
      }
      const r = await fetchJson(client, query);
      if (!r.ok)
        issues.push({
          severity: 'warning',
          code: 'population-query-failed',
          message: `Variable %${v.name}: ${r.error}`,
          ...(h.linkId ? { linkId: h.linkId } : {}),
        });
      result.queries.set(queryKey(h.linkId, v.name), r.ok ? [r.body] : []);
    }
  }

  // observationLinkPeriod: most recent matching Observation for the patient within the period.
  const patient = options.launchContext?.patient as { id?: string } | undefined;
  for (const def of index.byLinkId.values()) {
    const period = getExtension(def.item, STD_EXT.observationLinkPeriod)?.valueDuration;
    if (!period || !def.item.code?.length) continue;
    if (!client || !patient?.id) {
      issues.push({
        severity: 'warning',
        code: 'population-no-server',
        linkId: def.linkId,
        message: `"${def.linkId}" links to recent observations, which needs a FHIR server and %patient.`,
      });
      continue;
    }
    const since = subtractDuration(
      options.now ?? new Date(),
      period.value ?? 0,
      period.code ?? period.unit ?? 'd',
    );
    const codes = def.item.code
      .map((c) => (c.system ? `${c.system}|${c.code}` : (c.code ?? '')))
      .join(',');
    const r = await fetchJson(
      client,
      `Observation?subject=${encodeURIComponent(`Patient/${patient.id}`)}&code=${encodeURIComponent(codes)}&date=ge${since}&_sort=-date&_count=1`,
    );
    if (!r.ok) {
      issues.push({
        severity: 'warning',
        code: 'population-query-failed',
        linkId: def.linkId,
        message: r.error,
      });
      continue;
    }
    const obs = (r.body as { entry?: { resource?: Observation }[] }).entry?.[0]?.resource;
    const answers = obs ? observationToAnswers(obs, def.item) : [];
    if (answers.length) result.observations.set(def.linkId, answers);
  }
  return result;
}

const MS: Record<string, number> = { s: 1e3, min: 6e4, h: 3.6e6, d: 8.64e7, wk: 6.048e8 };

function subtractDuration(now: Date, value: number, unit: string): string {
  const d = new Date(now.getTime());
  if (unit === 'a') d.setUTCFullYear(d.getUTCFullYear() - value);
  else if (unit === 'mo') d.setUTCMonth(d.getUTCMonth() - value);
  else d.setTime(d.getTime() - value * (MS[unit] ?? MS.d!));
  return d.toISOString().slice(0, 10);
}

/** Observation.value[x] as an answer of the item's type (plan §6.5 observation-based population). */
export function observationToAnswers(obs: Observation, item: QuestionnaireItem): AnswerValue[] {
  const q = obs.valueQuantity;
  switch (item.type) {
    case 'quantity':
      return q ? [{ valueQuantity: q }] : [];
    case 'decimal':
      return q?.value !== undefined
        ? [{ valueDecimal: q.value }]
        : obs.valueInteger !== undefined
          ? [{ valueDecimal: obs.valueInteger }]
          : [];
    case 'integer': {
      const v = obs.valueInteger ?? q?.value;
      return v !== undefined ? [{ valueInteger: Math.round(v) }] : [];
    }
    case 'boolean':
      return obs.valueBoolean !== undefined ? [{ valueBoolean: obs.valueBoolean }] : [];
    case 'string':
    case 'text':
      return obs.valueString !== undefined ? [{ valueString: obs.valueString }] : [];
    case 'date':
      return obs.valueDateTime ? [{ valueDate: obs.valueDateTime.slice(0, 10) }] : [];
    case 'dateTime':
      return obs.valueDateTime ? [{ valueDateTime: obs.valueDateTime }] : [];
    case 'time':
      return obs.valueTime ? [{ valueTime: obs.valueTime }] : [];
    case 'choice':
    case 'open-choice': {
      const c: Coding | undefined = obs.valueCodeableConcept?.coding?.[0];
      return c ? [{ valueCoding: c }] : obs.valueString ? [{ valueString: obs.valueString }] : [];
    }
    default:
      return [];
  }
}

/** QuestionnaireResponse subject/encounter/author from the launch context (SDC $populate). */
export function responseBaseFromContext(
  launchContext: Record<string, unknown> | undefined,
): Partial<QuestionnaireResponse> {
  const ref = (r: unknown) => {
    const res = r as { resourceType?: string; id?: string } | undefined;
    return res?.resourceType && res.id ? { reference: `${res.resourceType}/${res.id}` } : undefined;
  };
  const out: Partial<QuestionnaireResponse> = {};
  const subject = ref(launchContext?.patient);
  const encounter = ref(launchContext?.encounter);
  const author = ref(launchContext?.user);
  if (subject) out.subject = subject;
  if (encounter) out.encounter = encounter;
  if (author) out.author = author;
  return out;
}
