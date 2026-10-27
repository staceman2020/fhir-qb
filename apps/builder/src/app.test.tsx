import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures } from '@qb/test-fixtures';
import { QB_EXT, getRenderChannel, resolveLayout } from '@qb/extensions';
import '@qb/renderer/define';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { RepoContext } from './context.js';
import { QbDatabase } from './db/db.js';
import { createRepository, type Repository } from './db/repository.js';
import { getItem } from './model/tree.js';

let n = 0;
let repo: Repository;

const renderApp = () =>
  render(
    <RepoContext value={repo}>
      <App />
    </RepoContext>,
  );

const openEditor = async (q = fixtures.enableWhen()) => {
  const id = await repo.create(q);
  window.location.hash = `#/edit/${id}`;
  const user = userEvent.setup();
  renderApp();
  await screen.findByRole('heading', { level: 1, name: q.title! });
  return { id, user };
};

const saved = async (id: string) => {
  await waitFor(async () => expect(screen.getByText('All changes saved')).toBeTruthy(), {
    timeout: 3000,
  });
  return (await repo.get(id))!.questionnaire;
};

beforeEach(() => {
  repo = createRepository(new QbDatabase(`ui-${n++}`));
  window.location.hash = '#/';
});
afterEach(() => vi.restoreAllMocks());

describe('Library', () => {
  it('creates a blank form and opens it', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByText(/No forms yet/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'New blank form' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled form' })).toBeTruthy();
    expect(window.location.hash).toMatch(/^#\/edit\//);
  });

  it('imports files, lists, searches and deletes forms', async () => {
    const user = userEvent.setup();
    renderApp();
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: fixtures.repeats() }, { resource: fixtures.nzPatient() }],
    };
    const good = new File([JSON.stringify(bundle)], 'forms.json', { type: 'application/json' });
    const bad = new File(['{"resourceType":"Patient"}'], 'patient.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText(/Import JSON/), [good, bad]);
    expect(await screen.findByText('Imported 2 forms.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'patient.json: Questionnaire is not a FHIR Questionnaire.',
    );
    expect(await screen.findByRole('link', { name: 'Household members' })).toBeTruthy();

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'pātai');
    expect(screen.queryByRole('link', { name: 'Household members' })).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete Household members' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Household members' })).toBeNull(),
    );
    expect((await repo.list()).map((r) => r.title)).toEqual([fixtures.nzPatient().title]);
  });

  it('starts from an example', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText(/No forms yet/);
    await user.selectOptions(screen.getByLabelText('Example'), 'Household members');
    await user.click(screen.getByRole('button', { name: 'Start from example' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Household members' }),
    ).toBeTruthy();
  });
});

