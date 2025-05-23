# SSE MCP架构设计

## 架构概述

简化后的SSE MCP Host采用单服务器架构，提供清晰的请求流程：

```
外部AI系统 → SSE Server → Native Messaging → Chrome扩展
```

## 核心组件

### 1. SSE Server (`pkg/sse/server.go`)
- **职责**: 处理外部AI系统的HTTP/SSE请求
- **功能**:
  - 提供MCP协议的SSE endpoint
  - 管理工具和资源注册
  - 处理initialize、list_tools、list_resources、call_tool等MCP请求
  - 将请求转发给Native Messaging组件

### 2. Native Messaging (`pkg/messaging/native_messaging.go`)
- **职责**: 与Chrome扩展通信
- **功能**:
  - 通过Chrome Native Messaging协议与扩展通信
  - 转发SSE Server的请求到Chrome扩展
  - 接收Chrome扩展的响应并返回给SSE Server

### 3. Chrome扩展
- **职责**: 实际的浏览器操作执行者
- **功能**:
  - 接收来自Native Messaging的请求
  - 执行页面导航、DOM操作等浏览器任务
  - 返回操作结果

## 请求流程

### 工具调用流程
1. **外部AI系统** 通过HTTP POST发送工具调用请求到SSE Server
2. **SSE Server** 解析MCP请求，验证工具存在
3. **SSE Server** 将请求转发给Native Messaging
4. **Native Messaging** 通过Chrome Native Messaging协议发送请求给Chrome扩展
5. **Chrome扩展** 执行实际的浏览器操作
6. **Chrome扩展** 返回操作结果给Native Messaging
7. **Native Messaging** 将结果转发给SSE Server
8. **SSE Server** 将MCP格式的响应返回给外部AI系统

### 资源访问流程
1. **外部AI系统** 请求资源信息
2. **SSE Server** 通过Native Messaging向Chrome扩展查询当前状态
3. **Chrome扩展** 收集页面状态信息（URL、标题、DOM结构等）
4. **结果原路返回** 给外部AI系统

## 环境变量配置

- `SSE_PORT`: SSE服务器端口（默认: :8080）
- `SSE_BASE_URL`: SSE服务器基础URL（默认: http://localhost:8080）
- `SSE_BASE_PATH`: SSE服务器基础路径（默认: /mcp）
- `RUN_MODE`: 运行模式（development/production，默认: production）

## 启动和连接

### 启动MCP Host
```bash
cd mcp-host-go
make build
./build/mcp-host
```

### 外部AI系统连接
SSE Server在 `http://localhost:8080/mcp` 提供MCP over SSE服务。

外部AI系统可以通过以下方式连接：
- **HTTP POST**: `/mcp` - 用于一次性请求
- **SSE**: `/mcp/sse` - 用于持久连接和事件流

## 优势

1. **简单清晰**: 单一SSE服务器，架构直观
2. **易于维护**: 减少了复杂的双服务器协调逻辑
3. **标准协议**: 使用标准的HTTP/SSE和Chrome Native Messaging
4. **高效通信**: 直接的请求转发，减少中间层开销

## 与之前架构的对比

### 旧架构（已删除）
- 双服务器设计（MCP Server + SSE Server）
- 复杂的服务器间协调逻辑
- 多个通信层

### 新架构（当前）
- 单SSE服务器设计
- 直接的请求转发流程
- 简化的组件结构

这个简化的架构更易于理解、维护和扩展，同时保持了所有核心功能。
