import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Questionnaire, QuestionnaireItem } from 'fhir/r4';
import { TerminologyClient, createFormEngine, type EngineOptions, type FetchLike } from '@qb/core';
import { STD_EXT } from '@qb/extensions';
import { fixtures, golden } from '@qb/test-fixtures';
import { describe, expect, it, vi } from 'vitest';
import { QuestionnaireForm } from './components/QuestionnaireForm.js';

const SERVER = 'https://tx.example.org/fhir';
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const conditions = Array.from({ length: 60 }, (_, i) => ({
  system: 'http://snomed.info/sct',
  code: String(1000 + i),
  display: `Condition ${i}`,
}));
const conditions2 = [
  { system: 'http://snomed.info/sct', code: '195967001', display: 'Asthma' },
  { system: 'http://snomed.info/sct', code: '233678006', display: 'Childhood asthma' },
];

/** Mock FHIR terminology server: small "smoking" VS, large "conditions" VS with filter, and $lookup. */
function mockServer() {
  return vi.fn<FetchLike>(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/CodeSystem/$lookup'))
      return u.searchParams.get('code') === '195967001'
        ? json({
            resourceType: 'Parameters',
            parameter: [{ name: 'display', valueString: 'Asthma' }],
          })
        : json({}, 404);
    const vs = u.searchParams.get('url');
    const filter = u.searchParams.get('filter')?.toLowerCase();
    if (vs === 'http://example.org/vs/smoking')
      return json({
        resourceType: 'ValueSet',
        expansion: {
          total: 3,
          contains: ['Never', 'Former', 'Current'].map((d, i) => ({
            system: 'urn:smoking',
            code: String(i),
            display: d,
          })),
        },
      });
    if (vs === 'http://example.org/vs/conditions') {
      const all = [...conditions2, ...conditions];
      const hits = filter ? all.filter((c) => c.display.toLowerCase().includes(filter)) : all;
      return json({
        resourceType: 'ValueSet',
        expansion: {
          total: hits.length,
          contains: hits.slice(0, Number(u.searchParams.get('count') ?? 100)),
        },
      });
    }
    return json(
      { resourceType: 'OperationOutcome', issue: [{ diagnostics: 'Unknown value set' }] },
      404,
    );
  });
}

async function setup(
  q: Questionnaire,
  opts: EngineOptions = { terminology: { defaultServer: SERVER } },
  fetchFn = mockServer(),
) {
  const engine = await createFormEngine(q, opts);
  const user = userEvent.setup();
  render(<QuestionnaireForm engine={engine} terminologyClient={new TerminologyClient(fetchFn)} />);
  return { engine, user, fetchFn };
}

const form = (item: QuestionnaireItem[]): Questionnaire => ({
  resourceType: 'Questionnaire',
  status: 'draft',
  item,
});

