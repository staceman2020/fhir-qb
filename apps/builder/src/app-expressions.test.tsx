import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Questionnaire } from 'fhir/r4';
import { TerminologyClient, type FetchLike } from '@qb/core';
import { STD_EXT, getExtension } from '@qb/extensions';
import '@qb/renderer/define';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { RepoContext } from './context.js';
import { QbDatabase } from './db/db.js';
import { createRepository, SETTINGS, type Repository } from './db/repository.js';
import { DexieTerminologyCache, TerminologyClientContext } from './terminology.js';

let n = 0;
let repo: Repository;
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const fetchMock = vi.fn<FetchLike>(async (url) => {
  if (url.endsWith('/metadata'))
    return json({
      resourceType: 'CapabilityStatement',
      fhirVersion: '4.0.1',
      software: { name: 'Mock TX' },
    });
  const filter = new URL(url).searchParams.get('filter');
  if (filter === 'weight')
    return json({
      resourceType: 'ValueSet',
      expansion: {
        total: 1,
        contains: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }],
      },
    });
  return json({
    resourceType: 'ValueSet',
    expansion: {
      contains: [
        { system: 'x', code: 'm' },
        { system: 'x', code: 'f' },
      ],
    },
  });
});

const ord = (v: number) => [{ url: STD_EXT.ordinalValue, valueDecimal: v }];
const scored = (): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  title: 'Mood',
  item: ['q1', 'q2'].map((linkId, i) => ({
    linkId,
    type: 'choice' as const,
    text: `Question ${i + 1}`,
    answerOption: [
      { valueCoding: { system: 'urn:a', code: 'no', display: 'No' }, extension: ord(0) },
      { valueCoding: { system: 'urn:a', code: 'yes', display: 'Yes' }, extension: ord(2) },
    ],
  })),
});

async function open(q: Questionnaire) {
  const id = await repo.create(q);
  window.location.hash = `#/edit/${id}`;
  const user = userEvent.setup();
  render(
    <RepoContext value={repo}>
      <TerminologyClientContext value={new TerminologyClient(fetchMock)}>
        <App />
      </TerminologyClientContext>
    </RepoContext>,
  );
  await screen.findByRole('heading', { level: 1, name: q.title! });
  return { id, user };
}

const saved = async (id: string) => {
  await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy(), {
    timeout: 3000,
  });
  return (await repo.get(id))!.questionnaire;
};

const previewRoot = async () =>
  waitFor(() => {
    const el = document.querySelector('qb-questionnaire');
    expect(el?.shadowRoot?.querySelector('.qb-form')).toBeTruthy();
    return el!.shadowRoot as unknown as HTMLElement;
  });

beforeEach(() => {
  repo = createRepository(new QbDatabase(`expr-${n++}`));
  fetchMock.mockClear();
});

