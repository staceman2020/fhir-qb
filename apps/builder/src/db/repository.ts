import type { FhirResource, Questionnaire } from 'fhir/r4';
import {
  db as defaultDb,
  type LaunchContextRecord,
  type QbDatabase,
  type QuestionnaireRecord,
  type SettingRecord,
  type VersionRecord,
} from './db.js';

export const BACKUP_FORMAT = 'qb-builder-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  questionnaires: QuestionnaireRecord[];
  versions: VersionRecord[];
  launchContexts: LaunchContextRecord[];
  settings: SettingRecord[];
}

const newId = () => crypto.randomUUID();

function recordFields(q: Questionnaire) {
  return { url: q.url, title: q.title, status: q.status ?? 'draft' };
}

export function blankQuestionnaire(): Questionnaire {
  return { resourceType: 'Questionnaire', status: 'draft', title: 'Untitled form', item: [] };
}

export function createRepository(db: QbDatabase = defaultDb) {
  return {
    db,

    async create(
      questionnaire: Questionnaire = blankQuestionnaire(),
      tags: string[] = [],
    ): Promise<string> {
      const now = Date.now();
      const id = newId();
      await db.questionnaires.add({
        id,
        questionnaire,
        tags,
        createdAt: now,
        updatedAt: now,
        ...recordFields(questionnaire),
      });
      return id;
    },

    get: (id: string) => db.questionnaires.get(id),

    async save(id: string, questionnaire: Questionnaire): Promise<void> {
      await db.questionnaires.update(id, {
        questionnaire,
        updatedAt: Date.now(),
        ...recordFields(questionnaire),
      });
    },

    async setTags(id: string, tags: string[]): Promise<void> {
      await db.questionnaires.update(id, { tags });
    },

    async remove(id: string): Promise<void> {
      await db.transaction(
        'rw',
        [db.questionnaires, db.versions, db.responses, db.launchContexts],
        async () => {
          await db.questionnaires.delete(id);
          await db.versions.where('questionnaireId').equals(id).delete();
          await db.responses.where('questionnaireId').equals(id).delete();
          await db.launchContexts.where('questionnaireId').equals(id).delete();
        },
      );
    },

    async duplicate(id: string): Promise<string | undefined> {
      const rec = await db.questionnaires.get(id);
      if (!rec) return undefined;
      const q: Questionnaire = {
        ...structuredClone(rec.questionnaire),
        title: `${rec.questionnaire.title ?? 'Untitled form'} (copy)`,
      };
      return this.create(q, rec.tags);
    },

    list: (): Promise<QuestionnaireRecord[]> =>
      db.questionnaires.orderBy('updatedAt').reverse().toArray(),

    // ---------------------------------------------------------------- versions (plan §9.2)

    async saveVersion(
      questionnaireId: string,
      questionnaire: Questionnaire,
      label: string,
    ): Promise<number> {
      return (await db.versions.add({
        questionnaireId,
        questionnaire: structuredClone(questionnaire),
        label,
        createdAt: Date.now(),
      })) as number;
    },

    listVersions: (questionnaireId: string): Promise<VersionRecord[]> =>
      db.versions.where('questionnaireId').equals(questionnaireId).reverse().sortBy('createdAt'),

    getVersion: (seq: number) => db.versions.get(seq),

    deleteVersion: (seq: number) => db.versions.delete(seq),

    // ---------------------------------------------------------------- test data (launch context)

    getTestData: (questionnaireId: string) => db.launchContexts.get(questionnaireId),

    async saveTestData(
      questionnaireId: string,
      resources: Record<string, FhirResource>,
      serverResources: FhirResource[],
    ): Promise<void> {
      await db.launchContexts.put({
        id: questionnaireId,
        questionnaireId,
        resources,
        serverResources,
      });
    },

    /** Library lookup for sub-questionnaires: `url` or `url|version`, most recently changed first. */
    async findByCanonical(canonical: string): Promise<Questionnaire | undefined> {
      const [url, version] = canonical.split('|');
      if (!url) return undefined;
      const matches = await db.questionnaires.where('url').equals(url).toArray();
      const hit = matches
        .filter((r) => !version || r.questionnaire.version === version)
        .sort((x, y) => y.updatedAt - x.updatedAt)[0];
      return hit?.questionnaire;
    },

    // ---------------------------------------------------------------- backup (plan §9.2)

    async exportBackup(now = new Date()): Promise<Backup> {
      return {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: now.toISOString(),
        questionnaires: await db.questionnaires.toArray(),
        versions: await db.versions.toArray(),
        launchContexts: await db.launchContexts.toArray(),
        settings: await db.settings.toArray(),
      };
    },

    /** Restores a backup, replacing records with the same ids. Returns how many forms were restored. */
    async importBackup(data: unknown): Promise<{ forms: number; versions: number }> {
      const b = data as Partial<Backup>;
      if (b?.format !== BACKUP_FORMAT || b.version !== 1 || !Array.isArray(b.questionnaires))
        throw new Error('This file is not a qb builder backup.');
      if (
        b.questionnaires.some(
          (r) => typeof r?.id !== 'string' || r.questionnaire?.resourceType !== 'Questionnaire',
        )
      )
        throw new Error('The backup contains an invalid form record.');
      await db.transaction(
        'rw',
        [db.questionnaires, db.versions, db.launchContexts, db.settings],
        async () => {
          await db.questionnaires.bulkPut(b.questionnaires!);
          // Versions get new sequence numbers so they never overwrite other forms' history.
          await db.versions.bulkAdd((b.versions ?? []).map(({ seq: _s, ...v }) => v));
          await db.launchContexts.bulkPut(b.launchContexts ?? []);
          await db.settings.bulkPut(b.settings ?? []);
        },
      );
      return { forms: b.questionnaires.length, versions: b.versions?.length ?? 0 };
    },

    /** Frees space by clearing the terminology cache when storage is at least 80% full (plan §9.4). */
    async pruneIfNearlyFull(
      estimate: { usage?: number; quota?: number } | undefined,
    ): Promise<boolean> {
      if (!estimate?.quota || (estimate.usage ?? 0) / estimate.quota < 0.8) return false;
      await db.valueSetCache.clear();
      return true;
    },

    // ---------------------------------------------------------------- settings

    async getSetting<T>(key: string, fallback: T): Promise<T> {
      return ((await db.settings.get(key))?.value as T | undefined) ?? fallback;
    },

    async setSetting(key: string, value: unknown): Promise<void> {
      await db.settings.put({ key, value });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

export const SETTINGS = {
  terminologyServer: 'terminologyServer',
} as const;
