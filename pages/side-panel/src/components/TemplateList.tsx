/* eslint-disable react/prop-types */
interface Template {
  id: string;
  title: string;
  content: string;
}

interface TemplateListProps {
  templates: Template[];
  onTemplateSelect: (content: string) => void;
  isDarkMode?: boolean;
}

const TemplateList: React.FC<TemplateListProps> = ({ templates, onTemplateSelect, isDarkMode = false }) => {
  return (
    <div className="p-4">
      <h3 className={`mb-4 text-lg font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Quick Start</h3>
      <div className="grid grid-cols-1 gap-4">
        {templates.map(template => (
          <button
            type="button"
            key={template.id}
            onClick={() => onTemplateSelect(template.content)}
            className={`rounded-lg p-4 text-left transition-colors ${
              isDarkMode
                ? 'bg-slate-800 text-gray-100 hover:bg-slate-700 border-primary-500 border-2'
                : 'bg-primary-200 text-gray-900 hover:bg-primary-300 border-primary-400 border-2'
            } shadow-sm hover:shadow-md`}>
            <div className={`text-md font-medium ${isDarkMode ? 'text-primary-300' : 'text-primary-800'}`}>
              {template.title}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TemplateList;
