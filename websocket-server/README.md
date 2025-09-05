# Nanobrowser WebSocket Server

خدمة WebSocket للتحكم عن بُعد في إضافة Nanobrowser من خلال واجهات برمجة التطبيقات.

## المميزات

- **اتصال WebSocket**: تواصل في الوقت الفعلي مع إضافة Nanobrowser
- **RESTful API**: واجهات برمجة بسيطة لتنفيذ المهام والحصول على النتائج
- **دعم متعدد العملاء**: إمكانية ربط عدة نسخ من الإضافة
- **مراقبة الحالة**: متابعة حالة الاتصالات والمهام
- **معالجة الأخطاء**: تعامل محسن مع الأخطاء والانقطاعات

## التثبيت والتشغيل

### المتطلبات
- Node.js v18 أو أحدث
- npm أو pnpm

### خطوات التشغيل

1. تثبيت التبعيات:
```bash
npm install
# أو
pnpm install
```

2. تشغيل الخدمة:
```bash
npm start
# أو في وضع التطوير
npm run dev
```

الخدمة ستعمل على المنفذ 8080 افتراضياً.

## واجهات برمجة التطبيقات

### 1. التحقق من حالة الخدمة
```
GET /api/status
```

**الاستجابة:**
```json
{
  "status": "running",
  "connectedClients": 1,
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

### 2. تنفيذ مهمة
```
POST /api/execute
Content-Type: application/json

{
  "task": "اذهب إلى google.com وابحث عن 'AI automation'",
  "options": {
    "timeout": 30000,
    "screenshot": true
  }
}
```

**الاستجابة:**
```json
{
  "success": true,
  "taskId": "123e4567-e89b-12d3-a456-426614174000",
  "message": "Task sent to Nanobrowser extension",
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

### 3. الحصول على نتيجة المهمة
```
GET /api/result/{taskId}
```

**الاستجابة عند النجاح:**
```json
{
  "taskId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "completed",
  "result": {
    "message": "تم تنفيذ المهمة بنجاح",
    "screenshot": "data:image/png;base64,..."
  },
  "completedAt": "2025-01-01T12:01:00.000Z"
}
```

**الاستجابة عند الفشل:**
```json
{
  "taskId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "failed",
  "error": "وصف الخطأ",
  "failedAt": "2025-01-01T12:01:00.000Z"
}
```

## بروتوكول WebSocket

### الاتصال
```
ws://localhost:8080
```

### الرسائل من الخدمة إلى الإضافة

#### تنفيذ مهمة
```json
{
  "type": "execute_task",
  "taskId": "uuid",
  "task": "وصف المهمة",
  "options": {},
  "timestamp": "ISO string"
}
```

#### استجابة heartbeat
```json
{
  "type": "heartbeat_response"
}
```

### الرسائل من الإضافة إلى الخدمة

#### بداية المهمة
```json
{
  "type": "task_started",
  "taskId": "uuid"
}
```

#### تقدم المهمة
```json
{
  "type": "task_progress",
  "taskId": "uuid",
  "step": "وصف الخطوة الحالية"
}
```

#### اكتمال المهمة
```json
{
  "type": "task_completed",
  "taskId": "uuid",
  "result": {}
}
```

#### فشل المهمة
```json
{
  "type": "task_failed",
  "taskId": "uuid",
  "error": "وصف الخطأ"
}
```

#### Heartbeat
```json
{
  "type": "heartbeat"
}
```

## أمثلة الاستخدام

### Python
```python
import requests
import json
import time

# تنفيذ مهمة
response = requests.post('http://localhost:8080/api/execute', json={
    'task': 'اذهب إلى موقع GitHub وابحث عن nanobrowser'
})

if response.status_code == 200:
    data = response.json()
    task_id = data['taskId']
    
    # انتظار النتيجة
    while True:
        result_response = requests.get(f'http://localhost:8080/api/result/{task_id}')
        if result_response.status_code == 200:
            result = result_response.json()
            print(f"حالة المهمة: {result['status']}")
            break
        time.sleep(2)
```

### JavaScript/Node.js
```javascript
import fetch from 'node-fetch';

async function executeTask(task) {
  try {
    const response = await fetch('http://localhost:8080/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('تم إرسال المهمة:', data.taskId);
      return data.taskId;
    }
  } catch (error) {
    console.error('خطأ في تنفيذ المهمة:', error);
  }
}

async function getResult(taskId) {
  const response = await fetch(`http://localhost:8080/api/result/${taskId}`);
  if (response.ok) {
    return await response.json();
  }
  return null;
}
```

### cURL
```bash
# تنفيذ مهمة
curl -X POST http://localhost:8080/api/execute \
  -H "Content-Type: application/json" \
  -d '{"task": "اذهب إلى google.com"}'

# الحصول على النتيجة
curl http://localhost:8080/api/result/TASK_ID
```

## الإعداد المتقدم

### متغيرات البيئة
- `PORT`: المنفذ الذي ستعمل عليه الخدمة (افتراضي: 8080)

### مثال على ملف .env
```env
PORT=9000
```

## الأمان

- تأكد من تشغيل الخدمة في بيئة آمنة
- استخدم HTTPS في البيئة الإنتاجية
- قم بتطبيق آليات المصادقة حسب الحاجة
- راقب الاتصالات والوصول للخدمة

## استكشاف الأخطاء

### مشاكل شائعة

1. **لا يوجد عملاء متصلون**
   - تأكد من أن إضافة Nanobrowser مثبتة ومفعلة
   - تحقق من إعدادات الاتصال في الإضافة

2. **فشل في الاتصال**
   - تأكد من أن المنفذ 8080 غير محجوب
   - تحقق من إعدادات الـ firewall

3. **لا تصل النتائج**
   - تأكد من استقرار الاتصال
   - تحقق من سجلات الخدمة للأخطاء