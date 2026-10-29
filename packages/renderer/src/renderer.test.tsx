import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Questionnaire, QuestionnaireResponse } from 'fhir/r4';
import { createFormEngineSync, createMemoryFhirClient } from '@qb/core';
import { fixtures, mockAdaptiveServer, modular, populationData } from '@qb/test-fixtures';
import { describe, expect, it, vi } from 'vitest';
import { QuestionnaireForm } from './components/QuestionnaireForm.js';
import { fromLocalDateTime, toLocalDateTime } from './components/controls.js';
import { defineQbQuestionnaire, QbQuestionnaireElement } from './element.js';
import { sanitizeXhtml } from './sanitize.js';

const setup = (q: Questionnaire, props: Partial<Parameters<typeof QuestionnaireForm>[0]> = {}) => {
  const engine = createFormEngineSync(q);
  const user = userEvent.setup();
  const utils = render(<QuestionnaireForm engine={engine} {...props} />);
  return { engine, user, ...utils };
};

describe('QuestionnaireForm', () => {
  it('renders every R4 item type with accessible labels', () => {
    setup(fixtures.allTypes());
    expect(screen.getByRole('heading', { name: 'All item types' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^String/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Boolean' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Green' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Pears' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /contained ValueSet/ })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Weight unit' })).toBeTruthy();
    expect(screen.getByLabelText('Attachment')).toBeTruthy();
    expect(screen.getByLabelText('Date')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Basic types' }).tagName).toBe('FIELDSET');
    expect(screen.getByText('(required)')).toBeTruthy();
  });

  it('writes answers to the engine for each control', async () => {
    const { engine, user } = setup(fixtures.allTypes());
    await user.type(screen.getByRole('textbox', { name: /^String/ }), 'Kia ora');
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.type(screen.getByRole('textbox', { name: 'Integer' }), '42');
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: /contained ValueSet/ }),
      "Don't know",
    );
    await user.type(screen.getByRole('textbox', { name: 'Weight' }), '72.5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Weight unit' }), 'lb');
    const n = (p: string) => engine.getNode(p)?.answers;
    expect(n('basics[0]/string[0]')).toEqual([{ valueString: 'Kia ora' }]);
    expect(n('basics[0]/boolean[0]')).toEqual([{ valueBoolean: true }]);
    expect(n('basics[0]/integer[0]')).toEqual([{ valueInteger: 42 }]);
    expect(n('choices[0]/choice[0]')?.[0]?.valueCoding?.code).toBe('blue');
    expect(n('choices[0]/choice-vs[0]')?.[0]?.valueCoding?.code).toBe('asked-unknown');
    expect(n('other[0]/quantity[0]')).toEqual([
      {
        valueQuantity: {
          value: 72.5,
          unit: 'lb',
          system: 'http://unitsofmeasure.org',
          code: '[lb_av]',
        },
      },
    ]);
  });

  it('honours optionExclusive in checkbox groups', async () => {
    const { engine, user } = setup(fixtures.allTypes());
    await user.click(screen.getByRole('checkbox', { name: 'Apples' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pears' }));
    await user.click(screen.getByRole('checkbox', { name: 'None of these' }));
    expect(engine.getNode('choices[0]/choice-multi[0]')?.answers).toEqual([
      { valueString: 'None of these' },
    ]);
    await user.click(screen.getByRole('checkbox', { name: 'Apples' }));
    expect(engine.getNode('choices[0]/choice-multi[0]')?.answers).toEqual([
      { valueString: 'Apples' },
    ]);
  });

  it('supports open-choice "Other" text', async () => {
    const { engine, user } = setup(fixtures.allTypes());
    const group = screen.getByRole('group', { name: 'Open choice' });
    await user.click(within(group).getByRole('radio', { name: 'Other' }));
    await user.type(within(group).getByRole('textbox'), 'Ferry');
    expect(engine.getNode('choices[0]/open-choice[0]')?.answers).toEqual([
      { valueString: 'Ferry' },
    ]);
    await user.click(within(group).getByRole('radio', { name: 'Bus' }));
    expect(engine.getNode('choices[0]/open-choice[0]')?.answers).toEqual([{ valueString: 'Bus' }]);
  });

  it('keeps invalid numeric text, reports it and clears it once fixed', async () => {
    const { engine, user } = setup(fixtures.allTypes());
    const input = screen.getByRole('textbox', { name: 'Integer' }) as HTMLInputElement;
    await user.type(input, '12a');
    expect(input.value).toBe('12a');
    expect(engine.getSnapshot().inputErrors.get('basics[0]/integer[0]')).toBe(
      'Integer must be a whole number',
    );
    await user.type(input, '{Backspace}');
    expect(engine.getNode('basics[0]/integer[0]')?.answers).toEqual([{ valueInteger: 12 }]);
    expect(engine.getSnapshot().inputErrors.size).toBe(0);
  });

  it('shows and hides conditional items', async () => {
    const { user } = setup(fixtures.enableWhen());
    expect(screen.queryByRole('textbox', { name: /cigarettes/ })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByRole('textbox', { name: /cigarettes/ })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByRole('textbox', { name: /cigarettes/ })).toBeNull();
  });

  it('renders disabled items as protected when disabledDisplay=protected', () => {
    setup(fixtures.enableWhen(), { disabledDisplay: 'protected' });
    const input = screen.getByRole('textbox', { name: /cigarettes/ }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getAllByText(/Not applicable/).length).toBeGreaterThan(0);
  });

  it('shows an error summary on submit, links to fields, and submits once valid', async () => {
    const onSubmit = vi.fn<(qr: QuestionnaireResponse) => void>();
    const { user } = setup(fixtures.enableWhen(), { onSubmit });
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = screen.getByRole('heading', { name: 'There is a problem' }).parentElement!;
    expect(document.activeElement).toBe(summary);
    const link = within(summary).getByRole('link', { name: 'Enter How many cigarettes a day' });
    await user.click(link);
    const input = screen.getByRole('textbox', { name: /cigarettes/ });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(
      screen.getByText('Enter How many cigarettes a day', { selector: 'p' }).id,
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(input, '5');
    expect(screen.queryByRole('heading', { name: 'There is a problem' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]![0].status).toBe('completed');
  });

  it('adds and removes repeating groups and repeating answers', async () => {
    const { engine, user } = setup(fixtures.repeats());
    await user.click(screen.getByRole('button', { name: 'Add another household member' }));
    expect(screen.getByRole('group', { name: 'Household member (2)' })).toBeTruthy();
    await user.type(
      within(screen.getByRole('group', { name: 'Household member (2)' })).getByRole('textbox', {
        name: /Name/,
      }),
      'Tama',
    );
    await user.click(screen.getByRole('button', { name: 'Remove Household member 1' }));
    expect(screen.queryByRole('group', { name: /Household member \(/ })).toBeNull();
    // Focus moves to the "Add another" button rather than being lost with the removed instance.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Add another household member' }),
      ),
    );
    expect(engine.getNode('member[1]/member-name[0]')?.answers).toEqual([{ valueString: 'Tama' }]);

    await user.type(screen.getByRole('textbox', { name: 'Nicknames' }), 'Rua');
    await user.click(screen.getByRole('button', { name: 'Add another nicknames' }));
    await user.type(screen.getByRole('textbox', { name: 'Nicknames 2' }), 'Bub');
    expect(engine.getNode('nicknames[0]')?.answers).toEqual([
      { valueString: 'Rua' },
      { valueString: 'Bub' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Remove Nicknames 1' }));
    expect(engine.getNode('nicknames[0]')?.answers).toEqual([{ valueString: 'Bub' }]);
  });

  it('filters channel content and puts itemControl=help behind a disclosure button', async () => {
    const { user } = setup(fixtures.channelContent());
    expect(screen.queryByText(/CAPITAL LETTERS/)).toBeNull();
    expect(screen.queryByText(/one character per box/)).toBeNull();
    expect(screen.getByText(/saved as you type/)).toBeTruthy();
    expect(screen.queryByLabelText('Office use')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'NHI number' })).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Help with NHI number' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(true);
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('prescriptions and hospital letters');
  });

  it('sets grid placement custom properties and row breaks', () => {
    const { container } = setup(fixtures.layoutGrid());
    const cell = (linkId: string) =>
      container.querySelector<HTMLElement>(`[data-linkid="${linkId}"]`)!;
    expect(cell('given-name').style.getPropertyValue('--qb-t-md')).toBe('6');
    expect(cell('given-name').style.getPropertyValue('--qb-t-xs')).toBe('12');
    expect(cell('title').style.getPropertyValue('--qb-t-lg')).toBe('6');
    expect(cell('title').style.getPropertyValue('--qb-o-lg')).toBe('3');
    expect(cell('title').classList.contains('qb-row-break')).toBe(true);
    expect(cell('name').getAttribute('style')).toBeNull();
  });

  it('renders sanitised rendering-xhtml', () => {
    setup({
      resourceType: 'Questionnaire',
      status: 'draft',
      item: [
        {
          linkId: 'd',
          type: 'display',
          text: 'plain',
          _text: {
            extension: [
              {
                url: 'http://hl7.org/fhir/StructureDefinition/rendering-xhtml',
                valueString: '<b>Bold</b><img src=x onerror="alert(1)">',
              },
            ],
          },
        },
      ],
    });
    const b = screen.getByText('Bold');
    expect(b.tagName).toBe('B');
    expect(document.querySelector('[onerror]')).toBeNull();
  });

  it('is fully read-only when readOnly', () => {
    setup(fixtures.allTypes(), { readOnly: true });
    expect((screen.getByRole('textbox', { name: /^String/ }) as HTMLInputElement).readOnly).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: 'Green' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });
});

describe('sanitizeXhtml', () => {
  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<p onclick="x()" style="color:red">t</p>', '<p>t</p>'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    [
      '<a href="https://example.org">x</a>',
      '<a href="https://example.org" rel="noopener noreferrer">x</a>',
    ],
    ['<iframe src="https://evil"></iframe><custom>kept text</custom>', 'kept text'],
    ['<img src="data:image/svg+xml;base64,AAA" alt="a">', '<img alt="a">'],
    ['<svg><script>x</script></svg>t', 't'],
    [
      '<table><tr><td colspan="2" bgcolor="red">c</td></tr></table>',
      '<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>',
    ],
  ])('%s', (input, expected) => {
    expect(sanitizeXhtml(input)).toBe(expected);
  });
});

