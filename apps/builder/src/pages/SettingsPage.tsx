import { useEffect, useState } from 'react';
import { useRepo } from '../context.js';
import { SETTINGS } from '../db/repository.js';
import { TextField } from '../components/fields.js';
import { download } from '../download.js';
import { TestConnection } from '../components/TestConnection.js';

const fmtBytes = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${Math.round(n / 1e3)} KB`;

export function SettingsPage() {
  const repo = useRepo();
  const [server, setServer] = useState('');
  const [saved, setSaved] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [error, setError] = useState<string>();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number }>();
  const [persisted, setPersisted] = useState<boolean>();

  useEffect(() => {
    void repo.getSetting(SETTINGS.terminologyServer, '').then(setServer);
    void navigator.storage
      ?.estimate?.()
      .then((e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [repo]);

  const save = async () => {
    const v = server.trim();
    if (v && !/^https:\/\/\S+$/.test(v)) {
      setError('Enter an https:// URL, or leave it empty.');
      return;
    }
    setError(undefined);
    await repo.setSetting(SETTINGS.terminologyServer, v.replace(/\/+$/, ''));
    setSaved('Settings saved.');
  };

  const pct = estimate && estimate.quota ? estimate.usage / estimate.quota : 0;
  return (
    <div className="page">
      <h1>Settings</h1>
      <section aria-labelledby="tx-heading">
        <h2 id="tx-heading">Terminology</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          style={{ maxWidth: '36rem' }}
        >
          <TextField
            label="Default terminology server"
            hint="Used when a form does not name its own server. It must be an open (no login) FHIR server that allows cross-origin requests."
            type="url"
            value={server}
            error={error}
            onChange={(v) => {
              setServer(v);
              setSaved('');
            }}
          />
          <button type="submit" className="primary">
            Save settings
          </button>
          <p role="status">{saved}</p>
        </form>
        <TestConnection server={server.trim().replace(/\/+$/, '')} />
      </section>

      <section aria-labelledby="storage-heading">
        <h2 id="storage-heading">Storage</h2>
        <p>
          Forms, versions and settings are stored only in this browser. Clearing site data deletes
          them.
        </p>
        {estimate ? (
          <p className={pct >= 0.8 ? 'notice warning' : undefined}>
            Using {fmtBytes(estimate.usage)} of about {fmtBytes(estimate.quota)} available (
            {Math.round(pct * 100)}%).
            {pct >= 0.8 && ' Storage is nearly full: export and delete forms you no longer need.'}
          </p>
        ) : (
          <p className="muted">Storage usage is not available in this browser.</p>
        )}
        {persisted ? (
          <p>This browser will keep your data even when storage runs low.</p>
        ) : (
          <button
            type="button"
            onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}
            disabled={!navigator.storage?.persist}
          >
            Ask the browser to keep data permanently
          </button>
        )}
        {persisted === false && (
          <p className="muted">The browser has not granted permanent storage yet.</p>
        )}
        <h3>Terminology cache</h3>
        <p>
          Code lists fetched from terminology servers are kept for a week so forms open quickly.
        </p>
        <button
          type="button"
          onClick={async () => {
            await repo.db.valueSetCache.clear();
            setSaved('Terminology cache cleared.');
          }}
        >
          Clear terminology cache
        </button>
      </section>
      <section aria-labelledby="backup-heading">
        <h2 id="backup-heading">Backup</h2>
        <p>
          Download everything (forms, saved versions, test data and settings) as one file, or
          restore from such a file. Keep backups somewhere safe: they may contain test data.
        </p>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              const b = await repo.exportBackup();
              download(
                `qb-backup-${b.exportedAt.slice(0, 10)}.json`,
                `${JSON.stringify(b, null, 2)}\n`,
                'application/json',
              );
              setBackupStatus(
                `Backup downloaded: ${b.questionnaires.length} form${b.questionnaires.length === 1 ? '' : 's'}.`,
              );
            }}
          >
            Download backup
          </button>
          <div className="field">
            <label htmlFor="restore-file">Restore from a backup file</label>
            <input
              id="restore-file"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                try {
                  const data = JSON.parse(await file.text()) as { questionnaires?: unknown[] };
                  const n = Array.isArray(data.questionnaires) ? data.questionnaires.length : 0;
                  if (
                    !window.confirm(
                      `Restore ${n} form${n === 1 ? '' : 's'} from this backup? Forms with the same id are replaced.`,
                    )
                  )
                    return;
                  const r = await repo.importBackup(data);
                  setBackupStatus(
                    `Restored ${r.forms} form${r.forms === 1 ? '' : 's'} and ${r.versions} saved version${r.versions === 1 ? '' : 's'}.`,
                  );
                } catch (err) {
                  setBackupStatus(`Could not restore: ${(err as Error).message}`);
                } finally {
                  input.value = '';
                }
              }}
            />
          </div>
        </div>
        <p role="status">{backupStatus}</p>
      </section>
    </div>
  );
}
