import { useId } from 'react';
import type { Questionnaire } from 'fhir/r4';
import { diffQuestionnaires, type FieldChange, type ItemChange } from '../model/diff.js';
import { useStore } from '../state/hooks.js';

const KIND_TITLES: Record<ItemChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  moved: 'Moved',
};

function Changes({ changes, caption }: { changes: FieldChange[]; caption: string }) {
  return (
    <table className="list">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Setting</th>
          <th scope="col">Before</th>
          <th scope="col">Now</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c, i) => (
          <tr key={i}>
            <th scope="row">{c.field}</th>
            <td>{c.before}</td>
            <td>{c.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Item-aware comparison of a saved version with the current form (plan §9.2). */
export function VersionDiff({
  before,
  after,
  label,
  onClose,
}: {
  before: Questionnaire;
  after: Questionnaire;
  label: string;
  onClose: () => void;
}) {
  const store = useStore();
  const headingId = useId();
  const diff = diffQuestionnaires(before, after);
  const kinds = (['added', 'removed', 'changed', 'moved'] as const)
    .map((k) => ({ k, items: diff.items.filter((i) => i.kind === k) }))
    .filter((g) => g.items.length);
  const none = !diff.form.length && !kinds.length;
  return (
    <section aria-labelledby={headingId} className="notice" tabIndex={-1} ref={(el) => el?.focus()}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 id={headingId} style={{ margin: 0 }}>
          Changes since “{label}”
        </h3>
        <button type="button" onClick={onClose}>
          Close comparison
        </button>
      </div>
      {none && <p>No differences.</p>}
      {diff.form.length > 0 && (
        <>
          <h4>Form details</h4>
          <Changes changes={diff.form} caption="Form detail changes" />
        </>
      )}
      {kinds.map(({ k, items }) => (
        <div key={k}>
          <h4>
            {KIND_TITLES[k]} ({items.length})
          </h4>
          <ul>
            {items.map((it) => (
              <li key={`${k}-${it.linkId}`}>
                {k === 'removed' ? (
                  <>
                    {it.label} <code className="muted">{it.linkId}</code>
                  </>
                ) : (
                  <button type="button" className="link" onClick={() => store.select(it.linkId)}>
                    {it.label} <code className="muted">{it.linkId}</code>
                  </button>
                )}
                {it.changes.length > 0 && (
                  <Changes changes={it.changes} caption={`Changes to ${it.label}`} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
