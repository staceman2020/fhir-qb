import type {
  Bundle,
  BundleEntry,
  CodeableConcept,
  FhirResource,
  Observation,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
} from 'fhir/r4';
import { STD_EXT, getExtension, getSubExtension } from '@qb/extensions';
import { answerKey } from './answers.js';
import { isQuestion, type DefinitionIndex, type ItemDef } from './definition.js';
import { fhirPathOf, type ExpressionEvaluator, type R4Model } from './expressions.js';
import type { AnswerValue, FeatureFlags, ItemNode, ValidationIssue } from './types.js';

/**
 * Extraction (plan §6.6): observation-based, definition-based and (behind the
 * `templateExtraction` flag, SDC ci-build) template-based. Produces a transaction Bundle; the
 * host decides where to send it.
 */

export interface ExtractInput {
  definitions: DefinitionIndex;
  items: readonly ItemNode[];
  enabled: ReadonlyMap<string, boolean>;
  response: QuestionnaireResponse;
  /** Instance path → its QuestionnaireResponse item (for template/expression contexts). */
  responseItems: ReadonlyMap<string, QuestionnaireResponseItem>;
  evaluator: ExpressionEvaluator | undefined;
  model: R4Model | undefined;
  features: FeatureFlags;
  /** Fresh ids for `urn:uuid:` fullUrls (injectable for reproducible tests). */
  uuid?: () => string;
  /** Reference to the QuestionnaireResponse for Observation.derivedFrom (e.g. `QuestionnaireResponse/123`). */
  responseReference?: string;
}

export interface ExtractResult {
  bundle: Bundle;
  issues: ValidationIssue[];
}

const randomUuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** observationExtract applies to an item when set on it or inherited from an ancestor/the form. */
function observationExtractOn(def: ItemDef | undefined, q: Questionnaire): boolean {
  for (let d = def; d; d = d.parent) {
    const v = getExtension(d.item, STD_EXT.observationExtract)?.valueBoolean;
    if (v !== undefined) return v;
  }
  return getExtension(q, STD_EXT.observationExtract)?.valueBoolean === true;
}

/** Observation.value[x] for an answer. */
function observationValue(a: AnswerValue, item: QuestionnaireItem): Partial<Observation> {
  if (a.valueCoding)
    return {
      valueCodeableConcept: {
        coding: [a.valueCoding],
        ...(a.valueCoding.display ? { text: a.valueCoding.display } : {}),
      },
    };
  if (a.valueQuantity) return { valueQuantity: a.valueQuantity };
  if (a.valueDecimal !== undefined) {
    // A decimal question's unit (questionnaire-unit) makes the value a proper Quantity.
    const u = getExtension(item, STD_EXT.unit)?.valueCoding;
    return {
      valueQuantity: {
        value: a.valueDecimal,
        ...(u
          ? {
              unit: u.display ?? u.code,
              ...(u.system ? { system: u.system } : {}),
              ...(u.code ? { code: u.code } : {}),
            }
          : {}),
      },
    };
  }
  if (a.valueInteger !== undefined) return { valueInteger: a.valueInteger };
  if (a.valueBoolean !== undefined) return { valueBoolean: a.valueBoolean };
  if (a.valueString !== undefined) return { valueString: a.valueString };
  if (a.valueDate) return { valueDateTime: a.valueDate };
  if (a.valueDateTime) return { valueDateTime: a.valueDateTime };
  if (a.valueTime) return { valueTime: a.valueTime };
  if (a.valueUri) return { valueString: a.valueUri };
  return {};
}

