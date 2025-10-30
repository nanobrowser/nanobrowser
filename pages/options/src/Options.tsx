import { useState } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { GeneralSettings } from './components/GeneralSettings';
import { FirewallSettings } from './components/FirewallSettings';
import { ModelSettings } from './components/ModelSettings';

type TabTypes = 'general' | 'models' | 'firewall' | 'analytics' | 'help';

const TABS: { id: TabTypes; icon: string; label: string }[] = [
  { id: 'general', icon: '⚙️', label: t('options_tabs_general') },
  { id: 'firewall', icon: '🔒', label: t('options_tabs_firewall') },
  { id: 'models', icon: '🤖', label: t('options_tabs_models') },
];

const Options = () => {
  const [activeTab, setActiveTab] = useState<TabTypes>('models');

  const handleTabClick = (tabId: TabTypes) => {
    setActiveTab(tabId);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings isDarkMode={false} />;
      case 'firewall':
        return <FirewallSettings isDarkMode={false} />;
      case 'models':
        return <ModelSettings isDarkMode={false} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen min-w-[768px] bg-white text-gray-900">
      {/* Vertical Navigation Bar */}
      <nav className="w-48 border-r border-gray-300 bg-gray-50">
        <div className="p-4">
          <h1 className="mb-6 text-xl font-bold text-gray-900">{t('options_nav_header')}</h1>
          <ul className="space-y-2">
            {TABS.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base transition-colors
                    ${
                      activeTab !== item.id
                        ? 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                        : 'bg-gray-900 text-white border border-gray-900'
                    }`}>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 bg-white p-8">
        <div className="mx-auto min-w-[512px] max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
