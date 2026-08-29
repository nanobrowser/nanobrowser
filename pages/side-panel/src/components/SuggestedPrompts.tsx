import { LuSparkles } from 'react-icons/lu';

interface SuggestedPrompt {
  title: string;
  description: string;
  prompt: string;
  icon: string;
}

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
  isDarkMode?: boolean;
}

const SUGGESTIONS: SuggestedPrompt[] = [
  {
    title: 'Research',
    description: 'Summarize the latest homepage headlines from a site.',
    prompt: 'Go to TechCrunch and extract the top 10 headlines from the last 24 hours.',
    icon: '🔎',
  },
  {
    title: 'GitHub',
    description: 'Find strong repos in a language or topic.',
    prompt: 'Look for the trending Python repositories on GitHub with the most stars.',
    icon: '💻',
  },
  {
    title: 'Shopping',
    description: 'Compare products with clear constraints.',
    prompt:
      'Find a portable Bluetooth speaker on Amazon under $50 with water resistance and at least 10 hours of battery life.',
    icon: '🛍️',
  },
  {
    title: 'Planning',
    description: 'Collect options and make a recommendation.',
    prompt: 'Compare three coworking spaces in Bangalore with pricing, ratings, and amenities.',
    icon: '🧭',
  },
];

const SuggestedPrompts = ({ onSelect, isDarkMode = false }: SuggestedPromptsProps) => {
  return (
    <section className="py-2" aria-label="Suggested prompts">
      <div className="mb-3 flex items-center gap-2 px-2">
        <LuSparkles className={isDarkMode ? 'text-sky-300' : 'text-sky-500'} size={14} />
        <h3 className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Try these
        </h3>
      </div>
      <div className="flex gap-3 overflow-x-auto px-2 pb-1">
        {SUGGESTIONS.map(suggestion => (
          <button
            key={suggestion.title}
            type="button"
            onClick={() => onSelect(suggestion.prompt)}
            className={`flex w-40 shrink-0 flex-col items-start gap-1 rounded-2xl border p-3 text-left shadow-sm transition-transform hover:scale-[1.02] active:scale-95 ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800/80 hover:bg-slate-800'
                : 'border-sky-100 bg-white/85 hover:bg-white'
            }`}>
            <span className="text-lg" aria-hidden="true">
              {suggestion.icon}
            </span>
            <span className={`text-xs font-semibold leading-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
              {suggestion.title}
            </span>
            <span className={`text-[11px] leading-tight ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              {suggestion.description}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default SuggestedPrompts;
