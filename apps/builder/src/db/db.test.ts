import { describe, expect, it, beforeEach } from 'vitest';
import { fixtures, modular } from '@qb/test-fixtures';
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

describe('library, backup and storage', () => {
  it('resolves canonicals from the library, newest matching version first', async () => {
    const repo = fresh();
    for (const q of modular.library()) await repo.create(q);
    expect(
      (await repo.findByCanonical('http://example.org/fhir/qb/Questionnaire/modular-contact'))
        ?.version,
    ).toBe('2.1.0');
    expect(
      await repo.findByCanonical('http://example.org/fhir/qb/Questionnaire/modular-contact|9.9'),
    ).toBeUndefined();
    expect(
      (
        await repo.findByCanonical(
          'http://example.org/fhir/qb/Questionnaire/modular-demographics|1.0.0',
        )
      )?.title,
    ).toBe('Demographics module');
  });

  it('backs up and restores forms, versions, test data and settings', async () => {
    const source = fresh();
    const id = await source.create(fixtures.repeats(), ['tag']);
    await source.saveVersion(id, fixtures.repeats(), 'v1');
    await source.saveTestData(id, { patient: { resourceType: 'Patient', id: 'x' } }, []);
    await source.setSetting('terminologyServer', 'https://tx.example.org/fhir');
    const backup = JSON.parse(
      JSON.stringify(await source.exportBackup(new Date('2026-10-29T00:00:00Z'))),
    );
    expect(backup).toMatchObject({
      format: 'qb-builder-backup',
      version: 1,
      exportedAt: '2026-10-29T00:00:00.000Z',
    });

    const target = fresh();
    const other = await target.create(fixtures.allTypes());
    await target.saveVersion(other, fixtures.allTypes(), 'keep me');
    expect(await target.importBackup(backup)).toEqual({ forms: 1, versions: 1 });
    expect((await target.get(id))?.tags).toEqual(['tag']);
    expect((await target.listVersions(id)).map((v) => v.label)).toEqual(['v1']);
    expect((await target.listVersions(other)).map((v) => v.label)).toEqual(['keep me']);
    expect((await target.getTestData(id))?.resources.patient?.id).toBe('x');
    expect(await target.getSetting('terminologyServer', '')).toBe('https://tx.example.org/fhir');
    await expect(target.importBackup({ format: 'other' })).rejects.toThrow(
      'not a qb builder backup',
    );
    await expect(
      target.importBackup({ format: 'qb-builder-backup', version: 1, questionnaires: [{ id: 1 }] }),
    ).rejects.toThrow('invalid form record');
  });

  it('clears the terminology cache only when storage is at least 80% full', async () => {
    const repo = fresh();
    await repo.db.valueSetCache.put({ key: 'k', server: 's', fetchedAt: 0, expansion: {} });
    expect(await repo.pruneIfNearlyFull({ usage: 50, quota: 100 })).toBe(false);
    expect(await repo.db.valueSetCache.count()).toBe(1);
    expect(await repo.pruneIfNearlyFull({ usage: 85, quota: 100 })).toBe(true);
    expect(await repo.db.valueSetCache.count()).toBe(0);
  });
});
