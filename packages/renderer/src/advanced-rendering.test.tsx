import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuestionnaireResponse } from 'fhir/r4';
import { createFormEngineSync } from '@qb/core';
import { fixtures, golden } from '@qb/test-fixtures';
import { describe, expect, it, vi } from 'vitest';
import { QuestionnaireForm } from './components/QuestionnaireForm.js';
import { markdownToHtml } from './markdown.js';
import { parseRenderingStyle } from './css.js';
import { registerStrings } from './strings.js';

const setup = (props: Partial<Parameters<typeof QuestionnaireForm>[0]> = {}) => {
  const engine = createFormEngineSync(fixtures.advancedRendering());
  const onSubmit = vi.fn<(qr: QuestionnaireResponse) => void>();
  const user = userEvent.setup();
  render(<QuestionnaireForm engine={engine} onSubmit={onSubmit} {...props} />);
  return { engine, user, onSubmit };
};

describe('Advanced rendering (Phase 4 exit: scripted run matches the golden response)', () => {
  it('walks every page with pages, tables, tabs, collapsible, slider and spinner', async () => {
    const { engine, user, onSubmit } = setup();

    // ---- Page 1: header/footer, help, flyover, legal, prompt, support link, markdown, style
    expect(screen.getByText('Page 1 of 4')).toBeTruthy();
    expect(screen.getByText(/all answers are confidential/)).toBeTruthy();
    expect(screen.getByText(/Call 0800 000 000/)).toBeTruthy();
    const name = screen.getByRole('textbox', { name: /Preferred name/ });
    expect(name.getAttribute('aria-describedby')).toContain(
      screen.getByText('The name you like to be called').id,
    );
    expect(screen.getByText(/Health Information Privacy Code/).className).toContain('qb-legal');
    expect(screen.getByRole('button', { name: 'Help with Preferred name' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'More information about Preferred name' }),
    ).toBeTruthy();
    const support = screen.getByRole('link', {
      name: /More information about Preferred name \(opens in a new tab\)/,
    });
    expect(support.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('every').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'our privacy policy' }).getAttribute('href')).toBe(
      'https://example.org/privacy',
    );
    const important = screen.getByText('Important: bring your medicines.');
    expect(important.style.fontWeight).toBe('bold');
    expect(important.style.position).toBe('');

    // Next validates only this page.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const summary = await screen.findByRole('heading', { name: 'There is a problem' });
    expect(
      within(summary.parentElement!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Enter Preferred name']);
    expect(screen.getByText('Page 1 of 4')).toBeTruthy();
    await user.type(name, 'Aroha');

    const slider = screen.getByRole('slider', { name: 'Pain today' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Not answered');
    expect(slider.getAttribute('aria-describedby')).toMatch(/lower.*upper/);
    expect(screen.getByText('No pain')).toBeTruthy();
    fireEvent.change(slider, { target: { value: '7' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('7');
    expect(document.getElementById(slider.id.replace(/$/, '-value'))?.textContent).toBe('7');

    const temp = screen.getByRole('spinbutton', { name: 'Temperature' });
    expect([temp.getAttribute('min'), temp.getAttribute('max'), temp.getAttribute('step')]).toEqual(
      ['34', '43', '0.1'],
    );
    await user.type(temp, '37.5');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('heading', { name: 'There is a problem' })).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Page 2 of 4'));

    // ---- Page 2: table (matrix) and htable
    const matrix = screen.getByRole('table', { name: /how often did you have/ });
    expect(
      within(matrix)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Never', 'Sometimes', 'Often']);
    await user.click(within(matrix).getByRole('radio', { name: /A cough \(required\) Often/ }));
    await user.click(within(matrix).getByRole('radio', { name: 'A fever Never' }));
    await user.type(within(matrix).getByRole('textbox', { name: 'Anything else' }), 'Sore throat');
    const travel = screen.getByRole('table', { name: 'Recent travel' });
    await user.click(within(travel).getByRole('radio', { name: 'Overseas No' }));
    expect(within(travel).getByRole('radio', { name: 'Hospital visit Yes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('textbox', { name: /Preferred name/ })).toHaveProperty(
      'value',
      'Aroha',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // ---- Page 3: gtable with add/remove row
    const meds = screen.getByRole('table', { name: 'Medicines you take' });
    await user.type(within(meds).getByRole('textbox', { name: 'Name Row 1' }), 'Paracetamol');
    await user.type(within(meds).getByRole('textbox', { name: 'Dose Row 1' }), '500');
    await user.selectOptions(
      within(meds).getByRole('combobox', { name: 'How often Row 1' }),
      'As needed',
    );
    await user.selectOptions(
      within(meds).getByRole('combobox', { name: 'Still taking it Row 1' }),
      'Yes',
    );
    await user.click(screen.getByRole('button', { name: 'Add a row to medicines you take' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(meds).getByRole('textbox', { name: 'Name Row 2' }),
      ),
    );
    await user.keyboard('Aspirin');
    await user.click(screen.getByRole('button', { name: 'Add a row to medicines you take' }));
    await user.click(within(meds).getByRole('button', { name: 'Remove row 2' }));
    expect(within(meds).getAllByRole('row')).toHaveLength(3);
    await user.type(within(meds).getByRole('textbox', { name: 'Name Row 2' }), 'Ibuprofen');
    await user.type(within(meds).getByRole('textbox', { name: 'Dose Row 2' }), '200');
    await user.selectOptions(
      within(meds).getByRole('combobox', { name: 'How often Row 2' }),
      'Daily',
    );
    await user.selectOptions(
      within(meds).getByRole('combobox', { name: 'Still taking it Row 2' }),
      'No',
    );
    expect(
      screen.getByRole('region', { name: 'Medicines you take' }).getAttribute('tabindex'),
    ).toBe('0');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // ---- Page 4: grid, tab-container, collapsible
    const day = screen.getByRole('table', { name: 'Your day' });
    await user.type(within(day).getByRole('textbox', { name: 'Morning Steps' }), '3000');
    await user.selectOptions(within(day).getByRole('combobox', { name: 'Evening Mood' }), 'Good');

    const tablist = screen.getByRole('tablist', { name: 'Contacts' });
    const [doctor, nok] = within(tablist).getAllByRole('tab');
    expect(doctor!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Doctor' })).toBeTruthy();
    // No errors are shown for a page before it has been attempted.
    expect(doctor!.textContent).toBe('Doctor');
    await user.click(doctor!);
    await user.keyboard('{ArrowRight}');
    expect(nok!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(nok);

    const more = screen.getByRole('button', { name: 'More details (optional)' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(more.getAttribute('aria-controls')!)!.hidden).toBe(true);

    // Submit: errors in a hidden tab are counted on the tab and revealed from the summary.
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(doctor!.textContent).toContain('(1 problem)');
    await user.click(screen.getByRole('link', { name: "Enter Doctor's name" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Doctor's name/ })),
    );
    expect(doctor!.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('Dr Smith');

    // A field inside the collapsed group: the summary link opens it.
    await user.click(more);
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'abc');
    await user.click(more);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('link', { name: 'Notes must be 5 characters or more' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Notes' })),
    );
    expect(more.getAttribute('aria-expanded')).toBe('true');
    await user.clear(screen.getByRole('textbox', { name: 'Notes' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Feeling better');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const { authored: _a, ...qr } = onSubmit.mock.calls[0]![0];
    expect(qr).toEqual(golden.advancedRendering());
    expect(engine.getSnapshot().issues).toEqual([]);
  });

  it('links errors on other pages from the summary and switches page', async () => {
    const { engine, user } = setup();
    await user.type(screen.getByRole('textbox', { name: /Preferred name/ }), 'A');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(
      within(screen.getByRole('table', { name: /how often/ })).getByRole('radio', {
        name: /A cough \(required\) Never/,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByRole('textbox', { name: /Doctor's name/ }), 'Dr');
    // Earlier pages can become invalid later (expressions, host changes): here page 1 is cleared.
    engine.setAnswer('p1[0]/name[0]', []);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('link', { name: 'Enter Preferred name' }));
    expect(screen.getByText('Page 1 of 4')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Preferred name/ })),
    );
  });

  it('labels matrix inputs by row and column only (errors are descriptions)', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('textbox', { name: /Preferred name/ }), 'A');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByText('Enter A cough')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const radio = await screen.findByRole('radio', { name: 'A cough (required) Often' });
    expect(radio.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(radio.getAttribute('aria-describedby')!)!.textContent).toContain(
      'Enter A cough',
    );
  });

  it('shows translated content and locale UI strings', () => {
    registerStrings('mi', { next: 'Panuku', pageOf: (i, n) => `Whārangi ${i} o ${n}` });
    setup({ lang: 'mi' });
    expect(screen.getByRole('textbox', { name: /Ingoa e pai ana ki a koe/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Panuku' })).toBeTruthy();
    expect(screen.getByText('Whārangi 1 o 4')).toBeTruthy();
    // Unregistered strings fall back to en-NZ.
    expect(screen.getByRole('button', { name: /Help with Ingoa/ })).toBeTruthy();
  });

  it('shows all content without pages when read-only navigation is used', async () => {
    const { user } = setup({ readOnly: true });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 4')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'There is a problem' })).toBeNull();
  });
});

describe('markdown and rendering-style', () => {
  it.each([
    ['**b** and *i* and `c`', '<p><strong>b</strong> and <em>i</em> and <code>c</code></p>'],
    ['- one\n- two', '<ul><li>one</li><li>two</li></ul>'],
    ['1. one\n2. two', '<ol><li>one</li><li>two</li></ol>'],
    [
      '<script>x</script> [a](javascript:alert(1)) [b](https://x.org)',
      '<p>&lt;script&gt;x&lt;/script&gt; [a](javascript:alert(1)) <a href="https://x.org" rel="noopener noreferrer">b</a></p>',
    ],
    ['para one\n\npara two', '<p>para one</p><p>para two</p>'],
  ])('%s', (md, html) => {
    expect(markdownToHtml(md)).toBe(html);
  });

  it('keeps only safe style properties', () => {
    expect(
      parseRenderingStyle(
        'color: red; font-weight:bold; position: fixed; background: url(x); background-color: var(--x)',
      ),
    ).toEqual({ color: 'red', fontWeight: 'bold' });
    expect(parseRenderingStyle('display:none')).toBeUndefined();
  });
});
