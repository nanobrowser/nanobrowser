import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type { BaseStorage } from '../base/types';

export interface ProfileData {
  name?: string;
  age?: string;
  college?: string;
  job?: string;
  dateOfBirth?: string;
  address?: string;
  email?: string;
  phone?: string;
  [key: string]: string | undefined;
}

export interface ProfileStore extends BaseStorage<ProfileData> {
  setProfileData: (data: ProfileData) => Promise<void>;
  updateProfileField: (field: string, value: string) => Promise<void>;
  clearProfileData: () => Promise<void>;
}

// Create storage instance following the same pattern as chat history
const profileStorage = createStorage<ProfileData>(
  'user-profile-data',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const profileStore: ProfileStore = {
  ...profileStorage,

  setProfileData: async (data: ProfileData) => {
    await profileStorage.set(data);
  },

  updateProfileField: async (field: string, value: string) => {
    const currentData = await profileStorage.get();
    const updatedData = { ...currentData, [field]: value };
    await profileStorage.set(updatedData);
  },

  clearProfileData: async () => {
    await profileStorage.set({});
  },
};

// Export a singleton instance for direct use
export const useProfileStore = profileStore;
