#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { DockerDetector } from './tools/docker-detector.js';
import { NetworkConfigGenerator } from './tools/network-config.js';
import { LocalStackHealthMonitor } from './tools/health-monitor.js';
import { StateManager } from './tools/state-manager.js';

class LocalStackMCPServer {
  private server: Server;
  private dockerDetector: DockerDetector;
  private networkConfigGenerator: NetworkConfigGenerator;
  private healthMonitor: LocalStackHealthMonitor;
  private stateManager: StateManager;

  constructor() {
    this.server = new Server(
      {
        name: 'localstack-mcp-server',
        version: '1.0.0',
      }
    );

    this.dockerDetector = new DockerDetector();
    this.networkConfigGenerator = new NetworkConfigGenerator();
    this.healthMonitor = new LocalStackHealthMonitor();
    this.stateManager = new StateManager();

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'detect_docker_environment',
            description: 'Detect Docker environment and container setup for LocalStack',
            inputSchema: {
              type: 'object',
              properties: {
                projectPath: {
                  type: 'string',
                  description: 'Path to the project directory',
                },
              },
            },
          },
          {
            name: 'generate_network_config',
            description: 'Generate Docker networking configuration for LocalStack',
            inputSchema: {
              type: 'object',
              properties: {
                containerName: {
                  type: 'string',
                  description: 'LocalStack container name',
                  default: 'localstack',
                },
                services: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'AWS services to enable',
                },
              },
            },
          },
          {
            name: 'check_localstack_health',
            description: 'Check LocalStack container health and service status',
            inputSchema: {
              type: 'object',
              properties: {
                endpoint: {
                  type: 'string',
                  description: 'LocalStack endpoint URL',
                  default: 'http://localhost:4566',
                },
              },
            },
          },
          {
            name: 'export_localstack_state',
            description: 'Export LocalStack state for team sharing',
            inputSchema: {
              type: 'object',
              properties: {
                outputPath: {
                  type: 'string',
                  description: 'Path to save state export',
                },
                services: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Services to include in export',
                },
              },
            },
          },
          {
            name: 'import_localstack_state',
            description: 'Import LocalStack state from export file',
            inputSchema: {
              type: 'object',
              properties: {
                statePath: {
                  type: 'string',
                  description: 'Path to state file to import',
                },
              },
              required: ['statePath'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'detect_docker_environment':
            return await this.dockerDetector.detectEnvironment(
              (args as any)?.projectPath || process.cwd()
            );

          case 'generate_network_config':
            return await this.networkConfigGenerator.generateConfig({
              containerName: (args as any)?.containerName || 'localstack',
              services: (args as any)?.services || [],
            });

          case 'check_localstack_health':
            return await this.healthMonitor.checkHealth(
              (args as any)?.endpoint || 'http://localhost:4566'
            );

          case 'export_localstack_state':
            return await this.stateManager.exportState({
              outputPath: (args as any)?.outputPath,
              services: (args as any)?.services || [],
            });

          case 'import_localstack_state':
            return await this.stateManager.importState((args as any)?.statePath);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('LocalStack MCP server running on stdio');
  }
}

const server = new LocalStackMCPServer();
server.run().catch(console.error);