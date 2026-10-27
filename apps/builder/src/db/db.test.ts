import { describe, expect, it, beforeEach } from 'vitest';
import { fixtures } from '@qb/test-fixtures';
import { QbDatabase } from './db.js';
import { createRepository } from './repository.js';

let n = 0;
const fresh = () => createRepository(new QbDatabase(`test-${n++}`));

describe('Dexie schema v1', () => {
  it('opens with the planned tables and indexes', async () => {
    const repo = fresh();
    await repo.db.open();
    const tables = Object.fromEntries(
      repo.db.tables.map((t) => [
        t.name,
        [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)],
      ]),
    );
    expect(tables).toEqual({
      questionnaires: ['id', 'url', 'title', 'status', 'updatedAt', '*tags'],
      versions: ['++seq', 'questionnaireId', 'createdAt', 'label'],
      responses: ['id', 'questionnaireId', 'updatedAt'],
      launchContexts: ['id', 'questionnaireId'],
      settings: ['key'],
      valueSetCache: ['key', 'server', 'fetchedAt'],
    });
    expect(repo.db.verno).toBe(1);
  });
});

describe('repository', () => {
  let repo: ReturnType<typeof fresh>;
  beforeEach(() => {
    repo = fresh();
  });

  it('creates, saves, lists newest first and deletes with versions', async () => {
    const a = await repo.create(fixtures.repeats());
    await new Promise((r) => setTimeout(r, 2));
    const b = await repo.create();
    expect((await repo.list()).map((r) => r.id)).toEqual([b, a]);
    await new Promise((r) => setTimeout(r, 2));
    await repo.save(a, { ...fixtures.repeats(), title: 'Renamed' });
    const list = await repo.list();
    expect(list[0]).toMatchObject({ id: a, title: 'Renamed', status: 'draft' });

    await repo.saveVersion(a, list[0]!.questionnaire, 'v1');
    await repo.saveVersion(a, { ...list[0]!.questionnaire, title: 'Later' }, 'v2');
    const versions = await repo.listVersions(a);
    expect(versions.map((v) => v.label)).toEqual(['v2', 'v1']);
    await repo.remove(a);
    expect(await repo.get(a)).toBeUndefined();
    expect(await repo.listVersions(a)).toEqual([]);
  });

  it('snapshots are independent copies', async () => {
    const q = fixtures.repeats();
    const id = await repo.create(q);
    const seq = await repo.saveVersion(id, q, 'snap');
    q.title = 'mutated';
    expect((await repo.getVersion(seq))?.questionnaire.title).toBe('Household members');
  });

  it('duplicates and stores settings', async () => {
    const id = await repo.create(fixtures.repeats(), ['demo']);
    const copy = (await repo.duplicate(id))!;
    expect((await repo.get(copy))?.title).toBe('Household members (copy)');
    expect((await repo.get(copy))?.tags).toEqual(['demo']);
    expect(await repo.getSetting('terminologyServer', '')).toBe('');
    await repo.setSetting('terminologyServer', 'https://tx.example.org/fhir');
    expect(await repo.getSetting('terminologyServer', '')).toBe('https://tx.example.org/fhir');
  });
});
