#!/usr/bin/env node

/**
 * مثال على كيفية استخدام Nanobrowser WebSocket API من JavaScript/Node.js
 * Example JavaScript/Node.js client for Nanobrowser WebSocket Server
 */

const fetch = require('node-fetch');

class NanobrowserClient {
    /**
     * عميل JavaScript للتفاعل مع خادم Nanobrowser WebSocket
     * @param {string} baseUrl - رابط خادم WebSocket (افتراضي: http://localhost:8080)
     */
    constructor(baseUrl = 'http://localhost:8080') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    /**
     * التحقق من حالة الخادم والاتصالات
     * @returns {Promise<Object>} معلومات حالة الخادم
     */
    async checkStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/api/status`);
            
            if (!response.ok) {
                throw new Error(`Status check failed: ${response.status} ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            throw new Error(`Failed to check server status: ${error.message}`);
        }
    }

    /**
     * تنفيذ مهمة في المتصفح
     * @param {string} task - وصف المهمة المراد تنفيذها
     * @param {Object} options - خيارات إضافية (اختياري)
     * @returns {Promise<Object>} معلومات المهمة مع taskId
     */
    async executeTask(task, options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}/api/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    task,
                    options
                })
            });

            const result = await response.json();

            if (!response.ok) {
                const errorMsg = result.error || `HTTP ${response.status}`;
                throw new Error(`Task execution failed: ${errorMsg}`);
            }

            return result;
        } catch (error) {
            if (error.message.includes('Task execution failed')) {
                throw error;
            }
            throw new Error(`Failed to execute task: ${error.message}`);
        }
    }

    /**
     * الحصول على نتيجة مهمة مع الانتظار حتى اكتمالها
     * @param {string} taskId - معرف المهمة
     * @param {number} maxWaitTime - أقصى وقت انتظار بالثواني (افتراضي: 60)
     * @returns {Promise<Object>} نتيجة المهمة
     */
    async getResult(taskId, maxWaitTime = 60) {
        const startTime = Date.now();
        const maxWaitMs = maxWaitTime * 1000;

        while (Date.now() - startTime < maxWaitMs) {
            try {
                const response = await fetch(`${this.baseUrl}/api/result/${taskId}`);
                
                if (response.ok) {
                    return await response.json();
                } else if (response.status === 404) {
                    // المهمة لم تكتمل بعد، انتظر قليلاً
                    await this.sleep(2000);
                    continue;
                } else {
                    const result = await response.json();
                    const errorMsg = result.error || `HTTP ${response.status}`;
                    throw new Error(`Failed to get result: ${errorMsg}`);
                }
            } catch (error) {
                if (error.message.includes('Failed to get result')) {
                    throw error;
                }
                // خطأ في الشبكة، حاول مرة أخرى
                await this.sleep(2000);
                continue;
            }
        }

        throw new Error(`Task ${taskId} did not complete within ${maxWaitTime} seconds`);
    }

    /**
     * تنفيذ مهمة والانتظار للحصول على النتيجة
     * @param {string} task - وصف المهمة
     * @param {Object} options - خيارات إضافية
     * @param {number} maxWaitTime - أقصى وقت انتظار بالثواني
     * @returns {Promise<Object>} النتيجة النهائية للمهمة
     */
    async executeAndWait(task, options = {}, maxWaitTime = 60) {
        // تنفيذ المهمة
        const executionResult = await this.executeTask(task, options);
        const taskId = executionResult.taskId;

        if (!taskId) {
            throw new Error('No taskId returned from execution');
        }

        console.log(`Task started with ID: ${taskId}`);
        console.log('Waiting for completion...');

        // انتظار النتيجة
        const result = await this.getResult(taskId, maxWaitTime);
        return result;
    }

    /**
     * مساعد للانتظار
     * @param {number} ms - الوقت بالميلي ثانية
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// مثال على الاستخدام
async function main() {
    const client = new NanobrowserClient('http://localhost:8080');

    try {
        // 1. التحقق من حالة الخادم
        console.log('🔍 Checking server status...');
        const status = await client.checkStatus();
        console.log(`✅ Server is running with ${status.connectedClients} connected clients`);
        console.log();

        // 2. تنفيذ مهمة بسيطة
        console.log('🚀 Executing a simple task...');
        const task = 'اذهب إلى google.com وابحث عن \'artificial intelligence\'';

        const result = await client.executeAndWait(task, {}, 30);

        console.log('✅ Task completed successfully!');
        console.log(`Status: ${result.status}`);

        if (result.status === 'completed') {
            console.log('Result:', result.result?.message || 'No message');
        } else if (result.status === 'failed') {
            console.log('Error:', result.error || 'Unknown error');
        }

        console.log();

        // 3. مهمة أكثر تعقيداً مع خيارات
        console.log('🔧 Executing a more complex task...');
        const complexTask = 'اذهب إلى github.com وابحث عن \'nanobrowser\' ثم افتح أول نتيجة';
        const complexOptions = {
            timeout: 45000,  // 45 seconds
            screenshot: true
        };

        const result2 = await client.executeAndWait(complexTask, complexOptions, 60);

        console.log('✅ Complex task completed!');
        console.log(`Status: ${result2.status}`);

        if (result2.status === 'completed') {
            const resultData = result2.result || {};
            console.log('Message:', resultData.message || 'No message');
            if (resultData.screenshot) {
                console.log('📸 Screenshot was captured');
            }
        }

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
    }
}

// مثال على استخدام متعدد المهام
async function multipleTasksExample() {
    const tasks = [
        'اذهب إلى wikipedia.org',
        'ابحث عن \'Python programming language\'',
        'اضغط على النتيجة الأولى'
    ];

    const client = new NanobrowserClient();

    try {
        // تحقق من حالة الخادم
        const status = await client.checkStatus();
        if (status.connectedClients === 0) {
            console.log('❌ No Nanobrowser clients connected!');
            return;
        }

        console.log(`🔗 Connected clients: ${status.connectedClients}`);

        // تنفيذ المهام بشكل تسلسلي
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            console.log(`\n📝 Task ${i + 1}/${tasks.length}: ${task}`);
            
            try {
                const result = await client.executeAndWait(task, {}, 30);
                if (result.status === 'completed') {
                    console.log(`✅ Task ${i + 1} completed successfully`);
                } else {
                    console.log(`❌ Task ${i + 1} failed: ${result.error || 'Unknown error'}`);
                }
            } catch (error) {
                console.log(`❌ Task ${i + 1} error: ${error.message}`);
            }
        }
    } catch (error) {
        console.error(`💥 Unexpected error: ${error.message}`);
    }
}

// تشغيل الأمثلة
if (require.main === module) {
    console.log('🤖 Nanobrowser JavaScript Client Example');
    console.log('='.repeat(50));

    // تشغيل المثال الأساسي
    main()
        .then(() => {
            console.log('\n' + '='.repeat(50));
            console.log('🔄 Multiple Tasks Example');
            return multipleTasksExample();
        })
        .then(() => {
            console.log('\n✨ All examples completed!');
            process.exit(0);
        })
        .catch(error => {
            if (error.message.includes('ECONNREFUSED')) {
                console.error('\n❌ Connection refused. Make sure the WebSocket server is running on http://localhost:8080');
            } else {
                console.error(`\n💥 Unexpected error: ${error.message}`);
            }
            process.exit(1);
        });
}

module.exports = { NanobrowserClient };