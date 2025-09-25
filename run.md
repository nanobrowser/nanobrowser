# 🚀 Guia de Desenvolvimento - VisibleAI

Este guia explica como trabalhar em ambiente de desenvolvimento sem precisar fazer `pnpm build` a cada alteração.

## 📋 Pré-requisitos

- [Node.js](https://nodejs.org/) (v22.12.0 ou superior)
- [pnpm](https://pnpm.io/installation) (v9.15.1 ou superior)

## 🔧 Setup Inicial

1. **Instalar dependências**:
   ```bash
   pnpm install
   ```

2. **Verificar se tudo está funcionando**:
   ```bash
   pnpm type-check
   ```

## 🏃‍♂️ Modo de Desenvolvimento

### Opção 1: Desenvolvimento com Hot Reload (Recomendado)

```bash
pnpm dev
```

Este comando irá:
- ✅ Compilar automaticamente quando você fizer alterações
- ✅ Hot reload para mudanças de UI (React)
- ✅ Recompilação automática de arquivos TypeScript
- ✅ Não requer reload manual da extensão para maioria das mudanças

### Opção 2: Build + Watch Manual

Se por algum motivo o `pnpm dev` não funcionar adequadamente:

```bash
# Em um terminal
pnpm build --watch

# Em outro terminal (se necessário)
pnpm type-check --watch
```

## 🔄 Workflow de Desenvolvimento

### 1. Primeiro Setup da Extensão

```bash
# Inicie o modo de desenvolvimento
pnpm dev

# Abra o Chrome
# Vá para chrome://extensions/
# Ative "Modo do desenvolvedor" (canto superior direito)
# Clique em "Carregar sem compactação"
# Selecione a pasta `dist/` do projeto
```

### 2. Durante o Desenvolvimento

1. **Faça suas alterações** nos arquivos source
2. **O sistema reconstrói automaticamente** (com `pnpm dev` rodando)
3. **Para mudanças de UI/React**: Apenas atualize a página/painel
4. **Para mudanças de background scripts**: Vá em `chrome://extensions/` e clique no ícone de reload da extensão

### 3. Quando Reload da Extensão é Necessário

Você precisa fazer reload da extensão (botão de reload em `chrome://extensions/`) apenas quando alterar:
- 📁 `chrome-extension/src/background/` (background scripts)
- 📁 `chrome-extension/manifest.js` (configurações da extensão)
- 📁 Arquivos de permissões ou configuração

### 4. Quando Apenas Refresh da Página é Suficiente

Para mudanças nos seguintes arquivos, apenas refresh da página/painel:
- 📁 `pages/side-panel/src/` (UI do painel lateral)
- 📁 `pages/options/src/` (página de configurações)
- 📁 `packages/storage/` (mudanças de storage)
- 📁 `packages/ui/` (componentes compartilhados)

## 🛠️ Comandos Úteis Durante Desenvolvimento

```bash
# Verificar tipos TypeScript
pnpm type-check

# Executar linter
pnpm lint

# Formatar código
pnpm prettier

# Limpar build e reinstalar (se algo der errado)
pnpm clean:install

# Build de produção (apenas quando necessário)
pnpm build
```

## 🐛 Debugging

### 1. Debugging do Painel Lateral
- Abra o painel lateral da extensão
- Clique com botão direito → "Inspecionar"
- Use DevTools normalmente

### 2. Debugging do Background Script
- Vá para `chrome://extensions/`
- Encontre sua extensão
- Clique em "Inspecionar visualizações: service worker"

### 3. Debugging do Content Script
- Abra qualquer página web
- F12 → Console
- Procure por logs do content script

## ⚡ Dicas de Performance

1. **Use `pnpm dev`** ao invés de rebuilds manuais
2. **Mantenha o DevTools aberto** para ver erros em tempo real
3. **Use TypeScript no seu editor** para catch de erros antes da execução
4. **Configure seu editor** para mostrar erros ESLint em tempo real

## 🔧 Estrutura de Arquivos Importantes

```
visible-ai/
├── packages/
│   ├── storage/           # Sistema de storage
│   ├── ui/               # Componentes compartilhados
│   └── i18n/             # Internacionalização
├── pages/
│   ├── side-panel/       # Painel lateral principal
│   └── options/          # Página de configurações
├── chrome-extension/     # Background scripts e manifest
└── dist/                 # Build output (carregar esta pasta no Chrome)
```

## 🚨 Troubleshooting

### Problema: "Hot reload não está funcionando"
```bash
# Pare o processo atual (Ctrl+C)
pnpm clean:bundle
pnpm dev
```

### Problema: "Tipos TypeScript com erro"
```bash
pnpm type-check
# Corrija os erros mostrados
```

### Problema: "Extensão não carrega no Chrome"
1. Verifique se `pnpm dev` está rodando
2. Verifique se a pasta `dist/` foi criada
3. Reload da extensão em `chrome://extensions/`

---

## 📝 Resumo Rápido

```bash
# Setup uma vez
pnpm install

# Durante desenvolvimento (deixe rodando)
pnpm dev

# Carregue a pasta dist/ no Chrome como extensão
# Faça suas alterações
# Refresh da página para UI changes
# Reload da extensão apenas para background script changes
```

**🎯 Com este setup, você consegue desenvolver de forma muito mais eficiente sem builds manuais constantes!**