/** Converts an answer to the FHIR type of a target element (definition-based extraction). */
function convert(a: AnswerValue, type: string | undefined): unknown {
  const k = answerKey(a);
  if (!k) return undefined;
  const v = a[k];
  const coding = a.valueCoding;
  switch (type) {
    case 'code':
      return coding?.code ?? (typeof v === 'string' ? v : undefined);
    case 'Coding':
      return coding ?? (typeof v === 'string' ? { code: v } : undefined);
    case 'CodeableConcept':
      return coding
        ? ({
            coding: [coding],
            ...(coding.display ? { text: coding.display } : {}),
          } as CodeableConcept)
        : typeof v === 'string'
          ? { text: v }
          : undefined;
    case 'string':
    case 'markdown':
    case 'uri':
    case 'url':
    case 'id':
      return coding
        ? (coding.display ?? coding.code)
        : v === undefined
          ? undefined
          : String(typeof v === 'object' ? JSON.stringify(v) : v);
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'integer':
    case 'positiveInt':
    case 'unsignedInt':
      return typeof v === 'number' ? Math.round(v) : undefined;
    case 'decimal':
      return typeof v === 'number' ? v : a.valueQuantity?.value;
    case 'date':
      return a.valueDate ?? a.valueDateTime?.slice(0, 10);
    case 'dateTime':
    case 'instant':
      return a.valueDateTime ?? a.valueDate;
    case 'time':
      return a.valueTime;
    case 'Quantity':
      return a.valueQuantity ?? (typeof v === 'number' ? { value: v } : undefined);
    case 'Reference':
      return a.valueReference;
    case 'Attachment':
      return a.valueAttachment;
    default:
      return v;
  }
}

/**
 * Sets `Type.a.b` on a resource from answers, creating intermediate elements. Element types and
 * cardinality come from the fhirpath.js R4 model; choice elements (`value`) pick the answer type.
 */
