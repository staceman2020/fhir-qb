import type { Questionnaire } from 'fhir/r4';
import {
  db as defaultDb,
  type QbDatabase,
  type QuestionnaireRecord,
  type VersionRecord,
} from './db.js';

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
