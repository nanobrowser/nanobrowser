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

    // After the store update (which might have side effects, e.g., useVision affecting displayHighlights),
    // fetch the latest settings from the store and update the local state again to ensure UI consistency.
    const latestSettings = await generalSettingsStore.getSettings();
    setSettings(latestSettings);
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_general_header')}
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxSteps')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxSteps_desc')}
              </p>
            </div>
            <label htmlFor="maxSteps" className="sr-only">
              {t('options_general_maxSteps')}
            </label>
            <input
              id="maxSteps"
              type="number"
              min={1}
              max={50}
              value={settings.maxSteps}
              onChange={e => updateSetting('maxSteps', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxActions')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxActions_desc')}
              </p>
            </div>
            <label htmlFor="maxActionsPerStep" className="sr-only">
              {t('options_general_maxActions')}
            </label>
            <input
              id="maxActionsPerStep"
              type="number"
              min={1}
              max={50}
              value={settings.maxActionsPerStep}
              onChange={e => updateSetting('maxActionsPerStep', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxFailures')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxFailures_desc')}
              </p>
            </div>
            <label htmlFor="maxFailures" className="sr-only">
              {t('options_general_maxFailures')}
            </label>
            <input
              id="maxFailures"
              type="number"
              min={1}
              max={10}
              value={settings.maxFailures}
              onChange={e => updateSetting('maxFailures', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_enableVision')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_enableVision_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="useVision"
                type="checkbox"
                checked={settings.useVision}
                onChange={e => updateSetting('useVision', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="useVision"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{t('options_general_enableVision')}</span>
              </label>
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
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
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
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_minWaitPageLoad')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_minWaitPageLoad_desc')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="minWaitPageLoad" className="sr-only">
                {t('options_general_minWaitPageLoad')}
              </label>
              <input
                id="minWaitPageLoad"
                type="number"
                min={250}
                max={5000}
                step={50}
                value={settings.minWaitPageLoad}
                onChange={e => updateSetting('minWaitPageLoad', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_replayHistoricalTasks')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_replayHistoricalTasks_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="replayHistoricalTasks"
                type="checkbox"
                checked={settings.replayHistoricalTasks}
                onChange={e => updateSetting('replayHistoricalTasks', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="replayHistoricalTasks"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{t('options_general_replayHistoricalTasks')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