function setByPath(
  resource: Record<string, unknown>,
  path: string,
  answers: readonly AnswerValue[],
  model: R4Model,
): string | undefined {
  const [, ...segments] = path.split('.');
  if (!segments.length) return `Definition path "${path}" has no element.`;
  let cur: Record<string, unknown> = resource;
  let type = resource.resourceType as string;
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i]!;
    const last = i === segments.length - 1;
    let elType = model.path2Type[`${type}.${seg}`];
    if (!elType && model.choiceTypePaths[`${type}.${seg}`]) {
      // value[x]: name the element after the answer's type, e.g. valueQuantity.
      const k = answerKey(answers[0] ?? {});
      const suffix = k?.replace(/^value/, '') ?? 'String';
      const typed = `${seg}${suffix === 'Decimal' ? 'Quantity' : suffix === 'Coding' ? 'CodeableConcept' : suffix}`;
      if (model.path2Type[`${type}.${typed}`]) {
        seg = typed;
        elType = model.path2Type[`${type}.${typed}`];
      }
    }
    if (!elType) return `Unknown element ${type}.${seg} in definition "${path}".`;
    const repeating = model.path2Repeating?.[`${type}.${seg}`] === true;
    if (last) {
      const values = answers.map((a) => convert(a, elType)).filter((v) => v !== undefined);
      if (!values.length) return undefined;
      // Answers replace the element's value (an updated resource keeps no stale values).
      cur[seg] = repeating ? values : values[0];
      return undefined;
    }
    let next: Record<string, unknown>;
    if (repeating) {
      const arr = ((cur[seg] as Record<string, unknown>[] | undefined) ??= []);
      next = arr[0] ?? {};
      arr[0] = next;
    } else {
      next = (cur[seg] as Record<string, unknown> | undefined) ?? {};
      cur[seg] = next;
    }
    cur = next;
    type = elType;
  }
  return undefined;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function extractResources(input: ExtractInput): ExtractResult {
  const { definitions, enabled, response, evaluator, model, features } = input;
  const q = definitions.questionnaire;
  const uuid = input.uuid ?? randomUuid;
  const entries: BundleEntry[] = [];
  const issues: ValidationIssue[] = [];
  const effective = response.authored ?? new Date().toISOString();
  const defOf = (n: ItemNode) => definitions.byLinkId.get(n.linkId)!;
  const live = (n: ItemNode) => enabled.get(n.path) !== false;
  const post = (resource: FhirResource) => {
    const id = resource.id;
    entries.push({
      fullUrl: `urn:uuid:${uuid()}`,
      resource,
      request: id
        ? { method: 'PUT', url: `${resource.resourceType}/${id}` }
        : { method: 'POST', url: resource.resourceType },
    });
  };

  // ---------------------------------------------------------------- observation-based
  const walkObs = (nodes: readonly ItemNode[]) => {
    for (const n of nodes) {
      if (!live(n)) continue;
      const def = defOf(n);
      if (
        isQuestion(def.item) &&
        def.item.code?.length &&
        n.answers.length &&
        observationExtractOn(def, q)
      ) {
        for (const a of n.answers) {
          const obs: Observation = {
            resourceType: 'Observation',
            status: 'final',
            category: [
              {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                    code: 'survey',
                  },
                ],
              },
            ],
            code: { coding: def.item.code, ...(def.item.text ? { text: def.item.text } : {}) },
            ...(response.subject ? { subject: response.subject } : {}),
            ...(response.encounter ? { encounter: response.encounter } : {}),
            effectiveDateTime: effective,
            issued: effective,
            ...(response.author ? { performer: [response.author] } : {}),
            ...(input.responseReference
              ? { derivedFrom: [{ reference: input.responseReference }] }
              : {}),
            ...observationValue(a, def.item),
          };
          post(obs);
        }
      }
      walkObs(n.items);
    }
  };
  walkObs(input.items);

  // ---------------------------------------------------------------- definition-based
  const contextTarget = (
    item: QuestionnaireItem | Questionnaire,
    path: string | undefined,
  ): FhirResource[] | null => {
    const ext = getExtension(item, STD_EXT.itemExtractionContext);
    if (!ext) return null;
    if (ext.valueCode) return [{ resourceType: ext.valueCode } as FhirResource];
    const expr = fhirPathOf(ext);
    if (!expr || !evaluator) return null;
    const focus = path ? input.responseItems.get(path) : undefined;
    const r = evaluator.evaluateOn(
      expr,
      focus ?? response,
      focus ? 'QuestionnaireResponse.item' : undefined,
      response,
    );
    if (!r.ok) {
      issues.push({
        severity: 'error',
        code: 'extract-error',
        message: `itemExtractionContext: ${r.error}`,
        ...('linkId' in item ? { linkId: item.linkId } : {}),
      });
      return [];
    }
    return r.value
      .filter((v): v is FhirResource => typeof v === 'object' && v !== null && 'resourceType' in v)
      .map(clone);
  };

  const fillFrom = (resource: FhirResource, nodes: readonly ItemNode[]) => {
    for (const n of nodes) {
      if (!live(n)) continue;
      const def = defOf(n);
      // A nested extraction context starts its own resource.
      if (getExtension(def.item, STD_EXT.itemExtractionContext)) continue;
      const definition = def.item.definition;
      if (definition && n.answers.length && model) {
        const hash = definition.indexOf('#');
        const path = hash >= 0 ? definition.slice(hash + 1) : definition;
        if (path.split('.')[0] === resource.resourceType) {
          const err = setByPath(
            resource as unknown as Record<string, unknown>,
            path,
            n.answers,
            model,
          );
          if (err)
            issues.push({
              severity: 'warning',
              code: 'extract-definition',
              linkId: def.linkId,
              message: err,
            });
        }
      }
      fillFrom(resource, n.items);
    }
  };

  const walkDefs = (nodes: readonly ItemNode[]) => {
    for (const n of nodes) {
      if (!live(n)) continue;
      const def = defOf(n);
      const targets = contextTarget(def.item, n.path);
      if (targets) {
        for (const t of targets) {
          fillFrom(t, n.items);
          if (Object.keys(t).length > 1) post(t);
        }
      }
      walkDefs(n.items);
    }
  };
  const rootTargets = contextTarget(q, undefined);
  if (rootTargets)
    for (const t of rootTargets) {
      fillFrom(t, input.items);
      if (Object.keys(t).length > 1) post(t);
    }
  walkDefs(input.items);

  // ---------------------------------------------------------------- template-based (ci-build)
  const templateHolders: { el: QuestionnaireItem | Questionnaire; path: string | undefined }[] = [];
  if (getExtension(q, STD_EXT.templateExtract)) templateHolders.push({ el: q, path: undefined });
  const walkTemplates = (nodes: readonly ItemNode[]) => {
    for (const n of nodes) {
      if (!live(n)) continue;
      if (getExtension(defOf(n).item, STD_EXT.templateExtract))
        templateHolders.push({ el: defOf(n).item, path: n.path });
      walkTemplates(n.items);
    }
  };
  walkTemplates(input.items);
  if (templateHolders.length && !features.templateExtraction) {
    issues.push({
      severity: 'information',
      code: 'template-extraction-disabled',
      message: 'Template-based extraction is turned off (feature flag templateExtraction).',
    });
  } else if (templateHolders.length) {
    if (!evaluator)
      issues.push({
        severity: 'error',
        code: 'extract-error',
        message: 'Template extraction needs FHIRPath support.',
      });
    else
      for (const h of templateHolders) {
        const ext = getExtension(h.el, STD_EXT.templateExtract)!;
        const ref =
          getSubExtension(ext, 'template')?.valueReference?.reference ??
          ext.valueReference?.reference;
        const template = ref?.startsWith('#')
          ? q.contained?.find((r) => r.id === ref.slice(1))
          : undefined;
        if (!template) {
          issues.push({
            severity: 'error',
            code: 'extract-template',
            message: `Template ${ref ?? '(none)'} is not a contained resource.`,
          });
          continue;
        }
        const focus = h.path ? input.responseItems.get(h.path) : undefined;
        const out = applyTemplate(
          clone(template) as unknown as Record<string, unknown>,
          focus,
          response,
          evaluator,
          issues,
        );
        delete out.id;
        if (out) post(out as unknown as FhirResource);
      }
  }

  return { bundle: { resourceType: 'Bundle', type: 'transaction', entry: entries }, issues };
}

