import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Questionnaire } from 'fhir/r4';
import { TerminologyClient, type FetchLike } from '@qb/core';
import { STD_EXT, getExtension } from '@qb/extensions';
import '@qb/renderer/define';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures, populationData } from '@qb/test-fixtures';
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

describe('Advanced rendering settings', () => {
  it('sets collapsible, support links and slider step', async () => {
    const q: Questionnaire = {
      resourceType: 'Questionnaire',
      status: 'draft',
      title: 'Adv',
      item: [
        {
          linkId: 'g',
          type: 'group',
          text: 'Group',
          item: [{ linkId: 'pain', type: 'integer', text: 'Pain' }],
        },
      ],
    };
    const { id, user } = await open(q);
    const tree = screen.getByRole('tree');
    await user.click(within(tree).getByRole('treeitem', { name: /Group/ }));
    await user.click(screen.getByRole('tab', { name: 'Advanced' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Collapsible' }),
      'Collapsible, closed at first',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'More information links' }),
      'https://a.example{Enter}https://b.example',
    );
    await user.click(within(tree).getByRole('treeitem', { name: /Pain/ }));
    await user.click(screen.getByRole('tab', { name: 'Advanced' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Control' }), 'slider');
    await user.type(screen.getByRole('textbox', { name: 'Step' }), '2');
    const saved1 = await saved(id);
    const g = saved1.item![0]!;
    expect(getExtension(g, STD_EXT.collapsible)?.valueCode).toBe('default-closed');
    expect(
      g.extension?.filter((e) => e.url === STD_EXT.supportLink).map((e) => e.valueUri),
    ).toEqual(['https://a.example', 'https://b.example']);
    expect(getExtension(g.item![0]!, STD_EXT.sliderStepValue)?.valueInteger).toBe(2);
    const root = await previewRoot();
    const toggle = await waitFor(() => within(root).getByRole('button', { name: 'Group' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    await waitFor(() =>
      expect(within(root).getByRole('slider', { name: 'Pain' }).getAttribute('step')).toBe('2'),
    );
  });
});

describe('PDF in the builder', () => {
  it('edits print settings and generates a PDF preview', async () => {
    const q = scored();
    q.item!.push({
      linkId: 'notes',
      type: 'text',
      text: 'Notes',
      repeats: true,
      enableWhen: [{ question: 'q1', operator: 'exists', answerBoolean: true }],
    });
    const { id, user } = await open(q);
    await user.click(within(screen.getByRole('tree')).getByRole('treeitem', { name: /Notes/ }));
    await user.click(
      within(screen.getByRole('tablist', { name: 'Item settings' })).getByRole('tab', {
        name: 'PDF',
      }),
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Space to write the answer' }),
      'Open box',
    );
    await user.type(screen.getByRole('textbox', { name: 'Box height (mm)' }), '40');
    await user.type(screen.getByRole('textbox', { name: 'Blank copies to print' }), '2');
    await user.click(screen.getByRole('radio', { name: 'Use my own wording' }));
    const noteField = screen.getByRole('textbox', { name: 'Note text' });
    await user.clear(noteField);
    await user.type(noteField, 'Only if you answered question 1.');
    const saved1 = (await saved(id)).item!.find((i) => i.linkId === 'notes')!;
    expect(
      getExtension(
        saved1,
        'http://example.org/fhir/qb/StructureDefinition/qb-pdf-answer-space',
      )?.extension?.map((e) => e.valueCode ?? e.valueQuantity?.value),
    ).toEqual(['box', 40]);
    expect(
      getExtension(saved1, 'http://example.org/fhir/qb/StructureDefinition/qb-pdf-blank-repeats')
        ?.valuePositiveInt,
    ).toBe(2);
    expect(
      getExtension(saved1, 'http://example.org/fhir/qb/StructureDefinition/qb-pdf-condition-note')
        ?.valueMarkdown,
    ).toBe('Only if you answered question 1.');

    const preview = screen.getByRole('tablist', { name: 'Preview' });
    await user.click(within(preview).getByRole('tab', { name: 'PDF' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Text size' }),
      'Large print (150%)',
    );
    await user.click(screen.getByRole('button', { name: 'Generate PDF' }));
    const frame = await screen.findByTitle('PDF preview', {}, { timeout: 15000 });
    expect(frame.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('download')).toBe(
      'Mood.pdf',
    );
    expect(screen.getByRole('button', { name: 'Regenerate PDF' })).toBeTruthy();
  }, 30000);
});

describe('Population and extraction in the builder', () => {
  it('uses test data to pre-fill the preview and shows the extracted Bundle', async () => {
    const { id, user } = await open(fixtures.population());
    // Form settings lists the declared launch context.
    expect(
      (screen.getByRole('combobox', { name: 'Name of launch context 1' }) as HTMLSelectElement)
        .value,
    ).toBe('patient');

    const previewTabs = screen.getByRole('tablist', { name: 'Preview' });
    await user.click(within(previewTabs).getByRole('tab', { name: 'Test data' }));
    expect(screen.getByRole('note').textContent).toMatch(/made-up data only/);
    const data = populationData();
    const patient = screen.getByRole('textbox', { name: /%patient/ });
    await user.click(patient);
    await user.paste('{"resourceType":"Observation"}');
    await user.click(screen.getByRole('button', { name: 'Save test data' }));
    expect(screen.getByText('Expected Patient, got Observation.')).toBeTruthy();
    await user.clear(patient);
    await user.paste(JSON.stringify(data.find((r) => r.id === 'p1')));
    await user.click(screen.getByRole('textbox', { name: 'Resources on the test FHIR server' }));
    await user.paste(JSON.stringify(data.filter((r) => r.resourceType !== 'Patient')));
    await user.click(screen.getByRole('button', { name: 'Save test data' }));
    await waitFor(async () =>
      expect((await repo.getTestData(id))?.resources.patient).toMatchObject({ id: 'p1' }),
    );

    await user.click(within(previewTabs).getByRole('tab', { name: 'Web' }));
    const root = await previewRoot();
    await waitFor(() =>
      expect(
        (within(root).getByRole('textbox', { name: 'Given name' }) as HTMLInputElement).value,
      ).toBe('Aroha'),
    );
    expect(within(root).getAllByRole('textbox', { name: 'Condition' })).toHaveLength(2);

    await user.click(within(previewTabs).getByRole('tab', { name: 'Extract' }));
    await user.click(screen.getByRole('button', { name: 'Run extraction' }));
    expect(await screen.findByText(/2 resources: POST Observation, PUT Patient\/p1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Bundle' })).toBeTruthy();
  }, 30000);

  it('edits definition, observation and context settings', async () => {
    const { id, user } = await open(scored());
    const tree = screen.getByRole('tree');
    await user.click(within(tree).getByRole('treeitem', { name: /Question 1/ }));
    await user.click(
      within(screen.getByRole('tablist', { name: 'Item settings' })).getByRole('tab', {
        name: 'Advanced',
      }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Definition' }),
      'http://hl7.org/fhir/StructureDefinition/Observation#Observation.valueCodeableConcept',
    );
    await user.click(screen.getByRole('checkbox', { name: 'Save answers as Observations' }));
    await user.click(screen.getByRole('button', { name: 'Form settings' }));
    await user.click(screen.getByRole('button', { name: 'Add launch context' }));
    const q = await saved(id);
    expect(q.item![0]!.definition).toBe(
      'http://hl7.org/fhir/StructureDefinition/Observation#Observation.valueCodeableConcept',
    );
    expect(getExtension(q.item![0]!, STD_EXT.observationExtract)?.valueBoolean).toBe(true);
    expect(getExtension(q, STD_EXT.launchContext)?.extension?.[0]?.valueCoding?.code).toBe(
      'patient',
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
