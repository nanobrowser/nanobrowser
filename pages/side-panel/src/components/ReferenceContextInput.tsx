import React, { useState, useEffect } from 'react';

interface ReferenceContextInputProps {
  onSave: (context: string) => void;
  initialContext?: string;
}

const ReferenceContextInput: React.FC<ReferenceContextInputProps> = ({ onSave, initialContext = '' }) => {
  const [context, setContext] = useState(initialContext);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setContext(initialContext);
  }, [initialContext]);

  const handleSave = () => {
    onSave(context);
    setIsExpanded(false);
  };

  if (!isExpanded) {
    return (
      <div className="reference-context-container">
        <button onClick={() => setIsExpanded(true)} className="reference-context-button">
          Set Reference Context
        </button>
      </div>
    );
  }

  return (
    <div className="reference-context-container">
      <div className="reference-context-editor">
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder="Enter your reference context here..."
          rows={8}
          className="reference-context-textarea"
        />
      </div>
      <div className="reference-context-buttons">
        <button onClick={handleSave} className="confirm-button">
          Confirm
        </button>
      </div>
    </div>
  );
};

export default ReferenceContextInput;