describe('Expressions in the builder', () => {
  it('sets a calculated answer, checks syntax and shows a live result', async () => {
    const q = scored();
    q.item!.push({ linkId: 'n', type: 'integer', text: 'Number' });
    const { id, user } = await open(q);
    await user.click(within(screen.getByRole('tree')).getByRole('treeitem', { name: /Number/ }));
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }));
    await user.click(screen.getByRole('radio', { name: 'Compute continuously (calculated)' }));
    const editor = screen.getByRole('textbox', { name: 'Calculated answer' });
    await user.type(editor, '1 +');
    expect(await screen.findByText(/^At character 3:/)).toBeTruthy();
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    await user.type(editor, ' 41');
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy(), { timeout: 3000 });
    await user.click(screen.getByRole('checkbox', { name: 'Read-only' }));
    const saved1 = await saved(id);
    const item = saved1.item!.find((i) => i.linkId === 'n')!;
    expect(getExtension(item, STD_EXT.calculatedExpression)?.valueExpression).toEqual({
      language: 'text/fhirpath',
      expression: '1 + 41',
    });
    expect(item.readOnly).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'No default' }));
    const q2 = await saved(id);
    expect(q2.item!.find((i) => i.linkId === 'n')!.extension).toBeUndefined();
  });

  it('inserts answer references and evaluates against preview answers', async () => {
    const q = scored();
    q.item!.push({ linkId: 'flag', type: 'boolean', text: 'Flag' });
    const { user } = await open(q);
    await user.click(within(screen.getByRole('tree')).getByRole('treeitem', { name: /Flag/ }));
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Also require an expression to be true' }),
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Insert the answer to a question' }),
      'Question 1',
    );
    const editor = screen.getByRole('textbox', {
      name: 'Show this item only when this expression is true',
    }) as HTMLTextAreaElement;
    expect(editor.value).toBe("%resource.repeat(item).where(linkId='q1').answer.value");
    await waitFor(() => expect(screen.getByText('empty')).toBeTruthy(), { timeout: 3000 });
    const root = await previewRoot();
    await user.click(
      within(within(root).getByRole('group', { name: 'Question 1' })).getByRole('radio', {
        name: 'Yes',
      }),
    );
    await waitFor(() => expect(screen.getByText(/"code":"yes"/)).toBeTruthy(), { timeout: 3000 });
  });

  it('adds form variables and rules', async () => {
    const { id, user } = await open(scored());
    await user.click(screen.getByRole('button', { name: 'Add variable' }));
    const name = screen.getByRole('textbox', { name: 'Name of variable 1' });
    await user.clear(name);
    await user.type(name, '1abc');
    expect(screen.getByText(/letters, numbers and _ only/)).toBeTruthy();
    await user.clear(name);
    await user.type(name, 'total');
    await user.type(screen.getByRole('textbox', { name: 'Expression for variable 1' }), '1 + 1');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.type(screen.getByRole('textbox', { name: 'Rule 1 must be true' }), '%total = 2');
    const q = await saved(id);
    expect(q.extension?.find((e) => e.url === STD_EXT.variable)?.valueExpression).toEqual({
      name: 'total',
      language: 'text/fhirpath',
      expression: '1 + 1',
    });
    expect(
      q.extension
        ?.find((e) => e.url === STD_EXT.constraint)
        ?.extension?.map((e) => Object.values(e)[1]),
    ).toEqual(['rule-1', 'error', '%total = 2', 'This answer is not valid.']);
  });

  it('scoring wizard adds a total that the preview calculates', async () => {
    const { id, user } = await open(scored());
    await user.click(screen.getByRole('checkbox', { name: 'Question 2' }));
    await user.click(screen.getByRole('checkbox', { name: 'Question 2' }));
    await user.clear(screen.getByRole('textbox', { name: 'Score label' }));
    await user.type(screen.getByRole('textbox', { name: 'Score label' }), 'Mood score');
    await user.click(screen.getByRole('button', { name: 'Add total score' }));
    expect(
      screen.getByRole('heading', { level: 2, name: /Whole number\s+total-score-1/ }),
    ).toBeTruthy();
    const q = await saved(id);
    const total = q.item!.at(-1)!;
    expect(total).toMatchObject({
      linkId: 'total-score-1',
      type: 'integer',
      text: 'Mood score',
      readOnly: true,
    });
    expect(
      getExtension(total, STD_EXT.calculatedExpression)?.valueExpression?.expression,
    ).toContain('.weight().sum()');

    const root = await previewRoot();
    await waitFor(
      () => expect(within(root).getByRole('textbox', { name: 'Mood score' })).toBeTruthy(),
      { timeout: 3000 },
    );
    await user.click(
      within(within(root).getByRole('group', { name: 'Question 1' })).getByRole('radio', {
        name: 'Yes',
      }),
    );
    await user.click(
      within(within(root).getByRole('group', { name: 'Question 2' })).getByRole('radio', {
        name: 'Yes',
      }),
    );
    await waitFor(() =>
      expect(
        (within(root).getByRole('textbox', { name: 'Mood score' }) as HTMLInputElement).value,
      ).toBe('4'),
    );
  });

  it('sources options from an expression', async () => {
    const q = scored();
    q.item!.push({
      linkId: 'pick',
      type: 'choice',
      text: 'Pick',
      answerOption: [{ valueString: 'x' }],
    });
    const { id, user } = await open(q);
    await user.click(within(screen.getByRole('tree')).getByRole('treeitem', { name: /Pick/ }));
    await user.click(screen.getByRole('tab', { name: 'Answers' }));
    await user.click(screen.getByRole('radio', { name: /An expression/ }));
    await user.type(screen.getByRole('textbox', { name: 'Options expression' }), "'a' | 'b'");
    const saved1 = await saved(id);
    const item = saved1.item!.find((i) => i.linkId === 'pick')!;
    expect(item.answerOption).toBeUndefined();
    expect(getExtension(item, STD_EXT.answerExpression)?.valueExpression?.expression).toBe(
      "'a' | 'b'",
    );
  });
});

describe('Terminology in the builder', () => {
  it('searches codes on the configured server and adds them to the item', async () => {
    await repo.setSetting(SETTINGS.terminologyServer, 'https://tx.example.org/fhir');
    const { id, user } = await open(scored());
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    await user.type(await screen.findByRole('searchbox', { name: 'Search text' }), 'weight');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Add Body weight' }));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(
      'https://tx.example.org/fhir/ValueSet/$expand?url=http%3A%2F%2Floinc.org%2Fvs&filter=weight&count=20',
    );
    const q = await saved(id);
    expect(q.item![0]!.code).toEqual([
      { system: 'http://loinc.org', code: '29463-7', display: 'Body weight' },
    ]);
  });

  it('tells authors to configure a server before searching', async () => {
    const { user } = await open(scored());
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    expect(screen.getByText(/to search for codes/)).toBeTruthy();
  });

  it('tests the connection from Settings', async () => {
    window.location.hash = '#/settings';
    const user = userEvent.setup();
    render(
      <RepoContext value={repo}>
        <TerminologyClientContext value={new TerminologyClient(fetchMock)}>
          <App />
        </TerminologyClientContext>
      </RepoContext>,
    );
    await user.type(
      await screen.findByRole('textbox', { name: 'Default terminology server' }),
      'https://tx.example.org/fhir',
    );
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection works.')).toBeTruthy();
    expect(screen.getByText('Connected to Mock TX (FHIR 4.0.1).')).toBeTruthy();
  });
});

describe('DexieTerminologyCache', () => {
  it('expires entries after the TTL', async () => {
    let now = 0;
    const cache = new DexieTerminologyCache(repo.db, 1000, () => now);
    await cache.set('expand|https://s|vs', { codings: [] });
    expect(await cache.get('expand|https://s|vs')).toEqual({ codings: [] });
    expect((await repo.db.valueSetCache.get('expand|https://s|vs'))?.server).toBe('https://s');
    now = 2000;
    expect(await cache.get('expand|https://s|vs')).toBeUndefined();
  });
});
