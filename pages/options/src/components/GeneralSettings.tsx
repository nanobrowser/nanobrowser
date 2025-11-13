import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { t } from '@extension/i18n';

interface GeneralSettingsProps {
  isDarkMode?: boolean;
}

export const GeneralSettings = ({ isDarkMode = false }: GeneralSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    // Load initial settings
    generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(key: K, value: GeneralSettingsConfig[K]) => {
    // Optimistically update the local state for responsiveness
    setSettings(prevSettings => ({ ...prevSettings, [key]: value }));

    // Call the store to update the setting
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);

    // After the store update (which might trigger side effects), fetch the latest settings
    // to ensure the UI reflects persisted values.
    const latestSettings = await generalSettingsStore.getSettings();
    setSettings(latestSettings);
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
          {t('options_general_header')}
        </h2>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className={`rounded-md border ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-gray-200 bg-gray-50'} p-4`}>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                {t('options_general_maxSteps')}
              </h3>
              <p className={`mt-1 text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxSteps_desc')}
              </p>
              <p className={`mt-3 text-sm font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                {t('options_general_fixedValue', [settings.maxSteps.toString()])}
              </p>
            </div>

            <div className={`rounded-md border ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-gray-200 bg-gray-50'} p-4`}>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                {t('options_general_maxActions')}
              </h3>
              <p className={`mt-1 text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxActions_desc')}
              </p>
              <p className={`mt-3 text-sm font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                {t('options_general_fixedValue', [settings.maxActionsPerStep.toString()])}
              </p>
            </div>

            <div className={`rounded-md border ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-gray-200 bg-gray-50'} p-4`}>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                {t('options_general_maxFailures')}
              </h3>
              <p className={`mt-1 text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxFailures_desc')}
              </p>
              <p className={`mt-3 text-sm font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                {t('options_general_fixedValue', [settings.maxFailures.toString()])}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_displayHighlights')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_displayHighlights_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="displayHighlights"
                type="checkbox"
                checked={settings.displayHighlights}
                onChange={e => updateSetting('displayHighlights', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="displayHighlights"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-gray-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-gray-300`}>
                <span className="sr-only">{t('options_general_displayHighlights')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_planningInterval')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_planningInterval_desc')}
              </p>
            </div>
            <label htmlFor="planningInterval" className="sr-only">
              {t('options_general_planningInterval')}
            </label>
            <input
              id="planningInterval"
              type="number"
              min={1}
              max={20}
              value={settings.planningInterval}
              onChange={e => updateSetting('planningInterval', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${
                isDarkMode
                  ? 'border-slate-600 bg-[#f7f7f7] text-[#333333]'
                  : 'border-gray-300 bg-[#f7f7f7] text-[#333333]'
              } px-3 py-2`}
            />
          </div>

        </div>
      </div>
    </section>
  );
};
