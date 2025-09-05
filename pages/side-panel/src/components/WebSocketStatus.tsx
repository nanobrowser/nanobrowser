import React, { useState, useEffect } from 'react';
import { FiWifi, FiWifiOff } from 'react-icons/fi';

interface WebSocketStatusProps {
  isDarkMode: boolean;
}

export const WebSocketStatus: React.FC<WebSocketStatusProps> = ({ isDarkMode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  // Check WebSocket status on component mount and periodically
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'websocket_status' });
        if (response.type === 'success') {
          setIsConnected(response.data.connected);
          setIsEnabled(response.data.enabled);
          setServerUrl(response.data.serverUrl);
        }
      } catch (error) {
        console.error('Failed to check WebSocket status:', error);
        setIsConnected(false);
      }
    };

    checkStatus();
    
    // Check status every 30 seconds
    const interval = setInterval(checkStatus, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // Don't show anything if WebSocket is not enabled
  if (!isEnabled) {
    return null;
  }

  const handleClick = async () => {
    if (isConnected) {
      // Show connection info or disconnect
      const message = `WebSocket connected to:\n${serverUrl}`;
      alert(message);
    } else {
      // Try to connect
      try {
        await chrome.runtime.sendMessage({ type: 'websocket_connect' });
      } catch (error) {
        console.error('Failed to connect to WebSocket:', error);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`header-icon ${
        isConnected 
          ? `${isDarkMode ? 'text-green-400 hover:text-green-300' : 'text-green-500 hover:text-green-600'}` 
          : `${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-600'}`
      } cursor-pointer`}
      title={isConnected ? `WebSocket متصل - ${serverUrl}` : 'WebSocket غير متصل - اضغط للاتصال'}
      aria-label={isConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
      {isConnected ? <FiWifi size={16} /> : <FiWifiOff size={16} />}
    </button>
  );
};