describe('expressions in the renderer', () => {
  it('PHQ-9: answering updates the read-only total and announces it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine, user } = await setup(fixtures.phq9());
      const total = screen.getByRole('textbox', { name: /total score/ }) as HTMLInputElement;
      expect(total.readOnly).toBe(true);
      const { script, response } = golden.phq9();
      for (const [linkId, code] of Object.entries(script)) {
        const label = engine.definitions.byLinkId.get(linkId)!.item.text!;
        const group = screen.getByRole('group', { name: label });
        const display = engine.definitions.byLinkId
          .get(linkId)!
          .item.answerOption!.find((o) => o.valueCoding?.code === code)!.valueCoding!.display!;
        await user.click(within(group).getByRole('radio', { name: display }));
      }
      expect(total.value).toBe('10');
      await act(async () => vi.advanceTimersByTime(1100));
      expect(
        screen.getByText('Patient health questionnaire 9 item total score updated to 10'),
      ).toBeTruthy();
      const { authored: _a, ...qr } = engine.getResponse({ status: 'completed' });
      expect(qr).toEqual(response);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides options toggled off by answerOptionsToggleExpression', async () => {
    const q = form([
      { linkId: 'adult', type: 'boolean', text: 'Adult?' },
      {
        linkId: 'job',
        type: 'choice',
        text: 'Occupation',
        answerOption: [{ valueString: 'Student' }, { valueString: 'Employed' }],
        extension: [
          {
            url: STD_EXT.answerOptionsToggleExpression,
            extension: [
              { url: 'option', valueString: 'Employed' },
              {
                url: 'expression',
                valueExpression: {
                  language: 'text/fhirpath',
                  expression: "%resource.item.where(linkId='adult').answer.value = true",
                },
              },
            ],
          },
        ],
      },
    ]);
    const { user } = await setup(q);
    const group = screen.getByRole('group', { name: 'Occupation' });
    expect(within(group).queryByRole('radio', { name: 'Employed' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(within(group).getByRole('radio', { name: 'Employed' })).toBeTruthy();
  });
});

describe('terminology in the renderer', () => {
  it('shows a small external value set as a normal option list', async () => {
    const { engine, user, fetchFn } = await setup(
      form([
        {
          linkId: 'smoking',
          type: 'choice',
          text: 'Smoking status',
          answerValueSet: 'http://example.org/vs/smoking',
        },
      ]),
    );
    expect(screen.getByText('Loading options…')).toBeTruthy();
    const radio = await screen.findByRole('radio', { name: 'Former' });
    expect(screen.getByRole('group', { name: 'Smoking status' })).toBeTruthy();
    await user.click(radio);
    expect(engine.getNode('smoking[0]')?.answers).toEqual([
      { valueCoding: { system: 'urn:smoking', code: '1', display: 'Former' } },
    ]);
    expect(fetchFn.mock.calls[0]![0]).toContain(
      `${SERVER}/ValueSet/$expand?url=http%3A%2F%2Fexample.org%2Fvs%2Fsmoking&count=31`,
    );
  });

  it('searches a large value set with an accessible combobox', async () => {
    const q = form([
      {
        linkId: 'dx',
        type: 'choice',
        text: 'Diagnosis',
        answerValueSet: 'http://example.org/vs/conditions',
      },
    ]);
    const { engine, user } = await setup(q);
    const input = await screen.findByRole('combobox', { name: 'Diagnosis' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await user.type(input, 'a');
    await waitFor(() =>
      expect(
        screen.getByText('Type at least 2 characters to search', { selector: '[role=status]' }),
      ).toBeTruthy(),
    );
    await user.type(input, 'sth');
    const listbox = await screen.findByRole('listbox', { name: 'Diagnosis' });
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(2));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('2 results available', { selector: '[role=status]' })).toBeTruthy();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = within(listbox).getByRole('option', { name: 'Childhood asthma' });
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
    expect(active.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    expect(engine.getNode('dx[0]')?.answers).toEqual([{ valueCoding: conditions2[1] }]);
    expect((input as HTMLInputElement).value).toBe('Childhood asthma');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('supports multiple selections as removable chips, and Escape', async () => {
    const q = form([
      {
        linkId: 'dx',
        type: 'choice',
        repeats: true,
        text: 'Conditions',
        answerValueSet: 'http://example.org/vs/conditions',
        extension: [
          {
            url: STD_EXT.itemControl,
            valueCodeableConcept: { coding: [{ code: 'autocomplete' }] },
          },
        ],
      },
    ]);
    const { engine, user } = await setup(q);
    const input = screen.getByRole('combobox', { name: 'Conditions' });
    await user.type(input, 'condition 1');
    await screen.findByRole('option', { name: 'Condition 10' });
    await user.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(engine.getNode('dx[0]')?.answers).toHaveLength(1);
    expect((input as HTMLInputElement).value).toBe('');
    await user.type(input, 'asthma');
    await user.click(await screen.findByRole('option', { name: 'Asthma' }));
    const chips = screen.getByRole('list', { name: 'Selected answers for Conditions' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Condition 1', 'Asthma']);
    await user.click(within(chips).getByRole('button', { name: 'Remove Condition 1' }));
    expect(engine.getNode('dx[0]')?.answers?.map((a) => a.valueCoding?.display)).toEqual([
      'Asthma',
    ]);
  });

  it('accepts free text for open-choice', async () => {
    const q = form([
      {
        linkId: 'dx',
        type: 'open-choice',
        text: 'Diagnosis',
        answerValueSet: 'http://example.org/vs/conditions',
        extension: [
          {
            url: STD_EXT.itemControl,
            valueCodeableConcept: { coding: [{ code: 'autocomplete' }] },
          },
        ],
      },
    ]);
    const { engine, user } = await setup(q);
    await user.type(screen.getByRole('combobox', { name: 'Diagnosis' }), 'Something rare{Enter}');
    expect(engine.getNode('dx[0]')?.answers).toEqual([{ valueString: 'Something rare' }]);
  });

  it('looks up the display of a stored code without one', async () => {
    const q = form([
      {
        linkId: 'dx',
        type: 'choice',
        text: 'Diagnosis',
        answerValueSet: 'http://example.org/vs/conditions',
      },
    ]);
    await setup(q, {
      terminology: { defaultServer: SERVER },
      response: {
        resourceType: 'QuestionnaireResponse',
        status: 'in-progress',
        item: [
          {
            linkId: 'dx',
            answer: [{ valueCoding: { system: 'http://snomed.info/sct', code: '195967001' } }],
          },
        ],
      },
    });
    const input = (await screen.findByRole('combobox', { name: 'Diagnosis' })) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Asthma'));
  });

  it('explains when no server is configured or the server fails', async () => {
    await setup(
      form([
        { linkId: 'a', type: 'choice', text: 'A', answerValueSet: 'http://example.org/vs/smoking' },
      ]),
      {},
    );
    expect(screen.getByText(/No terminology server is set up/)).toBeTruthy();
    await setup(
      form([
        { linkId: 'b', type: 'choice', text: 'B', answerValueSet: 'http://example.org/vs/missing' },
      ]),
    );
    expect(await screen.findByText(/returned 404: Unknown value set/)).toBeTruthy();
  });

  it('uses the item-level preferredTerminologyServer and host override (plan §7.6)', async () => {
    const q = form([
      {
        linkId: 'g',
        type: 'group',
        extension: [
          { url: STD_EXT.preferredTerminologyServer, valueUrl: 'https://item-level.example.org' },
        ],
        item: [
          {
            linkId: 's',
            type: 'choice',
            text: 'S',
            answerValueSet: 'http://example.org/vs/smoking',
          },
        ],
      },
    ]);
    const a = await setup(q);
    await screen.findByRole('radio', { name: 'Never' });
    expect(a.fetchFn.mock.calls[0]![0]).toMatch(/^https:\/\/item-level\.example\.org\/ValueSet/);
    const b = await setup(q, {
      terminology: { defaultServer: SERVER, serverOverride: 'https://proxy.example.org' },
    });
    await waitFor(() => expect(b.fetchFn).toHaveBeenCalled());
    expect(b.fetchFn.mock.calls[0]![0]).toMatch(/^https:\/\/proxy\.example\.org\//);
  });

  it('loads quantity units from a unitValueSet', async () => {
    const q = form([
      {
        linkId: 'w',
        type: 'quantity',
        text: 'Amount',
        extension: [{ url: STD_EXT.unitValueSet, valueCanonical: 'http://example.org/vs/smoking' }],
      },
    ]);
    await setup(q);
    const unit = await screen.findByRole('combobox', { name: 'Amount unit' });
    await waitFor(() =>
      expect(
        within(unit)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Never', 'Former', 'Current']),
    );
  });
});
