// اختبار سريع لـ API
const fetch = require('./examples/node_modules/node-fetch');

const BASE_URL = 'https://8080-is75movuyjj46pbgpvn4f-6532622b.e2b.dev';

async function testAPI() {
    try {
        console.log('🔍 Testing WebSocket Server API...');
        
        // Test status endpoint
        const response = await fetch(`${BASE_URL}/api/status`);
        const data = await response.json();
        
        console.log('✅ Server Status:', data);
        console.log(`   - Status: ${data.status}`);
        console.log(`   - Connected Clients: ${data.connectedClients}`);
        console.log(`   - Timestamp: ${data.timestamp}`);
        
        // Test task execution (should fail since no clients)
        console.log('\n🚀 Testing task execution...');
        
        const taskResponse = await fetch(`${BASE_URL}/api/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                task: 'اختبار المهمة',
                options: {}
            })
        });
        
        const taskResult = await taskResponse.json();
        
        if (taskResponse.ok) {
            console.log('✅ Task execution response:', taskResult);
        } else {
            console.log('⚠️  Expected error (no clients connected):', taskResult.error);
        }
        
        console.log('\n✅ API tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testAPI();