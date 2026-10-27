import type { QuestionnaireItem } from 'fhir/r4';
import {
  BREAKPOINTS,
  DEFAULT_BREAKPOINT_WIDTHS,
  GRID_COLUMNS,
  getLayoutColumns,
  getRowBreak,
  resolveLayout,
  setLayoutColumns,
  setRowBreak,
  type Breakpoint,
  type LayoutColumn,
} from '@qb/extensions';
import { useEditor } from '../actions-context.js';
import { Checkbox } from '../../components/fields.js';

const describe = (bp: Breakpoint) =>
  bp === 'xs' ? 'narrower than 480px' : `${DEFAULT_BREAKPOINT_WIDTHS[bp]}px and wider`;

export function LayoutTab({ item }: { item: QuestionnaireItem }) {
  const { actions } = useEditor();
  const cols = getLayoutColumns(item);
  const resolved = resolveLayout(item);
  const byBp = new Map(cols.map((c) => [c.breakpoint, c]));
  const set = (bp: Breakpoint, patch: Partial<LayoutColumn> | null) =>
    actions.update(item.linkId, (i) => {
      const current = new Map(getLayoutColumns(i).map((c) => [c.breakpoint, c]));
      if (patch === null) current.delete(bp);
      else {
        const prev = current.get(bp) ?? { breakpoint: bp, span: resolveLayout(i)[bp].span };
        const next: LayoutColumn = { ...prev, ...patch };
        if (next.offset !== undefined && next.offset + next.span > GRID_COLUMNS)
          next.offset = GRID_COLUMNS - next.span;
        current.set(bp, next);
      }
      return setLayoutColumns(i, [...current.values()]);
    });

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <p>
        Place this item in its group's 12-column grid. Settings apply from a width upwards until a
        wider setting overrides them. Widths are measured against the form's container, not the
        browser window.
      </p>
      <table className="layout">
        <caption className="visually-hidden">
          Column span and offset at each container width
        </caption>
        <thead>
          <tr>
            <th scope="col">Container width</th>
            <th scope="col">Columns</th>
            <th scope="col">Offset</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {BREAKPOINTS.map((bp) => {
            const own = byBp.get(bp);
            const r = resolved[bp];
            const spanId = `span-${bp}`;
            return (
              <tr key={bp}>
                <th scope="row">
                  {bp} <span className="muted">({describe(bp)})</span>
                </th>
                <td>
                  <label className="visually-hidden" htmlFor={spanId}>
                    Columns at {bp}
                  </label>
                  <select
                    id={spanId}
                    value={own ? String(own.span) : ''}
                    onChange={(e) =>
                      set(bp, e.target.value ? { span: Number(e.target.value) } : null)
                    }
                  >
                    <option value="">
                      {bp === 'xs' ? 'Full width (12)' : `Same as smaller (${r.span})`}
                    </option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`offset-${bp}`}>
                    Offset at {bp}
                  </label>
                  <select
                    id={`offset-${bp}`}
                    value={String(own?.offset ?? 0)}
                    disabled={!own}
                    onChange={(e) => set(bp, { offset: Number(e.target.value) || 0 })}
                  >
                    {Array.from({ length: GRID_COLUMNS - (own?.span ?? 12) + 1 }, (_, i) => i).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ),
                    )}
                  </select>
                </td>
                <td>
                  <div className="ruler" aria-hidden="true">
                    {Array.from({ length: GRID_COLUMNS }, (_, i) => (
                      <span
                        key={i}
                        className={i >= r.offset && i < r.offset + r.span ? 'on' : undefined}
                      />
                    ))}
                  </div>
                  <span className="visually-hidden">
                    {r.span} of 12 columns{r.offset ? `, offset ${r.offset}` : ''}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Checkbox
        label="Start a new row"
        hint="Begin a new row even if there is room beside the previous item."
        checked={getRowBreak(item)}
        onChange={(v) => actions.update(item.linkId, (i) => setRowBreak(i, v))}
      />
      <p className="muted">
        Use the breakpoint buttons in the Web preview to check the result. Layout is ignored inside
        table and matrix groups.
      </p>
    </form>
  );
}