/**
 * Template extraction: elements carrying `templateExtractContext` repeat once per result (with
 * that result as the focus); `templateExtractValue` replaces the element's value; empty results
 * remove the element. Contexts and values are evaluated as QuestionnaireResponse items.
 */
function applyTemplate(
  node: Record<string, unknown>,
  focus: QuestionnaireResponseItem | undefined,
  response: QuestionnaireResponse,
  evaluator: ExpressionEvaluator,
  issues: ValidationIssue[],
): Record<string, unknown> {
  const evalExpr = (expr: string, f: unknown) => {
    const r = evaluator.evaluateOn(
      expr,
      f ?? response,
      f ? 'QuestionnaireResponse.item' : undefined,
      response,
    );
    if (!r.ok)
      issues.push({
        severity: 'error',
        code: 'extract-template',
        message: `Template expression "${expr}": ${r.error}`,
      });
    return r.ok ? r.value : [];
  };
  const extOf = (el: unknown, url: string) =>
    (el as { extension?: { url: string; valueString?: string }[] } | undefined)?.extension?.find(
      (e) => e.url === url,
    )?.valueString;
  const stripExt = (el: Record<string, unknown>) => {
    const ext = (el.extension as { url: string }[] | undefined)?.filter(
      (e) => e.url !== STD_EXT.templateExtractContext && e.url !== STD_EXT.templateExtractValue,
    );
    if (ext?.length) el.extension = ext;
    else delete el.extension;
  };
  const process = (obj: Record<string, unknown>, f: unknown): Record<string, unknown> => {
    // Primitives may exist only as their `_key` sibling (extension without a value).
    const keys = new Set(Object.keys(obj).map((k) => (k.startsWith('_') ? k.slice(1) : k)));
    for (const key of keys) {
      const v = obj[key];
      // Primitive with templateExtractValue on its `_key` sibling.
      const meta = obj[`_${key}`] as Record<string, unknown> | undefined;
      const primExpr = extOf(meta, STD_EXT.templateExtractValue);
      if (primExpr !== undefined) {
        const vals = evalExpr(primExpr, f).filter((x) => typeof x !== 'object');
        if (vals.length) obj[key] = Array.isArray(v) ? vals : vals[0];
        else delete obj[key];
        if (meta) {
          stripExt(meta);
          if (!Object.keys(meta).length) delete obj[`_${key}`];
        }
        continue;
      }
      if (v === undefined) continue;
      const items = Array.isArray(v) ? v : [v];
      const out: unknown[] = [];
      for (const it of items) {
        if (typeof it !== 'object' || it === null) {
          out.push(it);
          continue;
        }
        const el = it as Record<string, unknown>;
        const ctxExpr = extOf(el, STD_EXT.templateExtractContext);
        const valExpr = extOf(el, STD_EXT.templateExtractValue);
        if (ctxExpr !== undefined) {
          for (const c of evalExpr(ctxExpr, f)) {
            const copy = clone(el);
            stripExt(copy);
            out.push(process(copy, c));
          }
        } else if (valExpr !== undefined) {
          out.push(...evalExpr(valExpr, f));
        } else out.push(process(el, f));
      }
      if (!out.length) delete obj[key];
      else obj[key] = Array.isArray(v) ? out : out[0];
    }
    return obj;
  };
  return process(node, focus);
}
