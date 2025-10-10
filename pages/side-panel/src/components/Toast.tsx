import React, { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, duration = 3000, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-500 border-green-600';
      case 'error':
        return 'bg-red-500 border-red-600';
      case 'warning':
        return 'bg-yellow-500 border-yellow-600';
      case 'info':
      default:
        return 'bg-blue-500 border-blue-600';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
      default:
        return 'ℹ';
    }
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex min-w-[300px] max-w-md items-center gap-3 rounded-lg border-2 p-4 text-white shadow-lg ${getTypeStyles()} animate-slide-up`}
      role="alert">
      <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-white/20 font-bold">
        {getIcon()}
      </div>
      <div className="flex-1 text-sm">{message}</div>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-white/80 transition-colors hover:text-white"
        aria-label="Close notification">
        ✕
      </button>
    </div>
  );
};

export default Toast;
