import { useState } from 'react';
import { SessionTab } from './tabs/SessionTab';
import { ChecksTab } from './tabs/ChecksTab';
import { ObserveTab } from './tabs/ObserveTab';
import { ScenariosTab } from './tabs/ScenariosTab';
import { ActTab } from './tabs/ActTab';
import { LogTab } from './tabs/LogTab';
import { PromptsTab } from './tabs/PromptsTab';

const TABS = [
  { id: 'session', label: 'Session', render: () => <SessionTab /> },
  { id: 'observe', label: 'Observe', render: () => <ObserveTab /> },
  { id: 'act', label: 'Act', render: () => <ActTab /> },
  { id: 'scenarios', label: 'Scenarios', render: () => <ScenariosTab /> },
  { id: 'prompts', label: 'Prompts', render: () => <PromptsTab /> },
  { id: 'log', label: 'Log', render: () => <LogTab /> },
  { id: 'checks', label: 'Checks', render: () => <ChecksTab /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  // A hash such as #checks opens that tab, so a panel page can be opened directly on it.
  const [active, setActive] = useState<TabId>(() => TABS.find(t => t.id === location.hash.slice(1))?.id ?? 'session');
  const current = TABS.find(t => t.id === active) ?? TABS[0];
  return (
    <div className="flex h-screen flex-col">
      <nav className="flex shrink-0 gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`rounded-t px-3 py-1.5 ${
              tab.id === active ? 'border border-b-0 border-slate-200 bg-white font-medium' : 'text-slate-600'
            }`}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-auto p-3">{current.render()}</main>
    </div>
  );
}
