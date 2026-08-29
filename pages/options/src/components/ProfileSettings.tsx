import { useState, useEffect } from 'react';
import { profileStore, type ProfileData } from '@extension/storage/lib/stores/profileStore';
import { useStorage } from '@extension/shared';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';
import { FiPlus, FiTrash2 } from 'react-icons/fi';

interface ProfileSettingsProps {
  isDarkMode: boolean;
}

interface CustomField {
  key: string;
  label: string;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({ isDarkMode }) => {
  const profileData = useStorage(profileStore);
  const [formData, setFormData] = useState<ProfileData>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [saved, setSaved] = useState(false);

  // Predefined fields
  const predefinedFields = [
    { key: 'name', label: 'Full Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone Number' },
    { key: 'dateOfBirth', label: 'Date of Birth' },
    { key: 'address', label: 'Address' },
    { key: 'college', label: 'College/University' },
    { key: 'job', label: 'Job Title' },
    { key: 'age', label: 'Age' },
  ];

  useEffect(() => {
    setFormData(profileData);

    // Extract custom fields from profile data
    const customKeys = Object.keys(profileData).filter(key => !predefinedFields.find(field => field.key === key));
    setCustomFields(customKeys.map(key => ({ key, label: key })));
  }, [profileData]);

  const handleFieldChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    await profileStore.setProfileData(formData);

    setSaved(true);

    setTimeout(() => {
      setSaved(false);
    }, 3000);
  };

  const handleClear = async () => {
    await profileStore.clearProfileData();
    setFormData({});
    setCustomFields([]);
  };

  // Convert label to key (e.g., "Passport Number" -> "passport_number")
  const labelToKey = (label: string): string => {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  };

  const addCustomField = () => {
    if (newFieldLabel.trim()) {
      const fieldKey = labelToKey(newFieldLabel);

      // Check if field already exists
      if (predefinedFields.find(f => f.key === fieldKey) || customFields.find(f => f.key === fieldKey)) {
        alert('A field with this name already exists!');
        return;
      }

      setCustomFields(prev => [...prev, { key: fieldKey, label: newFieldLabel.trim() }]);
      setFormData(prev => ({ ...prev, [fieldKey]: '' }));
      setNewFieldLabel('');
    }
  };

  const removeCustomField = (key: string) => {
    setCustomFields(prev => prev.filter(field => field.key !== key));
    setFormData(prev => {
      const newData = { ...prev };
      delete newData[key];
      return newData;
    });
  };

  return (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Profile Settings</h2>
      <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Store your personal information to automatically fill forms across websites.
      </p>

      {/* Predefined Fields */}
      <div>
        <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Basic Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {predefinedFields.map(field => (
            <div key={field.key}>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {field.label}
              </label>
              <input
                type="text"
                value={formData[field.key] || ''}
                onChange={e => handleFieldChange(field.key, e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDarkMode ? 'bg-slate-700 border-slate-600 text-gray-200' : 'bg-white border-gray-300 text-gray-900'
                }`}
                placeholder={`Enter your ${field.label.toLowerCase()}`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Custom Fields */}
      <div>
        <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Custom Fields
        </h3>

        {/* Add new custom field */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newFieldLabel}
            onChange={e => setNewFieldLabel(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && addCustomField()}
            className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isDarkMode ? 'bg-slate-700 border-slate-600 text-gray-200' : 'bg-white border-gray-300 text-gray-900'
            }`}
            placeholder="Enter field name (e.g., Passport Number, LinkedIn Profile)"
          />
          <Button
            onClick={addCustomField}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center gap-2">
            <FiPlus />
            Add
          </Button>
        </div>

        {/* Custom fields list */}
        {customFields.length > 0 ? (
          <div className="space-y-3">
            {customFields.map(field => (
              <div key={field.key} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={field.label}
                  readOnly
                  className={`w-1/3 px-3 py-2 border rounded-md ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-600 text-gray-300'
                      : 'bg-gray-50 border-gray-300 text-gray-700'
                  }`}
                  placeholder="Field name"
                />
                <input
                  type="text"
                  value={formData[field.key] || ''}
                  onChange={e => handleFieldChange(field.key, e.target.value)}
                  className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDarkMode
                      ? 'bg-slate-700 border-slate-600 text-gray-200'
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                />
                <Button
                  onClick={() => removeCustomField(field.key)}
                  className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center justify-center">
                  <FiTrash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            No custom fields added yet. Add fields specific to your needs above.
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <Button
          onClick={handleSave}
          className={`px-4 py-2 rounded-md transition-all duration-300
            ${saved ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}
            text-white
          `}>
          {saved ? 'Data Saved' : 'Save Data'}
        </Button>
        <Button onClick={handleClear} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">
          Clear All Data
        </Button>
      </div>
    </div>
  );
};
