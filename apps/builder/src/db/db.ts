import Dexie, { type EntityTable } from 'dexie';
import type { FhirResource, Questionnaire, QuestionnaireResponse } from 'fhir/r4';

export interface QuestionnaireRecord {
  id: string;
  questionnaire: Questionnaire;
  url?: string | undefined;
  title?: string | undefined;
  status: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface VersionRecord {
  seq?: number;
  questionnaireId: string;
  createdAt: number;
  label: string;
  questionnaire: Questionnaire;
}

export interface ResponseRecord {
  id: string;
  questionnaireId: string;
  updatedAt: number;
  response: QuestionnaireResponse;
}

export interface LaunchContextRecord {
  id: string;
  questionnaireId: string;
  resources: Record<string, FhirResource>;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface ValueSetCacheRecord {
  /** server|vsUrl|filter|count */
  key: string;
  server: string;
  fetchedAt: number;
  expansion: unknown;
}

export const DB_NAME = 'qb-builder';

/** Dexie schema v1 (plan §9.4). Add migrations with `this.version(n).stores(...).upgrade(...)`. */
export class QbDatabase extends Dexie {
  questionnaires!: EntityTable<QuestionnaireRecord, 'id'>;
  versions!: EntityTable<VersionRecord, 'seq'>;
  responses!: EntityTable<ResponseRecord, 'id'>;
  launchContexts!: EntityTable<LaunchContextRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;
  valueSetCache!: EntityTable<ValueSetCacheRecord, 'key'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      questionnaires: '&id, url, title, status, updatedAt, *tags',
      versions: '++seq, questionnaireId, createdAt, label',
      responses: '&id, questionnaireId, updatedAt',
      launchContexts: '&id, questionnaireId',
      settings: '&key',
      valueSetCache: '&key, server, fetchedAt',
    });
  }
}

export const db = new QbDatabase();
