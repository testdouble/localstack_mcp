# LocalStack MCP Server

A Model Context Protocol (MCP) server that provides intelligent automation tools for LocalStack development workflows, addressing the key pain points identified in LocalStack usage patterns.

## Features

### 🔍 Docker Environment Detection
- Automatically detects Docker setup and container configuration
- Analyzes project structure to identify AWS service usage
- Provides intelligent configuration suggestions
- Generates Docker Compose templates with proper networking

### 🌐 Network Configuration Generator  
- Creates optimized Docker networking configurations
- Provides platform-specific setup guidance (Windows/macOS/Linux)
- Generates environment variables for different deployment scenarios
- Includes comprehensive troubleshooting guides

### 📊 Health Monitoring
- Real-time LocalStack service health checking
- Performance analysis and optimization recommendations
- Diagnostic information collection and analysis
- Automated troubleshooting suggestions

### 💾 State Management
- Export LocalStack state for team collaboration
- Import state configurations for environment standardization
- Git-friendly state serialization
- Alternative to LocalStack Cloud Pods for community users

## Installation

```bash
npm install
npm run build
```

## Usage

The MCP server provides the following tools:

### detect_docker_environment
Analyzes your project's Docker setup and LocalStack configuration:

```typescript
// Detects Docker environment and suggests optimal configuration
{
  "projectPath": "/path/to/your/project"
}
```

### generate_network_config
Generates Docker networking configuration for LocalStack:

```typescript
{
  "containerName": "localstack",
  "services": ["s3", "lambda", "dynamodb", "sqs"]
}
```

### check_localstack_health
Monitors LocalStack container health and service availability:

```typescript
{
  "endpoint": "http://localhost:4566"
}
```

### export_localstack_state
Exports current LocalStack state for sharing:

```typescript
{
  "outputPath": "./localstack-state.yml",
  "services": ["s3", "dynamodb", "sqs"]
}
```

### import_localstack_state
Imports previously exported LocalStack state:

```typescript
{
  "statePath": "./localstack-state.yml"
}
```

## Configuration with Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "localstack": {
      "command": "node",
      "args": ["/path/to/localstack-mcp-server/dist/index.js"]
    }
  }
}
```

## Key Benefits

1. **Reduces Setup Time**: Automated detection and configuration generation cuts LocalStack setup from 2-3 hours to minutes
2. **Prevents Common Issues**: Built-in troubleshooting and validation prevents networking and configuration problems
3. **Enables Team Collaboration**: State management tools allow teams to share LocalStack environments without Pro subscriptions
4. **Improves Reliability**: Health monitoring and diagnostics ensure consistent development environments

## Architecture

The server implements five core tools addressing the primary LocalStack pain points:

- **DockerDetector**: Analyzes container environment and suggests optimal configurations
- **NetworkConfigGenerator**: Creates networking configs with platform-specific optimizations  
- **LocalStackHealthMonitor**: Provides comprehensive health checking and performance analysis
- **StateManager**: Enables state export/import for team collaboration

## Development

```bash
npm run dev    # Watch mode for development
npm run build  # Compile TypeScript
npm start      # Run the MCP server
```

## Contributing

This MCP server addresses the specific gaps identified in LocalStack tooling ecosystem. Contributions are welcome, particularly for:

- Additional AWS service state management
- Enhanced IDE integrations
- CI/CD workflow optimizations
- Extended troubleshooting capabilities

## License

MIT