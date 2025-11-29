import { useState, useEffect } from 'react';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';
import { useStorage } from '@extension/shared';
import { profileStore } from '@extension/storage/lib/stores/profileStore';

interface ProfileSettingsProps {
  isDarkMode: boolean;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({ isDarkMode }) => {
  // Use the useStorage hook for reactive updates
  const profileData = useStorage(profileStore);
  const [formData, setFormData] = useState(profileData);

  useEffect(() => {
    setFormData(profileData);
  }, [profileData]);

  const handleFieldChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    await profileStore.setProfileData(formData);
  };

  const handleClear = async () => {
    await profileStore.clearProfileData();
    setFormData({});
  };

  const fields = [
    { key: 'name', label: 'Full Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone Number' },
    { key: 'dateOfBirth', label: 'Date of Birth' },
    { key: 'address', label: 'Address' },
    { key: 'college', label: 'College/University' },
    { key: 'job', label: 'Job Title' },
    { key: 'age', label: 'Age' },
  ];

  return (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Profile Settings</h2>
      <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Store your personal information to automatically fill forms across websites.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map(field => (
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

      <div className="flex space-x-4">
        <Button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          Save Profile
        </Button>
        <Button onClick={handleClear} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">
          Clear All Data
        </Button>
      </div>
    </div>
  );
};
