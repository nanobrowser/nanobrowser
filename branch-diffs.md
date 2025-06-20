# Branch Diffs: codex/add-support-for-bedrock-models-in-langchain

This file contains all the differences in the current branch compared to the remote branch `origin/codex/add-support-for-bedrock-models-in-langchain`.

## Commits in this branch:
- `706c512` - refactor: improve code formatting and structure in createAzureChatModel function
- `095fc4c` - chore: update dependencies and improve code formatting in ModelSettings component

## Full Diff:

```diff
diff --git a/chrome-extension/package.json b/chrome-extension/package.json
index da539a7..33b4b8a 100644
--- a/chrome-extension/package.json
+++ b/chrome-extension/package.json
@@ -19,8 +19,8 @@
     "@extension/shared": "workspace:*",
     "@extension/storage": "workspace:*",
     "@langchain/anthropic": "0.3.21",
-    "@langchain/core": "0.3.57",
-    "@langchain/cerebras": "^0.0.2",
+    "@langchain/core": "0.3.58",
+    "@langchain/cerebras": "^0.0.1",
     "@langchain/deepseek": "^0.0.2",
     "@langchain/google-genai": "0.2.10",
     "@langchain/groq": "^0.2.2",
diff --git a/chrome-extension/src/background/agent/helper.ts b/chrome-extension/src/background/agent/helper.ts
index 9d5e66d..317d290 100644
--- a/chrome-extension/src/background/agent/helper.ts
+++ b/chrome-extension/src/background/agent/helper.ts
@@ -5,7 +5,7 @@ import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
 import { ChatXAI } from '@langchain/xai';
 import { ChatGroq } from '@langchain/groq';
 import { ChatCerebras } from '@langchain/cerebras';
-import { BedrockChat } from '@langchain/community/chat_models/bedrock';
+import { BedrockChat } from '@langchain/community/chat_models/bedrock/web';
 import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
 import { ChatOllama } from '@langchain/ollama';
 import { ChatDeepSeek } from '@langchain/deepseek';
@@ -253,7 +253,7 @@ export function createChatModel(providerConfig: ProviderConfig, modelConfig: Mod
         temperature,
         maxTokens,
       };
-      return new BedrockChat(args);
+      return new BedrockChat(args) as unknown as BaseChatModel;
     }
     case ProviderTypeEnum.Ollama: {
       const args: {
diff --git a/pages/options/src/components/ModelSettings.tsx b/pages/options/src/components/ModelSettings.tsx
index 63ebddd..e658d33 100644
--- a/pages/options/src/components/ModelSettings.tsx
+++ b/pages/options/src/components/ModelSettings.tsx
@@ -572,7 +572,7 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
     // Store both provider and model name in the format "provider>model"
     setSelectedModels(prev => ({
       ...prev,
-      [agentName]: modelValue,  // Store the full provider>model value
+      [agentName]: modelValue, // Store the full provider>model value
     }));
 
     try {
@@ -734,7 +734,7 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
             id={`${agentName}-model`}
             className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
             disabled={availableModels.length === 0}
-            value={selectedModels[agentName] || ''}  // Use the stored provider>model value directly
+            value={selectedModels[agentName] || ''} // Use the stored provider>model value directly
             onChange={e => handleModelChange(agentName, e.target.value)}>
             <option key="default" value="">
               Choose model
@@ -1256,66 +1256,67 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
                     {/* API Key input with label */}
                     {providerConfig.type !== ProviderTypeEnum.Bedrock && (
                       <div className="flex items-center">
-                      <label
-                        htmlFor={`${providerId}-api-key`}
-                        className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
-                        API Key
-                        {/* Show asterisk only if required */}
-                        {providerConfig.type !== ProviderTypeEnum.CustomOpenAI &&
-                        providerConfig.type !== ProviderTypeEnum.Ollama
-                          ? '*'
-                          : ''}
-                      </label>
-                      <div className="relative flex-1">
-                        <input
-                          id={`${providerId}-api-key`}
-                          type="password"
-                          placeholder={
-                            providerConfig.type === ProviderTypeEnum.CustomOpenAI
-                              ? `${providerConfig.name || providerId} API key (optional)`
-                              : providerConfig.type === ProviderTypeEnum.Ollama
-                                ? 'API Key (leave empty for Ollama)'
-                                : `${providerConfig.name || providerId} API key (required)`
-                          }
-                          value={providerConfig.apiKey || ''}
-                          onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
-                          className={`w-full rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
-                        />
-                        {/* Show eye button only for newly added providers */}
-                        {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
-                          <button
-                            type="button"
-                            className={`absolute right-2 top-1/2 -translate-y-1/2 ${
-                              isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
-                            }`}
-                            onClick={() => toggleApiKeyVisibility(providerId)}
-                            aria-label={visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}>
-                            <svg
-                              xmlns="http://www.w3.org/2000/svg"
-                              viewBox="0 0 24 24"
-                              fill="none"
-                              stroke="currentColor"
-                              strokeWidth="2"
-                              strokeLinecap="round"
-                              strokeLinejoin="round"
-                              className="size-5"
-                              aria-hidden="true">
-                              <title>{visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}</title>
-                              {visibleApiKeys[providerId] ? (
-                                <>
-                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
-                                  <circle cx="12" cy="12" r="3" />
-                                  <line x1="2" y1="22" x2="22" y2="2" />
-                                </>
-                              ) : (
-                                <>
-                                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
-                                  <circle cx="12" cy="12" r="3" />
-                                </>
-                              )}
-                            </svg>
-                          </button>
-                        )}
+                        <label
+                          htmlFor={`${providerId}-api-key`}
+                          className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
+                          API Key
+                          {/* Show asterisk only if required */}
+                          {providerConfig.type !== ProviderTypeEnum.CustomOpenAI &&
+                          providerConfig.type !== ProviderTypeEnum.Ollama
+                            ? '*'
+                            : ''}
+                        </label>
+                        <div className="relative flex-1">
+                          <input
+                            id={`${providerId}-api-key`}
+                            type="password"
+                            placeholder={
+                              providerConfig.type === ProviderTypeEnum.CustomOpenAI
+                                ? `${providerConfig.name || providerId} API key (optional)`
+                                : providerConfig.type === ProviderTypeEnum.Ollama
+                                  ? 'API Key (leave empty for Ollama)'
+                                  : `${providerConfig.name || providerId} API key (required)`
+                            }
+                            value={providerConfig.apiKey || ''}
+                            onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
+                            className={`w-full rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
+                          />
+                          {/* Show eye button only for newly added providers */}
+                          {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
+                            <button
+                              type="button"
+                              className={`absolute right-2 top-1/2 -translate-y-1/2 ${
+                                isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
+                              }`}
+                              onClick={() => toggleApiKeyVisibility(providerId)}
+                              aria-label={visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}>
+                              <svg
+                                xmlns="http://www.w3.org/2000/svg"
+                                viewBox="0 0 24 24"
+                                fill="none"
+                                stroke="currentColor"
+                                strokeWidth="2"
+                                strokeLinecap="round"
+                                strokeLinejoin="round"
+                                className="size-5"
+                                aria-hidden="true">
+                                <title>{visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}</title>
+                                {visibleApiKeys[providerId] ? (
+                                  <>
+                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
+                                    <circle cx="12" cy="12" r="3" />
+                                    <line x1="2" y1="22" x2="22" y2="2" />
+                                  </>
+                                ) : (
+                                  <>
+                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
+                                    <circle cx="12" cy="12" r="3" />
+                                  </>
+                                )}
+                              </svg>
+                            </button>
+                          )}
+                        </div>
                       </div>
                     )}
 
@@ -1376,7 +1377,9 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
                     {providerConfig.type === ProviderTypeEnum.Bedrock && (
                       <div className="space-y-2">
                         <div className="flex items-center">
-                          <label htmlFor={`${providerId}-aws-access-key`} className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
+                          <label
+                            htmlFor={`${providerId}-aws-access-key`}
+                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                             Access Key*
                           </label>
                           <input
@@ -1389,7 +1392,9 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
                           />
                         </div>
                         <div className="flex items-center">
-                          <label htmlFor={`${providerId}-aws-secret-key`} className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
+                          <label
+                            htmlFor={`${providerId}-aws-secret-key`}
+                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                             Secret Key*
                           </label>
                           <input
@@ -1402,7 +1407,9 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
                           />
                         </div>
                         <div className="flex items-center">
-                          <label htmlFor={`${providerId}-aws-session-token`} className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
+                          <label
+                            htmlFor={`${providerId}-aws-session-token`}
+                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                             Session
                           </label>
                           <input
@@ -1415,7 +1422,9 @@ export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
                           />
                         </div>
                         <div className="flex items-center">
-                          <label htmlFor={`${providerId}-aws-region`} className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
+                          <label
+                            htmlFor={`${providerId}-aws-region`}
+                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                             Region*
                           </label>
                           <input
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 068bf8b..a6db4ca 100644
Binary files a/pnpm-lock.yaml and b/pnpm-lock.yaml differ
```

## Summary of Changes:

### 1. Package Dependencies (`chrome-extension/package.json`)
- Updated `@langchain/core` from `0.3.57` to `0.3.58`
- Downgraded `@langchain/cerebras` from `^0.0.2` to `^0.0.1`

### 2. Bedrock Chat Model Integration (`chrome-extension/src/background/agent/helper.ts`)
- Changed import from `@langchain/community/chat_models/bedrock` to `@langchain/community/chat_models/bedrock/web`
- Added type casting for BedrockChat: `return new BedrockChat(args) as unknown as BaseChatModel;`

### 3. Code Formatting Improvements (`pages/options/src/components/ModelSettings.tsx`)
- Cleaned up trailing spaces in comments
- Improved indentation and formatting consistency for:
  - API Key input labels and containers
  - AWS credential labels (Access Key, Secret Key, Session Token, Region)
- Better JSX element alignment and spacing
- Consistent formatting for className attributes

### 4. Lock File Updates (`pnpm-lock.yaml`)
- Binary file changes reflecting the dependency updates

These changes appear to focus on improving Bedrock model support in LangChain integration while also cleaning up code formatting and updating dependencies. 