describe('Editor', () => {
  it('shows the outline as an accessible tree with keyboard navigation and reordering', async () => {
    const { id, user } = await openEditor();
    const tree = screen.getByRole('tree', { name: 'Form items' });
    const items = within(tree).getAllByRole('treeitem');
    expect(items[0]!.textContent).toContain('Do you smoke?');
    await user.click(items[0]!);
    expect(screen.getByRole('heading', { level: 2, name: /Yes \/ no\s+smoker/ })).toBeTruthy();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('How many cigarettes');
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(within(tree).getAllByRole('treeitem')[0]!.textContent).toContain('How many cigarettes');
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Moved up')).toBeTruthy();

    // Collapse/expand a group with Left/Right.
    const group = within(tree).getByRole('treeitem', { name: /Contact details/ });
    await user.click(group);
    expect(group.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowLeft}');
    expect(within(tree).queryByRole('treeitem', { name: /Email address/ })).toBeNull();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement?.textContent).toContain('Email address');

    const q = await saved(id);
    expect(q.item?.[0]?.linkId).toBe('per-day');
  });

  it('adds, edits, deletes and undoes items', async () => {
    const { id, user } = await openEditor({
      resourceType: 'Questionnaire',
      status: 'draft',
      title: 'Blank',
      item: [],
    });
    expect(screen.getByText(/No items yet/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('New item type'), 'Choice');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const question = screen.getByRole('textbox', { name: 'Question' });
    await user.clear(question);
    await user.type(question, 'Favourite colour?');
    expect(within(screen.getByRole('tree')).getByRole('treeitem').textContent).toContain(
      'Favourite colour?',
    );

    await user.click(screen.getByRole('checkbox', { name: 'Required' }));
    await user.click(screen.getByRole('tab', { name: 'Answers' }));
    await user.clear(screen.getByRole('textbox', { name: 'Value 1' }));
    await user.type(screen.getByRole('textbox', { name: 'Value 1' }), 'Kākāriki');
    await user.click(screen.getByRole('button', { name: 'Add option' }));
    expect(screen.getByRole('textbox', { name: 'Value 3' })).toBeTruthy();

    let q = await saved(id);
    expect(q.item?.[0]).toMatchObject({
      type: 'choice',
      text: 'Favourite colour?',
      required: true,
    });
    expect(q.item?.[0]?.answerOption?.map((o) => o.valueString)).toEqual([
      'Kākāriki',
      'Option 2',
      'Option 3',
    ]);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Deleted Favourite colour\?/)).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(screen.getByRole('tree')).getByRole('treeitem').textContent).toContain(
      'Favourite colour?',
    );
    q = await saved(id);
    expect(q.item).toHaveLength(1);
  });

  it('renames linkIds safely and validates them', async () => {
    const { id, user } = await openEditor();
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    const field = screen.getByRole('textbox', { name: 'linkId' });
    await user.clear(field);
    await user.type(field, 'per-day');
    await user.tab();
    expect(screen.getByText('The linkId "per-day" is already used.')).toBeTruthy();
    await user.clear(field);
    await user.type(field, 'smokes{Enter}');
    await user.tab();
    const q = await saved(id);
    expect(q.item?.[0]?.linkId).toBe('smokes');
    expect(q.item?.[1]?.enableWhen?.[0]?.question).toBe('smokes');
  });

  it('builds enableWhen conditions typed to the target question', async () => {
    const { id, user } = await openEditor();
    await user.click(
      within(screen.getByRole('tree')).getByRole('treeitem', { name: /Talk to your doctor/ }),
    );
    await user.click(screen.getByRole('tab', { name: 'Behaviour' }));
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Question for condition 2' }),
      'How should we contact you? — contact',
    );
    expect(
      screen.getByRole('combobox', { name: 'Comparison for condition 2' }).textContent,
    ).not.toContain('greater');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Answer for condition 2' }),
      'Phone',
    );
    expect(screen.getByRole('group', { name: 'Combine conditions' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Any condition can be true' }));
    const q = await saved(id);
    const heavy = q.item?.find((i) => i.linkId === 'heavy');
    expect(heavy?.enableBehavior).toBe('any');
    expect(heavy?.enableWhen?.[1]).toEqual({
      question: 'contact',
      operator: '=',
      answerCoding: { system: 'http://example.org/contact', code: 'phone', display: 'Phone' },
    });
  });

  it('edits layout, channel and form settings', async () => {
    const { id, user } = await openEditor();
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    await user.click(screen.getByRole('tab', { name: 'Layout' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Columns at md' }), '6');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Offset at md' }), '3');
    await user.click(screen.getByRole('tab', { name: 'PDF' }));
    await user.click(screen.getByRole('radio', { name: /Web only/ }));
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!.textContent).toContain(
      'WEB',
    );

    await user.click(screen.getByRole('button', { name: 'Form settings' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Smoking');
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'bad name');
    expect(screen.getByText(/Start with a capital letter/)).toBeTruthy();

    const q = await saved(id);
    expect(resolveLayout(q.item![0]!).lg).toEqual({ span: 6, offset: 3 });
    expect(getRenderChannel(q.item![0]!)).toBe('web');
    expect(q.title).toBe('Smoking');
    expect(screen.getByRole('heading', { level: 1, name: 'Smoking' })).toBeTruthy();
  });

  it('adds a PDF-only instruction with the degradation flag', async () => {
    const { id, user } = await openEditor();
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    await user.click(screen.getByRole('tab', { name: 'PDF' }));
    await user.click(screen.getByRole('button', { name: 'Add PDF-only instruction' }));
    expect(
      screen.getByRole('heading', { level: 2, name: /Display text\s+smoker-pdf-1/ }),
    ).toBeTruthy();
    const q = await saved(id);
    const child = getItem(q, [0, 0])!;
    expect(child.extension?.map((e) => e.url)).toEqual([
      QB_EXT.renderChannel,
      'http://hl7.org/fhir/StructureDefinition/questionnaire-hidden',
    ]);
  });

  it('applies validated JSON edits', async () => {
    const { id, user } = await openEditor();
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    await user.click(screen.getByRole('tab', { name: 'JSON' }));
    const area = screen.getByRole('textbox', { name: 'Item JSON' });
    await user.clear(area);
    await user.click(area);
    await user.paste('{"linkId":"per-day","type":"string"}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toContain('linkId "per-day" is already used.');
    await user.clear(area);
    await user.paste('{"linkId":"smoker","type":"boolean","text":"Do you vape?","x-unknown":1}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const q = await saved(id);
    expect(q.item?.[0]).toEqual({
      linkId: 'smoker',
      type: 'boolean',
      text: 'Do you vape?',
      'x-unknown': 1,
    });
  });

  it('previews the form live, shows issues and saves/restores versions', async () => {
    const { id, user } = await openEditor();
    const el = await waitFor(() => {
      const found = document.querySelector('qb-questionnaire');
      expect(found?.shadowRoot?.querySelector('.qb-form')).toBeTruthy();
      return found!;
    });
    await user.click(
      within(el.shadowRoot as unknown as HTMLElement).getByRole('radio', { name: 'Yes' }),
    );
    await user.click(screen.getByRole('tab', { name: 'Response' }));
    await waitFor(() =>
      expect(screen.getByLabelText('QuestionnaireResponse JSON').textContent).toContain(
        '"valueBoolean": true',
      ),
    );

    await user.click(screen.getByRole('tab', { name: 'Issues (0)' }));
    expect(screen.getByText('No problems found.')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'History' }));
    await user.type(screen.getByRole('textbox', { name: 'Version label' }), 'First draft');
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(await screen.findByRole('cell', { name: 'First draft' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Form settings' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Changed');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Restore First draft' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Conditional questions' })).toBeTruthy();
    expect((await saved(id)).title).toBe('Conditional questions');
  });

  it('lists lint issues and navigates to the item', async () => {
    const q = fixtures.enableWhen();
    q.item!.push({ linkId: 'empty', type: 'group', text: 'Empty group' });
    const { user } = await openEditor(q);
    await user.click(screen.getByRole('tab', { name: /Issues \(1\)/ }));
    expect(screen.getByText('A group must have child items.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go to item empty' }));
    expect(screen.getByRole('heading', { level: 2, name: /Group\s+empty/ })).toBeTruthy();
    expect(
      within(screen.getByRole('treeitem', { name: /Empty group/ })).getByText(/error/),
    ).toBeTruthy();
  });

  it('switches to formatted text with a sanitised rendering-xhtml and plain fallback', async () => {
    const { id, user } = await openEditor();
    await user.click(within(screen.getByRole('tree')).getAllByRole('treeitem')[0]!);
    await user.click(screen.getByRole('checkbox', { name: 'Use formatted text' }));
    const editor = await screen.findByRole('textbox', { name: 'Text' });
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy();
    let q = await saved(id);
    expect(q.item?.[0]?._text?.extension?.[0]).toEqual({
      url: 'http://hl7.org/fhir/StructureDefinition/rendering-xhtml',
      valueString: '<p>Do you smoke?</p>',
    });
    expect(q.item?.[0]?.text).toBe('Do you smoke?');
    await user.click(screen.getByRole('checkbox', { name: 'Use formatted text' }));
    q = await saved(id);
    expect(q.item?.[0]?._text).toBeUndefined();
  });

  it('shows a not-found page for unknown ids', async () => {
    window.location.hash = '#/edit/nope';
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Form not found' })).toBeTruthy();
  });
});

describe('Settings', () => {
  it('validates and saves the default terminology server', async () => {
    window.location.hash = '#/settings';
    const user = userEvent.setup();
    renderApp();
    const field = await screen.findByRole('textbox', { name: 'Default terminology server' });
    await user.type(field, 'http://insecure');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Enter an https:// URL, or leave it empty.')).toBeTruthy();
    await user.clear(field);
    await user.type(field, 'https://tx.example.org/fhir/');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await act(async () => {});
    expect(await repo.getSetting('terminologyServer', '')).toBe('https://tx.example.org/fhir');
  });
});
