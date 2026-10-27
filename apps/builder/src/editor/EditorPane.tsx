import { useState } from 'react';
import { isChoice, typeLabel } from '../model/items.js';
import { useSelectedItem } from '../state/hooks.js';
import { Tabs } from '../components/Tabs.js';
import { FormSettings } from './FormSettings.js';
import { BasicTab } from './tabs/BasicTab.js';
import { AnswersTab } from './tabs/AnswersTab.js';
import { BehaviourTab } from './tabs/BehaviourTab.js';
import { LayoutTab } from './tabs/LayoutTab.js';
import { PdfTab } from './tabs/PdfTab.js';
import { AdvancedTab } from './tabs/AdvancedTab.js';
import { JsonTab } from './tabs/JsonTab.js';

export function EditorPane() {
  const sel = useSelectedItem();
  const [tab, setTab] = useState('basic');
  if (!sel)
    return (
      <section className="pane" aria-labelledby="editor-heading">
        <h2 id="editor-heading">Form settings</h2>
        <FormSettings />
      </section>
    );
  const { item } = sel;
  const props = { item, key: item.linkId };
  const tabs = [
    { id: 'basic', label: 'Basic', content: () => <BasicTab {...props} /> },
    ...(isChoice(item.type)
      ? [{ id: 'answers', label: 'Answers', content: () => <AnswersTab {...props} /> }]
      : []),
    { id: 'behaviour', label: 'Behaviour', content: () => <BehaviourTab {...props} /> },
    { id: 'layout', label: 'Layout', content: () => <LayoutTab {...props} /> },
    { id: 'pdf', label: 'PDF', content: () => <PdfTab {...props} /> },
    { id: 'advanced', label: 'Advanced', content: () => <AdvancedTab {...props} /> },
    { id: 'json', label: 'JSON', content: () => <JsonTab {...props} /> },
  ];
  return (
    <section className="pane" aria-labelledby="editor-heading">
      <h2 id="editor-heading">
        {typeLabel(item.type)} <code className="muted">{item.linkId}</code>
      </h2>
      <Tabs
        label="Item settings"
        tabs={tabs}
        active={tabs.some((t) => t.id === tab) ? tab : 'basic'}
        onChange={setTab}
      />
    </section>
  );
}
