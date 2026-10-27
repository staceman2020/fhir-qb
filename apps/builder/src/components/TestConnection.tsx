import { useState } from 'react';
import { useTerminologyClient } from '../terminology.js';

/** "Test connection" (plan §7.6): /metadata plus a sample $expand, with CORS failures explained. */
export function TestConnection({ server }: { server: string }) {
  const client = useTerminologyClient();
  const [state, setState] = useState<{ ok: boolean; messages: string[] } | 'testing'>();
  return (
    <div className="field">
      <button
        type="button"
        disabled={!server || state === 'testing'}
        onClick={async () => {
          setState('testing');
          setState(await client.testConnection(server));
        }}
      >
        Test connection
      </button>
      <div
        role="status"
        className={
          state && state !== 'testing' ? (state.ok ? 'notice' : 'notice error') : undefined
        }
        style={{ marginTop: '0.5rem' }}
      >
        {state === 'testing' ? (
          <p>Testing {server}…</p>
        ) : state ? (
          <>
            <p>
              <strong>{state.ok ? 'Connection works.' : 'Connection problem.'}</strong>
            </p>
            <ul>
              {state.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
