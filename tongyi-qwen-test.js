// Simple test to verify Tongyi Qwen implementation
const { ProviderTypeEnum } = require('./packages/storage/lib/settings/types');

console.log('Testing Tongyi Qwen integration...');

// Check if TongyiQwen is in the enum
console.log('TongyiQwen enum value:', ProviderTypeEnum.TongyiQwen);

// Check if all expected providers are present
const expectedProviders = [
  'openai', 'anthropic', 'deepseek', 'gemini', 'grok', 'ollama', 
  'azure_openai', 'openrouter', 'groq', 'cerebras', 'llama', 
  'tongyi_qwen', 'custom_openai'
];

console.log('All provider types:');
Object.values(ProviderTypeEnum).forEach(provider => {
  console.log(`- ${provider}`);
});

const hasAllProviders = expectedProviders.every(provider => 
  Object.values(ProviderTypeEnum).includes(provider)
);

console.log(`\nAll expected providers present: ${hasAllProviders}`);

if (hasAllProviders) {
  console.log('✅ Tongyi Qwen integration appears to be working correctly!');
} else {
  console.log('❌ Some providers are missing.');
}