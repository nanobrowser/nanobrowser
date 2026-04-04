import { useState, useEffect, useRef } from 'react';
import { t } from '@extension/i18n';
import type { Skill } from '@extension/storage';
import skillsStorage from '@extension/storage/lib/skills/skills';
import { FiPlus, FiEdit2, FiTrash2, FiUpload } from 'react-icons/fi';

interface SkillsSettingsProps {
  isDarkMode?: boolean;
}

interface SkillFormState {
  name: string;
  description: string;
  content: string;
}

const emptyForm: SkillFormState = {
  name: '',
  description: '',
  content: '',
};

export const SkillsSettings = ({ isDarkMode = false }: SkillsSettingsProps) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<number | null>(null);
  const [form, setForm] = useState<SkillFormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof SkillFormState, string>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load skills on mount
  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    const allSkills = await skillsStorage.getAllSkills();
    setSkills(allSkills);
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof SkillFormState, string>> = {};
    if (!form.name.trim()) {
      newErrors.name = t('options_skills_validation_nameRequired');
    }
    if (!form.content.trim()) {
      newErrors.content = t('options_skills_validation_contentRequired');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAdd = () => {
    setForm(emptyForm);
    setEditingSkillId(null);
    setIsEditing(true);
    setErrors({});
  };

  const handleEdit = (skill: Skill) => {
    setForm({
      name: skill.name,
      description: skill.description,
      content: skill.content,
    });
    setEditingSkillId(skill.id);
    setIsEditing(true);
    setErrors({});
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditingSkillId(null);
    setForm(emptyForm);
    setErrors({});
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    if (editingSkillId !== null) {
      await skillsStorage.updateSkill(editingSkillId, {
        name: form.name.trim(),
        description: form.description.trim(),
        content: form.content.trim(),
      });
    } else {
      await skillsStorage.addSkill(form.name.trim(), form.description.trim(), form.content.trim());
    }

    setIsEditing(false);
    setEditingSkillId(null);
    setForm(emptyForm);
    setErrors({});
    await loadSkills();
  };

  const handleDelete = async (id: number) => {
    await skillsStorage.removeSkill(id);
    await loadSkills();
  };

  const handleToggle = async (id: number) => {
    await skillsStorage.toggleSkill(id);
    await loadSkills();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async e => {
      const text = e.target?.result as string;
      try {
        if (file.name.endsWith('.json')) {
          const json = JSON.parse(text);
          if (!json.name || !json.content) {
            alert(t('options_skills_import_invalidJson'));
            return;
          }
          await skillsStorage.addSkill(json.name, json.description || '', json.content);
        } else if (file.name.endsWith('.md')) {
          let name = file.name.replace(/\.[^/.]+$/, ''); // Default to filename
          let description = '';
          let content = text;

          // Simple YAML frontmatter parser
          if (text.startsWith('---')) {
            const parts = text.split('---');
            if (parts.length >= 3) {
              const frontmatter = parts[1];
              content = parts.slice(2).join('---').trim();

              // Extract name and description
              const nameMatch = frontmatter.match(/^name:\s*(.*)$/m);
              const descMatch = frontmatter.match(/^description:\s*(.*)$/m);

              if (nameMatch && nameMatch[1]) name = nameMatch[1].trim();
              if (descMatch && descMatch[1]) description = descMatch[1].trim();
            }
          }
          await skillsStorage.addSkill(name, description, content);
        } else {
          // Plain text or other format
          const name = file.name.replace(/\.[^/.]+$/, '');
          await skillsStorage.addSkill(name, '', text);
        }
        alert(t('options_skills_import_success', [file.name]));
        await loadSkills();
      } catch (err) {
        alert(t('options_skills_import_error', [String(err)]));
      }
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  const cardBg = isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-blue-100';
  const inputBg = isDarkMode
    ? 'border-slate-600 bg-slate-700 text-gray-200 placeholder-gray-500'
    : 'border-gray-300 bg-white text-gray-700 placeholder-gray-400';
  const textPrimary = isDarkMode ? 'text-gray-200' : 'text-gray-800';
  const textSecondary = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const textLabel = isDarkMode ? 'text-gray-300' : 'text-gray-700';

  return (
    <section className="space-y-6">
      <div className={`rounded-lg border ${cardBg} p-6 text-left shadow-sm`}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className={`text-left text-xl font-semibold ${textPrimary}`}>{t('options_skills_header')}</h2>
            <p className={`mt-1 text-sm font-normal ${textSecondary}`}>{t('options_skills_desc')}</p>
          </div>
          {!isEditing && (
            <div className="flex space-x-2">
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".md,.json" className="hidden" />
              <button
                id="skills-import-btn"
                onClick={handleImportClick}
                className={`flex items-center space-x-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  isDarkMode
                    ? 'border-slate-600 text-gray-300 hover:bg-slate-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}>
                <FiUpload className="h-4 w-4" />
                <span>{t('options_skills_btnImport')}</span>
              </button>
              <button
                id="skills-add-btn"
                onClick={handleAdd}
                className="flex items-center space-x-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
                <FiPlus className="h-4 w-4" />
                <span>{t('options_skills_btnAdd')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Skill Editor Form */}
        {isEditing && (
          <div
            className={`mb-6 rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-blue-200 bg-blue-50/50'} p-5`}>
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label htmlFor="skill-name" className={`mb-1.5 block text-sm font-medium ${textLabel}`}>
                  {t('options_skills_name')}
                </label>
                <input
                  id="skill-name"
                  type="text"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('options_skills_name_placeholder')}
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${errors.name ? 'border-red-500' : ''}`}
                />
                {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
              </div>

              {/* Description */}
              <div>
                <label htmlFor="skill-description" className={`mb-1.5 block text-sm font-medium ${textLabel}`}>
                  {t('options_skills_description')}
                </label>
                <input
                  id="skill-description"
                  type="text"
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder={t('options_skills_description_placeholder')}
                  className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg}`}
                />
              </div>

              {/* Content (Markdown) */}
              <div>
                <label htmlFor="skill-content" className={`mb-1.5 block text-sm font-medium ${textLabel}`}>
                  {t('options_skills_content')}
                </label>
                <textarea
                  id="skill-content"
                  value={form.content}
                  onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
                  placeholder={t('options_skills_content_placeholder')}
                  rows={10}
                  className={`w-full rounded-md border px-3 py-2 font-mono text-sm ${inputBg} ${errors.content ? 'border-red-500' : ''}`}
                />
                {errors.content && <p className="mt-1 text-xs text-red-500">{errors.content}</p>}
              </div>

              {/* Actions */}
              <div className="flex justify-end space-x-3">
                <button
                  id="skill-cancel-btn"
                  onClick={handleCancel}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${isDarkMode ? 'border-slate-600 text-gray-300 hover:bg-slate-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                  {t('options_skills_btnCancel')}
                </button>
                <button
                  id="skill-save-btn"
                  onClick={handleSave}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">
                  {t('options_skills_btnSave')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Skills List */}
        {skills.length === 0 && !isEditing ? (
          <p className={`py-8 text-center text-sm ${textSecondary}`}>{t('options_skills_empty')}</p>
        ) : (
          <div className="space-y-3">
            {skills.map(skill => (
              <div
                key={skill.id}
                className={`flex items-start justify-between rounded-lg border p-4 transition-colors ${
                  isDarkMode
                    ? `border-slate-600 ${skill.enabled ? 'bg-slate-700/70' : 'bg-slate-800/50 opacity-60'}`
                    : `border-gray-200 ${skill.enabled ? 'bg-white' : 'bg-gray-50 opacity-60'}`
                }`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>{skill.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        skill.enabled
                          ? isDarkMode
                            ? 'bg-green-900/50 text-green-400'
                            : 'bg-green-100 text-green-700'
                          : isDarkMode
                            ? 'bg-slate-600 text-gray-400'
                            : 'bg-gray-200 text-gray-500'
                      }`}>
                      {skill.enabled ? t('options_skills_enabled') : t('options_skills_disabled')}
                    </span>
                  </div>
                  {skill.description && <p className={`mt-1 text-xs ${textSecondary}`}>{skill.description}</p>}
                  <p className={`mt-1.5 line-clamp-2 font-mono text-xs ${textSecondary}`}>
                    {skill.content.substring(0, 120)}
                    {skill.content.length > 120 ? '...' : ''}
                  </p>
                </div>

                <div className="ml-4 flex shrink-0 items-center space-x-2">
                  {/* Toggle */}
                  <div className="relative inline-flex cursor-pointer items-center">
                    <input
                      id={`skill-toggle-${skill.id}`}
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={() => handleToggle(skill.id)}
                      className="peer sr-only"
                    />
                    <label
                      htmlFor={`skill-toggle-${skill.id}`}
                      className={`peer h-5 w-9 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300`}>
                      <span className="sr-only">{t('options_skills_toggle_a11y')}</span>
                    </label>
                  </div>

                  {/* Edit */}
                  <button
                    id={`skill-edit-${skill.id}`}
                    onClick={() => handleEdit(skill)}
                    className={`rounded-md p-1.5 transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-slate-600 hover:text-gray-200' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
                    title={t('options_skills_btnEdit')}>
                    <FiEdit2 className="h-4 w-4" />
                  </button>

                  {/* Delete */}
                  <button
                    id={`skill-delete-${skill.id}`}
                    onClick={() => handleDelete(skill.id)}
                    className={`rounded-md p-1.5 transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-red-900/50 hover:text-red-400' : 'text-gray-400 hover:bg-red-50 hover:text-red-600'}`}
                    title={t('options_skills_btnDelete')}>
                    <FiTrash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
