import React, { useEffect, useState } from 'react';
import { Button, Input, Switch } from '@extension/ui';
import { websocketServerStore, type WebSocketServerSettings } from '@extension/storage';

interface WebSocketSettingsProps {
  isDarkMode: boolean;
}

export const WebSocketSettings: React.FC<WebSocketSettingsProps> = ({ isDarkMode }) => {
  const [settings, setSettings] = useState<WebSocketServerSettings>({
    enabled: false,
    serverUrl: 'ws://localhost:8080',
    autoConnect: false,
    reconnectInterval: 5000,
    heartbeatInterval: 30000,
    connectionTimeout: 10000,
    maxReconnectAttempts: 5,
    authToken: undefined,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'unknown'>('unknown');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load settings on component mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentSettings = await websocketServerStore.getSettings();
        setSettings(currentSettings);
        
        // Check initial connection status
        await checkConnectionStatus();
      } catch (error) {
        console.error('Failed to load WebSocket settings:', error);
        showMessage('error', 'فشل في تحميل الإعدادات');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Subscribe to settings changes
  useEffect(() => {
    return websocketServerStore.subscribe(async () => {
      const currentSettings = await websocketServerStore.getSettings();
      setSettings(currentSettings);
      await checkConnectionStatus();
    });
  }, []);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const checkConnectionStatus = async () => {
    try {
      // Send message to background script to check WebSocket status
      const response = await chrome.runtime.sendMessage({ type: 'websocket_status' });
      
      if (response.type === 'success') {
        setConnectionStatus(response.data.connected ? 'connected' : 'disconnected');
      } else {
        setConnectionStatus('unknown');
      }
    } catch (error) {
      console.error('Failed to check connection status:', error);
      setConnectionStatus('unknown');
    }
  };

  const handleSettingChange = <K extends keyof WebSocketServerSettings>(
    key: K,
    value: WebSocketServerSettings[K]
  ) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await websocketServerStore.setSettings(settings);
      showMessage('success', 'تم حفظ الإعدادات بنجاح');
    } catch (error) {
      console.error('Failed to save settings:', error);
      showMessage('error', 'فشل في حفظ الإعدادات');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsConnecting(true);
    try {
      // First save current settings
      await websocketServerStore.setSettings(settings);
      
      // Then attempt connection
      const response = await chrome.runtime.sendMessage({ type: 'websocket_connect' });
      
      if (response.type === 'success') {
        showMessage('success', 'تم الاتصال بالخادم بنجاح');
        setConnectionStatus('connected');
      } else {
        showMessage('error', `فشل الاتصال: ${response.error}`);
        setConnectionStatus('disconnected');
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      showMessage('error', 'فشل في اختبار الاتصال');
      setConnectionStatus('disconnected');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'websocket_disconnect' });
      
      if (response.type === 'success') {
        showMessage('success', 'تم قطع الاتصال بنجاح');
        setConnectionStatus('disconnected');
      } else {
        showMessage('error', `فشل في قطع الاتصال: ${response.error}`);
      }
    } catch (error) {
      console.error('Disconnect failed:', error);
      showMessage('error', 'فشل في قطع الاتصال');
    }
  };

  const handleResetDefaults = async () => {
    try {
      await websocketServerStore.resetToDefaults();
      const defaultSettings = await websocketServerStore.getSettings();
      setSettings(defaultSettings);
      showMessage('success', 'تم إعادة تعيين الإعدادات الافتراضية');
    } catch (error) {
      console.error('Failed to reset defaults:', error);
      showMessage('error', 'فشل في إعادة تعيين الإعدادات');
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-500';
      case 'disconnected': return 'text-red-500';
      case 'connecting': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'متصل';
      case 'disconnected': return 'غير متصل';
      case 'connecting': return 'جاري الاتصال...';
      default: return 'غير معروف';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>جاري التحميل...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          إعدادات خادم WebSocket
        </h2>
        <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          تكوين الاتصال مع خادم WebSocket للتحكم عن بُعد في الإضافة
        </p>
      </div>

      {/* Message Display */}
      {message && (
        <div
          className={`rounded-lg p-4 ${
            message.type === 'success'
              ? 'bg-green-100 border border-green-400 text-green-700'
              : 'bg-red-100 border border-red-400 text-red-700'
          }`}>
          {message.text}
        </div>
      )}

      {/* Connection Status */}
      <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-slate-700/50' : 'bg-white/50'} backdrop-blur-sm`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              حالة الاتصال
            </h3>
            <p className={`text-sm ${getConnectionStatusColor()}`}>
              {getConnectionStatusText()}
            </p>
          </div>
          <div className="flex space-x-2">
            <Button
              onClick={handleTestConnection}
              disabled={isConnecting || !settings.enabled}
              className="bg-blue-500 hover:bg-blue-600 text-white">
              {isConnecting ? 'جاري الاتصال...' : 'اختبار الاتصال'}
            </Button>
            {connectionStatus === 'connected' && (
              <Button
                onClick={handleDisconnect}
                className="bg-red-500 hover:bg-red-600 text-white">
                قطع الاتصال
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Settings */}
      <div className={`rounded-lg p-6 ${isDarkMode ? 'bg-slate-700/50' : 'bg-white/50'} backdrop-blur-sm`}>
        <div className="space-y-6">
          {/* Enable WebSocket */}
          <div>
            <label className={`flex items-center space-x-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              <Switch
                checked={settings.enabled}
                onChange={(checked) => handleSettingChange('enabled', checked)}
              />
              <span>تفعيل خادم WebSocket</span>
            </label>
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              تفعيل أو إلغاء تفعيل الاتصال مع خادم WebSocket
            </p>
          </div>

          {/* Server URL */}
          <div>
            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              رابط الخادم
            </label>
            <Input
              type="text"
              value={settings.serverUrl}
              onChange={(e) => handleSettingChange('serverUrl', e.target.value)}
              placeholder="ws://localhost:8080"
              disabled={!settings.enabled}
              className="mt-1"
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              رابط خادم WebSocket (مثال: ws://localhost:8080)
            </p>
          </div>

          {/* Auto Connect */}
          <div>
            <label className={`flex items-center space-x-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              <Switch
                checked={settings.autoConnect}
                onChange={(checked) => handleSettingChange('autoConnect', checked)}
                disabled={!settings.enabled}
              />
              <span>الاتصال التلقائي</span>
            </label>
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              الاتصال تلقائياً بالخادم عند بدء تشغيل الإضافة
            </p>
          </div>

          {/* Auth Token */}
          <div>
            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              رمز المصادقة (اختياري)
            </label>
            <Input
              type="password"
              value={settings.authToken || ''}
              onChange={(e) => handleSettingChange('authToken', e.target.value || undefined)}
              placeholder="أدخل رمز المصادقة إن وجد"
              disabled={!settings.enabled}
              className="mt-1"
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              رمز المصادقة للوصول المحمي للخادم
            </p>
          </div>
        </div>
      </div>

      {/* Advanced Settings */}
      <details className={`rounded-lg ${isDarkMode ? 'bg-slate-700/50' : 'bg-white/50'} backdrop-blur-sm`}>
        <summary className={`cursor-pointer p-4 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          الإعدادات المتقدمة
        </summary>
        <div className="p-6 pt-0 space-y-4">
          {/* Reconnect Interval */}
          <div>
            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              فترة إعادة المحاولة (بالميلي ثانية)
            </label>
            <Input
              type="number"
              value={settings.reconnectInterval}
              onChange={(e) => handleSettingChange('reconnectInterval', parseInt(e.target.value) || 5000)}
              min="1000"
              step="1000"
              disabled={!settings.enabled}
              className="mt-1"
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              الوقت بين محاولات إعادة الاتصال (افتراضي: 5000)
            </p>
          </div>

          {/* Heartbeat Interval */}
          <div>
            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              فترة نبضات القلب (بالميلي ثانية)
            </label>
            <Input
              type="number"
              value={settings.heartbeatInterval}
              onChange={(e) => handleSettingChange('heartbeatInterval', parseInt(e.target.value) || 30000)}
              min="5000"
              step="5000"
              disabled={!settings.enabled}
              className="mt-1"
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              فترة إرسال نبضات القلب للخادم (افتراضي: 30000)
            </p>
          </div>

          {/* Connection Timeout */}
          <div>
            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              مهلة الاتصال (بالميلي ثانية)
            </label>
            <Input
              type="number"
              value={settings.connectionTimeout}
              onChange={(e) => handleSettingChange('connectionTimeout', parseInt(e.target.value) || 10000)}
              min="1000"
              step="1000"
              disabled={!settings.enabled}
              className="mt-1"
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              الحد الأقصى للانتظار أثناء الاتصال (افتراضي: 10000)
            </p>
          </div>

          {/* Max Reconnect Attempts */}
          <div>
            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              الحد الأقصى لمحاولات إعادة الاتصال
            </label>
            <Input
              type="number"
              value={settings.maxReconnectAttempts}
              onChange={(e) => handleSettingChange('maxReconnectAttempts', parseInt(e.target.value) || 5)}
              min="1"
              max="20"
              disabled={!settings.enabled}
              className="mt-1"
            />
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              عدد محاولات إعادة الاتصال قبل التوقف (افتراضي: 5)
            </p>
          </div>
        </div>
      </details>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-green-500 hover:bg-green-600 text-white">
          {isSaving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
        </Button>
        
        <Button
          onClick={handleResetDefaults}
          className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-700' : 'bg-gray-500 hover:bg-gray-600'} text-white`}>
          إعادة تعيين الافتراضيات
        </Button>
      </div>

      {/* Documentation Link */}
      <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-blue-900/20' : 'bg-blue-100/50'} backdrop-blur-sm border ${isDarkMode ? 'border-blue-700/50' : 'border-blue-200'}`}>
        <h4 className={`text-sm font-medium ${isDarkMode ? 'text-blue-300' : 'text-blue-700'}`}>
          💡 نصائح للاستخدام
        </h4>
        <ul className={`mt-2 text-xs ${isDarkMode ? 'text-blue-200' : 'text-blue-600'} space-y-1`}>
          <li>• تأكد من تشغيل خادم WebSocket على الرابط المحدد</li>
          <li>• استخدم ws:// للاتصالات المحلية و wss:// للاتصالات المشفرة</li>
          <li>• يمكنك استخدام HTTP API للتحكم في الإضافة من التطبيقات الخارجية</li>
          <li>• راجع ملف README.md في مجلد websocket-server للمزيد من التفاصيل</li>
        </ul>
      </div>
    </div>
  );
};