describe('dateTime conversion', () => {
  it('round-trips local input with an offset', () => {
    const fhir = fromLocalDateTime('2026-10-27T09:30')!;
    expect(fhir).toMatch(/^2026-10-27T09:30:00[+-]\d{2}:\d{2}$/);
    expect(toLocalDateTime(fhir)).toBe('2026-10-27T09:30');
    expect(toLocalDateTime('2026-10-27')).toBe('');
  });
});

describe('<qb-questionnaire>', () => {
  defineQbQuestionnaire();

  const mount = async (q: Questionnaire, attrs: Record<string, string> = {}) => {
    const el = document.createElement('qb-questionnaire');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const ready = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('qb-ready', (e) => resolve(e as CustomEvent), { once: true }),
    );
    document.body.append(el);
    await act(async () => {
      el.questionnaire = q;
      await ready;
    });
    return el;
  };

  it('registers idempotently and supports custom tag names', () => {
    expect(defineQbQuestionnaire()).toBe(QbQuestionnaireElement);
    const Custom = defineQbQuestionnaire('acme-form');
    expect(customElements.get('acme-form')).toBe(Custom);
    expect(defineQbQuestionnaire('acme-form')).toBe(Custom);
  });

  it('renders into an open shadow root with styles and no light-DOM leakage', async () => {
    const el = await mount(fixtures.enableWhen());
    const root = el.shadowRoot!;
    expect(root.querySelector('.qb-form')).toBeTruthy();
    const css =
      root.adoptedStyleSheets
        .flatMap((sheet) => [...sheet.cssRules].map((r) => r.cssText))
        .join('\n') ||
      (root.querySelector('style')?.textContent ?? '');
    expect(css).toContain('@container qb');
    expect(el.children.length).toBe(0);
    expect(document.querySelector('.qb-form')).toBeNull();
    el.remove();
  });

  it('emits composed qb-change, qb-validate and qb-submit events and exposes the response', async () => {
    const el = await mount(fixtures.enableWhen());
    const root = el.shadowRoot!;
    const changes: CustomEvent[] = [];
    document.addEventListener('qb-change', (e) => changes.push(e as CustomEvent));
    const user = userEvent.setup();
    await user.click(within(root as unknown as HTMLElement).getByRole('radio', { name: 'No' }));
    await act(async () => {});
    expect(changes.at(-1)?.detail.response.item[0]).toEqual({
      linkId: 'smoker',
      text: 'Do you smoke?',
      answer: [{ valueBoolean: false }],
    });
    expect(el.getQuestionnaireResponse({ status: 'completed' })?.status).toBe('completed');

    el.engine!.setAnswer('smoker[0]', [{ valueBoolean: true }]);
    const validated = vi.fn();
    el.addEventListener('qb-validate', validated);
    let issues: ReturnType<typeof el.validate> = [];
    act(() => {
      issues = el.validate();
    });
    expect(issues.map((i) => i.code)).toEqual(['required']);
    expect(validated).toHaveBeenCalledOnce();
    expect(root.activeElement?.classList.contains('qb-error-summary')).toBe(true);

    const submitted = vi.fn();
    el.addEventListener('qb-submit', submitted);
    await act(async () => el.engine!.setAnswer('per-day[0]', [{ valueInteger: 3 }]));
    await user.click(
      within(root as unknown as HTMLElement).getByRole('button', { name: 'Submit' }),
    );
    expect(submitted).toHaveBeenCalledOnce();
    expect((submitted.mock.calls[0]![0] as CustomEvent).composed).toBe(true);
    el.remove();
  });

  it('populates from launch context and a FHIR client, and extracts a transaction Bundle', async () => {
    const el = document.createElement('qb-questionnaire');
    const data = populationData();
    el.launchContext = { patient: data.find((r) => r.id === 'p1')! };
    el.fhirClient = createMemoryFhirClient(data);
    const ready = new Promise((r) => el.addEventListener('qb-ready', r, { once: true }));
    document.body.append(el);
    await act(async () => {
      el.questionnaire = fixtures.population();
      await ready;
    });
    const root = el.shadowRoot! as unknown as HTMLElement;
    await waitFor(() =>
      expect(
        (within(root).getByRole('textbox', { name: 'Given name' }) as HTMLInputElement).value,
      ).toBe('Aroha'),
    );
    expect(
      within(root)
        .getAllByRole('textbox', { name: 'Condition' })
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Asthma', 'Type 2 diabetes']);
    expect(el.getQuestionnaireResponse()?.subject).toEqual({ reference: 'Patient/p1' });
    const bundle = await el.extract();
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry?.map((e) => e.request?.url)).toEqual(['Observation', 'Patient/p1']);
    // Changing the launch context re-populates.
    const rebuilt = new Promise((r) => el.addEventListener('qb-ready', r, { once: true }));
    await act(async () => {
      el.launchContext = { patient: data.find((r) => r.id === 'p2')! };
      await rebuilt;
    });
    await waitFor(() =>
      expect(
        (within(root).getByRole('textbox', { name: 'Given name' }) as HTMLInputElement).value,
      ).toBe('Tama'),
    );
    el.remove();
  });

  it('assembles modular forms with resolveCanonical', async () => {
    const el = document.createElement('qb-questionnaire');
    el.resolveCanonical = modular.resolver();
    const ready = new Promise((r) => el.addEventListener('qb-ready', r, { once: true }));
    document.body.append(el);
    await act(async () => {
      el.questionnaire = modular.root();
      await ready;
    });
    const root = el.shadowRoot! as unknown as HTMLElement;
    expect(within(root).getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(within(root).queryByText(/Insert http/)).toBeNull();
    expect(el.engine!.questionnaire.item?.some((i) => i.linkId === 'demo-dob')).toBe(true);
    el.remove();
  });

  it('runs an adaptive form question by question', async () => {
    const el = document.createElement('qb-questionnaire');
    el.fhirClient = mockAdaptiveServer();
    document.body.append(el);
    const submitted = vi.fn();
    el.addEventListener('qb-submit', submitted);
    await act(async () => el.startAdaptive('http://example.org/fhir/qb/Questionnaire/wellbeing'));
    const root = el.shadowRoot! as unknown as HTMLElement;
    const user = userEvent.setup();
    await waitFor(() =>
      expect(within(root).getByRole('group', { name: /How are you feeling today/ })).toBeTruthy(),
    );
    expect(within(root).queryByRole('button', { name: 'Submit' })).toBeNull();
    // A required question must be answered before asking for the next one.
    await user.click(within(root).getByRole('button', { name: 'Next question' }));
    await waitFor(() => expect(within(root).getByText('There is a problem')).toBeTruthy());
    await user.click(within(root).getByRole('radio', { name: 'Not good' }));
    await user.click(within(root).getByRole('button', { name: 'Next question' }));
    const sleep = await within(root).findByRole('group', { name: /trouble sleeping/ });
    await waitFor(() =>
      expect(root.activeElement).toBe(within(sleep).getByRole('radio', { name: 'Yes' })),
    );
    await user.click(within(sleep).getByRole('radio', { name: 'Yes' }));
    await user.click(within(root).getByRole('button', { name: 'Next question' }));
    const hoursBox = await within(root).findByRole('textbox', { name: /hours/ });
    // user-event typing inside a shadow root does not reach React's onChange in jsdom (a
    // user-event limitation; clicks work). fireEvent.change exercises the same handler.
    fireEvent.change(hoursBox, { target: { value: '5' } });
    await user.click(within(root).getByRole('button', { name: 'Next question' }));
    const submit = await within(root).findByRole('button', { name: 'Submit' });
    await user.click(submit);
    const qr = (submitted.mock.calls[0]![0] as CustomEvent).detail.response;
    expect(qr.status).toBe('completed');
    expect(qr.questionnaire).toBe('#adaptive');
    expect(qr.contained[0].item.map((i: { linkId: string }) => i.linkId)).toEqual([
      'mood',
      'sleep',
      'hours',
    ]);
    expect(qr.item.map((i: { linkId: string }) => i.linkId)).toEqual(['mood', 'sleep', 'hours']);
    el.remove();
  }, 20000);

  it('reports adaptive service errors', async () => {
    const el = document.createElement('qb-questionnaire');
    el.fhirClient = {
      baseUrl: 'https://x',
      fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    };
    document.body.append(el);
    const errors = vi.fn();
    el.addEventListener('qb-error', errors);
    await act(async () => el.startAdaptive('http://example.org/a'));
    expect(errors).toHaveBeenCalledOnce();
    el.remove();
  });

  it('exports a blank or pre-filled PDF', async () => {
    const el = await mount(fixtures.enableWhen());
    el.engine!.setAnswer('smoker[0]', [{ valueBoolean: true }]);
    el.engine!.setAnswer('per-day[0]', [{ valueInteger: 12 }]);
    const blank = await el.exportPdf();
    expect(blank.type).toBe('application/pdf');
    const head = new TextDecoder().decode(new Uint8Array(await blank.arrayBuffer()).slice(0, 8));
    expect(head).toBe('%PDF-1.7');
    const filled = await el.exportPdf({ prefilled: true, pageSize: 'Letter' });
    expect(filled.size).toBeGreaterThan(0);
    expect(filled.size).not.toBe(blank.size);
    el.remove();
  }, 20000);

  it('resumes from questionnaireResponse and reflects attributes', async () => {
    const el = document.createElement('qb-questionnaire');
    el.questionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      status: 'in-progress',
      item: [{ linkId: 'smoker', answer: [{ valueBoolean: true }] }],
    };
    el.setAttribute('readonly', '');
    el.setAttribute('hide-title', '');
    const ready = new Promise((r) => el.addEventListener('qb-ready', r, { once: true }));
    document.body.append(el);
    await act(async () => {
      el.questionnaire = fixtures.enableWhen();
      await ready;
    });
    const root = el.shadowRoot!;
    expect((root.querySelector('input[type=radio]') as HTMLInputElement).checked).toBe(true);
    expect(root.querySelector('.qb-title')).toBeNull();
    expect(root.querySelector('button[type=submit]')).toBeNull();
    expect((root.querySelector('input[inputmode=numeric]') as HTMLInputElement).readOnly).toBe(
      true,
    );
    el.remove();
  });

  it('reports invalid input via qb-error; PDF export needs a questionnaire', async () => {
    const el = document.createElement('qb-questionnaire');
    document.body.append(el);
    const error = new Promise<CustomEvent>((r) =>
      el.addEventListener('qb-error', (e) => r(e as CustomEvent), { once: true }),
    );
    await act(async () => {
      el.questionnaire = { resourceType: 'Patient' } as unknown as Questionnaire;
    });
    expect(((await error).detail.error as Error).name).toBe('TypeError');
    await expect(el.exportPdf()).rejects.toThrow('No questionnaire loaded');
    el.remove();
  });
});
