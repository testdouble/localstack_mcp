import { promises as fs } from 'fs';
import { join } from 'path';
import { stringify } from 'yaml';

interface NetworkConfigOptions {
  containerName: string;
  services: string[];
  customNetworkName?: string;
  enablePersistence?: boolean;
}

export class NetworkConfigGenerator {
  async generateConfig(options: NetworkConfigOptions) {
    const { containerName, services, customNetworkName, enablePersistence = true } = options;

    const config = {
      dockerCompose: this.generateDockerCompose(options),
      environmentVariables: this.generateEnvironmentVariables(services),
      networkingGuide: this.generateNetworkingGuide(),
      troubleshooting: this.generateTroubleshootingGuide(),
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(config, null, 2)
      }]
    };
  }

  private generateDockerCompose(options: NetworkConfigOptions): string {
    const { containerName, services, customNetworkName = 'localstack-network', enablePersistence } = options;
    
    const compose = {
      version: '3.8',
      services: {
        [containerName]: {
          container_name: containerName,
          image: 'localstack/localstack:latest',
          ports: ['4566:4566'],
          environment: [
            `SERVICES=${services.join(',')}`,
            'DEBUG=1',
            'DOCKER_HOST=unix:///var/run/docker.sock',
            'LOCALSTACK_HOST=localhost',
            ...(enablePersistence ? ['PERSISTENCE=1'] : []),
          ],
          volumes: [
            '${TMPDIR:-/tmp}/localstack:/var/lib/localstack',
            '/var/run/docker.sock:/var/run/docker.sock',
            ...(enablePersistence ? ['./localstack-data:/var/lib/localstack'] : []),
          ],
          networks: [customNetworkName],
          healthcheck: {
            test: ['CMD', 'curl', '-f', 'http://localhost:4566/_localstack/health'],
            interval: '30s',
            timeout: '10s',
            retries: 5,
            start_period: '30s',
          },
        },
      },
      networks: {
        [customNetworkName]: {
          driver: 'bridge',
        },
      },
    };

    return stringify(compose);
  }

  private generateEnvironmentVariables(services: string[]): Record<string, string> {
    const baseVars = {
      LOCALSTACK_ENDPOINT: 'http://localhost:4566',
      AWS_DEFAULT_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      SERVICES: services.join(','),
    };

    // Add service-specific configurations
    const serviceConfigs: Record<string, Record<string, string>> = {
      lambda: {
        LAMBDA_EXECUTOR: 'docker-reuse',
        LAMBDA_REMOVE_CONTAINERS: 'true',
      },
      s3: {
        S3_SKIP_SIGNATURE_VALIDATION: 'true',
      },
      dynamodb: {
        DYNAMODB_SHARE_DB: '1',
      },
      sqs: {
        SQS_ENDPOINT_STRATEGY: 'domain',
      },
    };

    services.forEach(service => {
      if (serviceConfigs[service]) {
        Object.assign(baseVars, serviceConfigs[service]);
      }
    });

    return baseVars;
  }

  private generateNetworkingGuide(): Record<string, any> {
    return {
      containerToContainer: {
        description: 'When accessing LocalStack from other containers',
        endpoint: 'http://localstack:4566',
        note: 'Use the container name as hostname',
      },
      hostToContainer: {
        description: 'When accessing LocalStack from host machine',
        endpoint: 'http://localhost:4566',
        note: 'Use localhost when running on host',
      },
      cicd: {
        description: 'CI/CD environment configuration',
        tips: [
          'Use docker-compose for consistent networking',
          'Wait for health check before running tests',
          'Use container names for inter-service communication',
          'Set LOCALSTACK_HOST=localstack in CI environment',
        ],
      },
      platformSpecific: {
        windows: {
          wsl2: 'Use localhost:4566, ensure Docker Desktop WSL2 integration is enabled',
          dockerDesktop: 'Use localhost:4566, may need to disable Windows Firewall temporarily',
        },
        macos: {
          dockerDesktop: 'Use localhost:4566, works out of the box',
          lima: 'May need to configure port forwarding',
        },
        linux: {
          native: 'Use localhost:4566 or 127.0.0.1:4566',
          docker: 'Use docker0 interface IP for advanced setups',
        },
      },
    };
  }

  private generateTroubleshootingGuide(): Record<string, any> {
    return {
      commonIssues: {
        connectionRefused: {
          symptoms: ['Connection refused to localhost:4566'],
          solutions: [
            'Check if LocalStack container is running: docker ps',
            'Verify port 4566 is exposed: docker port localstack',
            'Check for port conflicts: netstat -tulpn | grep 4566',
            'Restart LocalStack container',
          ],
        },
        endpointResolution: {
          symptoms: ['Services not accessible', 'Endpoint not found'],
          solutions: [
            'Verify SERVICES environment variable includes required services',
            'Check service health: curl http://localhost:4566/_localstack/health',
            'Ensure proper AWS SDK endpoint configuration',
            'Verify region is set correctly (default: us-east-1)',
          ],
        },
        dockerNetworking: {
          symptoms: ['Container cannot reach LocalStack', 'DNS resolution fails'],
          solutions: [
            'Ensure containers are on the same network',
            'Use container name as hostname (not localhost)',
            'Check Docker network configuration: docker network ls',
            'Verify LOCALSTACK_HOST environment variable',
          ],
        },
        performance: {
          symptoms: ['Slow startup', 'Timeouts', 'High memory usage'],
          solutions: [
            'Limit enabled services to only what you need',
            'Increase container memory limits',
            'Use LAMBDA_EXECUTOR=docker-reuse for faster Lambda execution',
            'Enable DEBUG=0 for production-like performance',
          ],
        },
      },
      diagnosticCommands: {
        containerStatus: 'docker ps -a | grep localstack',
        containerLogs: 'docker logs localstack',
        healthCheck: 'curl -s http://localhost:4566/_localstack/health | jq',
        networkInspection: 'docker network inspect localstack-network',
        portCheck: 'docker port localstack 4566',
        resourceUsage: 'docker stats localstack --no-stream',
      },
      validationSteps: [
        'Verify Docker is running and accessible',
        'Check LocalStack container is running and healthy',
        'Test basic connectivity to port 4566',
        'Validate service-specific endpoints',
        'Confirm AWS SDK configuration',
        'Test end-to-end application workflow',
      ],
    };
  }
}