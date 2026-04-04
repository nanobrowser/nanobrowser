import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Define the skill interface
export interface Skill {
  id: number;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Define the skills storage state
export interface SkillsStorageState {
  nextId: number;
  skills: Skill[];
}

// Define the interface for skills storage operations
export interface SkillsStorageOps {
  addSkill: (name: string, description: string, content: string) => Promise<Skill>;
  updateSkill: (
    id: number,
    updates: Partial<Pick<Skill, 'name' | 'description' | 'content' | 'enabled'>>,
  ) => Promise<Skill | undefined>;
  removeSkill: (id: number) => Promise<void>;
  getAllSkills: () => Promise<Skill[]>;
  getSkillById: (id: number) => Promise<Skill | undefined>;
  getEnabledSkills: () => Promise<Skill[]>;
  toggleSkill: (id: number) => Promise<Skill | undefined>;
}

// Initial state
const initialState: SkillsStorageState = {
  nextId: 1,
  skills: [],
};

// Create the skills storage
const skillsStorage: BaseStorage<SkillsStorageState> = createStorage('skills', initialState, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/**
 * Creates a storage interface for managing skills
 */
export function createSkillsStorage(): SkillsStorageOps {
  return {
    addSkill: async (name: string, description: string, content: string): Promise<Skill> => {
      const now = Date.now();

      await skillsStorage.set(prev => {
        const id = prev.nextId;
        const newSkill: Skill = {
          id,
          name,
          description,
          content,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        };

        return {
          nextId: id + 1,
          skills: [newSkill, ...prev.skills],
        };
      });

      return (await skillsStorage.get()).skills[0];
    },

    updateSkill: async (
      id: number,
      updates: Partial<Pick<Skill, 'name' | 'description' | 'content' | 'enabled'>>,
    ): Promise<Skill | undefined> => {
      let updatedSkill: Skill | undefined;
      const now = Date.now();

      await skillsStorage.set(prev => {
        const updatedSkills = prev.skills.map(skill => {
          if (skill.id === id) {
            updatedSkill = { ...skill, ...updates, updatedAt: now };
            return updatedSkill;
          }
          return skill;
        });

        if (!updatedSkill) {
          return prev;
        }

        return {
          ...prev,
          skills: updatedSkills,
        };
      });

      return updatedSkill;
    },

    removeSkill: async (id: number): Promise<void> => {
      await skillsStorage.set(prev => ({
        ...prev,
        skills: prev.skills.filter(skill => skill.id !== id),
      }));
    },

    getAllSkills: async (): Promise<Skill[]> => {
      const { skills } = await skillsStorage.get();
      return [...skills].sort((a, b) => b.createdAt - a.createdAt);
    },

    getSkillById: async (id: number): Promise<Skill | undefined> => {
      const { skills } = await skillsStorage.get();
      return skills.find(skill => skill.id === id);
    },

    getEnabledSkills: async (): Promise<Skill[]> => {
      const { skills } = await skillsStorage.get();
      return skills.filter(skill => skill.enabled).sort((a, b) => b.createdAt - a.createdAt);
    },

    toggleSkill: async (id: number): Promise<Skill | undefined> => {
      let toggledSkill: Skill | undefined;

      await skillsStorage.set(prev => {
        const updatedSkills = prev.skills.map(skill => {
          if (skill.id === id) {
            toggledSkill = { ...skill, enabled: !skill.enabled, updatedAt: Date.now() };
            return toggledSkill;
          }
          return skill;
        });

        if (!toggledSkill) {
          return prev;
        }

        return {
          ...prev,
          skills: updatedSkills,
        };
      });

      return toggledSkill;
    },
  };
}

// Export the raw storage for subscribe/get access
export { skillsStorage };

// Export a default instance
export default createSkillsStorage();
